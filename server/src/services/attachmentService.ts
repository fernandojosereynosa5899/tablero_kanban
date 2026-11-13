import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Prisma, Role, TaskStatus, type User } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../prisma';
import { emitEvent } from '../realtime/bus';
import {
  type AttachmentStorageStats,
  type AttachmentUploadResponse,
  type TaskAttachment,
  toActivityDTO,
  toAttachmentDTO,
  toUserPublic,
} from '../types/domain';
import { HttpError } from '../utils/errors';
import {
  MAX_ATTACHMENTS_PER_TASK,
  validateAttachmentUpload,
} from '../utils/fileValidation';
import { sendAttachmentNotificationEmail } from './mailService';
import { buildForbiddenMessage, recordSecurityEvent } from './securityService';

export const attachmentMetaInclude = {
  uploadedBy: true,
  blob: {
    select: {
      storedBytes: true,
      isCompressed: true,
    },
  },
} satisfies Prisma.TaskAttachmentInclude;

interface PreparedBlob {
  sha256: string;
  data: Buffer;
  rawBytes: number;
  storedBytes: number;
  isCompressed: boolean;
}

function prepareBlobForStorage(rawBuffer: Buffer): PreparedBlob {
  const sha256 = createHash('sha256').update(rawBuffer).digest('hex');
  const rawBytes = rawBuffer.length;
  const gzipped = gzipSync(rawBuffer, { level: 6 });

  // Solo guarda gzip si logra ahorrar al menos ~8% del tamaño; imágenes/OOXML suelen estar ya comprimidos.
  if (gzipped.length < Math.floor(rawBytes * 0.92)) {
    return {
      sha256,
      data: gzipped,
      rawBytes,
      storedBytes: gzipped.length,
      isCompressed: true,
    };
  }

  return {
    sha256,
    data: rawBuffer,
    rawBytes,
    storedBytes: rawBytes,
    isCompressed: false,
  };
}

/** Elimina de PostgreSQL los blobs binarios que ya no tienen ninguna referencia en TaskAttachment. */
export async function cleanupOrphanBlobs(
  tx: Prisma.TransactionClient,
  candidateSha256s: string[]
): Promise<{ removedBlobs: number; freedBytes: number }> {
  const uniqueHashes = [...new Set(candidateSha256s.filter(Boolean))];
  let removedBlobs = 0;
  let freedBytes = 0;

  for (const sha256 of uniqueHashes) {
    const remainingRefs = await tx.taskAttachment.count({
      where: { blobSha256: sha256 },
    });
    if (remainingRefs === 0) {
      const existingBlob = await tx.attachmentBlob.findUnique({
        where: { sha256 },
        select: { storedBytes: true },
      });
      const result = await tx.attachmentBlob.deleteMany({
        where: { sha256 },
      });
      if (result.count > 0) {
        removedBlobs += result.count;
        freedBytes += existingBlob?.storedBytes ?? 0;
      }
    }
  }

  return { removedBlobs, freedBytes };
}

export async function getAttachmentStorageStats(): Promise<AttachmentStorageStats> {
  const quotaBytes = config.attachmentsQuotaMb * 1024 * 1024;
  const [blobAgg, attachmentAgg] = await Promise.all([
    prisma.attachmentBlob.aggregate({
      _sum: { storedBytes: true },
      _count: { _all: true },
    }),
    prisma.taskAttachment.aggregate({
      _sum: { sizeBytes: true },
      _count: { _all: true },
    }),
  ]);

  const storedBytes = blobAgg._sum.storedBytes ?? 0;
  const logicalBytes = attachmentAgg._sum.sizeBytes ?? 0;

  return {
    logicalBytes,
    storedBytes,
    savedBytes: Math.max(0, logicalBytes - storedBytes),
    quotaBytes,
    uniqueBlobs: blobAgg._count._all,
    totalAttachments: attachmentAgg._count._all,
  };
}

export async function listTaskAttachments(taskId: string): Promise<TaskAttachment[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true },
  });
  if (!task) {
    throw new HttpError(404, 'Tarea no encontrada');
  }

  const rows = await prisma.taskAttachment.findMany({
    where: { taskId },
    include: attachmentMetaInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  return rows.map(toAttachmentDTO);
}

export async function uploadTaskAttachment(
  actor: User,
  taskId: string,
  file: { originalname: string; mimetype?: string; buffer: Buffer } | undefined
): Promise<AttachmentUploadResponse> {
  if (!file) {
    throw new HttpError(400, 'Selecciona un archivo para subir');
  }

  const validated = validateAttachmentUpload(file);
  const prepared = prepareBlobForStorage(validated.buffer);
  const quotaBytes = config.attachmentsQuotaMb * 1024 * 1024;

  const txResult = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        status: true,
        assigneeId: true,
        assignedToAll: true,
        _count: { select: { attachments: true } },
      },
    });
    if (!task) {
      throw new HttpError(404, 'Tarea no encontrada');
    }

    const canUpload =
      actor.role === Role.LEADER ||
      actor.role === Role.SUBLEADER ||
      task.assignedToAll ||
      task.assigneeId === actor.id;

    if (!canUpload) {
      await recordSecurityEvent({
        userId: actor.id,
        username: actor.username,
        eventType: 'unauthorized_action',
        details: { action: 'uploadTaskAttachment', taskId },
      });
      throw new HttpError(
        403,
        buildForbiddenMessage(actor, 'Solo puedes subir archivos en actividades asignadas a ti')
      );
    }

    if (task.status === TaskStatus.APPROVED && actor.role !== Role.LEADER) {
      await recordSecurityEvent({
        userId: actor.id,
        username: actor.username,
        eventType: 'unauthorized_action',
        details: { action: 'uploadTaskAttachment_approved', taskId },
      });
      throw new HttpError(
        403,
        buildForbiddenMessage(actor, 'No puedes subir archivos a una tarea aprobada')
      );
    }

    if (task._count.attachments >= MAX_ATTACHMENTS_PER_TASK) {
      throw new HttpError(
        400,
        `Límite máximo de ${MAX_ATTACHMENTS_PER_TASK} archivos por actividad alcanzado. Borra un archivo existente si deseas reemplazarlo.`
      );
    }

    let existingBlob = await tx.attachmentBlob.findUnique({
      where: { sha256: prepared.sha256 },
      select: { sha256: true, storedBytes: true, isCompressed: true },
    });

    const deduplicated = Boolean(existingBlob);

    if (!existingBlob) {
      const storageAgg = await tx.attachmentBlob.aggregate({
        _sum: { storedBytes: true },
      });
      const currentStored = storageAgg._sum.storedBytes ?? 0;
      if (currentStored + prepared.storedBytes > quotaBytes) {
        throw new HttpError(
          413,
          `Se alcanzó la cuota de almacenamiento configurada (${config.attachmentsQuotaMb} MB) para proteger el límite de la base de datos. Elimina archivos antiguos para liberar espacio.`
        );
      }

      try {
        existingBlob = await tx.attachmentBlob.create({
          data: {
            sha256: prepared.sha256,
            data: new Uint8Array(prepared.data),
            rawBytes: prepared.rawBytes,
            storedBytes: prepared.storedBytes,
            isCompressed: prepared.isCompressed,
          },
          select: { sha256: true, storedBytes: true, isCompressed: true },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          existingBlob = await tx.attachmentBlob.findUnique({
            where: { sha256: prepared.sha256 },
            select: { sha256: true, storedBytes: true, isCompressed: true },
          });
        } else {
          throw err;
        }
      }
    }

    if (!existingBlob) {
      throw new HttpError(500, 'No se pudo almacenar el contenido del archivo');
    }

    const attachment = await tx.taskAttachment.create({
      data: {
        taskId,
        uploadedById: actor.id,
        blobSha256: existingBlob.sha256,
        originalName: validated.originalName,
        extension: validated.extension,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
      },
      include: attachmentMetaInclude,
    });

    const activity = await tx.activityLog.create({
      data: {
        userId: actor.id,
        taskId,
        action: 'attachment.uploaded',
        details: {
          attachmentId: attachment.id,
          title: task.title,
          originalName: attachment.originalName,
          extension: attachment.extension,
          sizeBytes: attachment.sizeBytes,
          storedBytes: existingBlob.storedBytes,
          isCompressed: existingBlob.isCompressed,
          deduplicated,
        },
      },
      include: { user: true },
    });

    return {
      task,
      attachment,
      activity,
      deduplicated,
    };
  }, {
    // Subir binarios bytea de hasta 5 MB a PostgreSQL remoto puede superar los 5 s por defecto de Prisma.
    maxWait: 20_000,
    timeout: 120_000,
  });

  const attachmentDTO = toAttachmentDTO(txResult.attachment);

  emitEvent('attachment:created', {
    taskId,
    attachment: attachmentDTO,
  });
  emitEvent('activity:new', toActivityDTO(txResult.activity));

  const mailResult = await sendAttachmentNotificationEmail({
    attachment: attachmentDTO,
    task: {
      id: txResult.task.id,
      title: txResult.task.title,
      status: txResult.task.status,
    },
    uploader: toUserPublic(actor),
    buffer: validated.buffer,
  });

  return {
    attachment: attachmentDTO,
    deduplicated: txResult.deduplicated,
    emailSent: mailResult.sent,
    ...(mailResult.sent ? {} : { emailWarning: mailResult.error }),
  };
}

export async function getAttachmentBinary(attachmentId: string): Promise<{
  attachment: TaskAttachment;
  buffer: Buffer;
}> {
  const row = await prisma.taskAttachment.findUnique({
    where: { id: attachmentId },
    include: {
      uploadedBy: true,
      blob: {
        select: {
          data: true,
          storedBytes: true,
          isCompressed: true,
        },
      },
    },
  });

  if (!row || !row.blob) {
    throw new HttpError(404, 'Archivo adjunto no encontrado');
  }

  const rawStored = Buffer.from(row.blob.data);
  const buffer = row.blob.isCompressed ? gunzipSync(rawStored) : rawStored;

  return {
    attachment: toAttachmentDTO(row),
    buffer,
  };
}

export async function deleteTaskAttachment(
  actor: User,
  attachmentId: string
): Promise<{ ok: true; id: string; taskId: string; removedBlob: boolean; freedBytes: number }> {
  const txResult = await prisma.$transaction(async (tx) => {
    const existing = await tx.taskAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        task: {
          select: { id: true, title: true, status: true },
        },
      },
    });

    if (!existing) {
      throw new HttpError(404, 'Archivo adjunto no encontrado');
    }

    const canDelete = actor.role === Role.LEADER || existing.uploadedById === actor.id;
    if (!canDelete) {
      await recordSecurityEvent({
        userId: actor.id,
        username: actor.username,
        eventType: 'unauthorized_action',
        details: { action: 'deleteTaskAttachment', attachmentId, taskId: existing.taskId },
      });
      throw new HttpError(
        403,
        buildForbiddenMessage(actor, 'Solo el líder o quien subió el archivo puede eliminarlo')
      );
    }

    if (existing.task.status === TaskStatus.APPROVED && actor.role !== Role.LEADER) {
      await recordSecurityEvent({
        userId: actor.id,
        username: actor.username,
        eventType: 'unauthorized_action',
        details: { action: 'deleteTaskAttachment_approved', attachmentId, taskId: existing.taskId },
      });
      throw new HttpError(
        403,
        buildForbiddenMessage(actor, 'No puedes eliminar archivos de una tarea ya aprobada')
      );
    }

    await tx.taskAttachment.delete({
      where: { id: attachmentId },
    });

    const gc = await cleanupOrphanBlobs(tx, [existing.blobSha256]);

    const activity = await tx.activityLog.create({
      data: {
        userId: actor.id,
        taskId: existing.taskId,
        action: 'attachment.deleted',
        details: {
          attachmentId: existing.id,
          title: existing.task.title,
          originalName: existing.originalName,
          freedBytes: gc.freedBytes,
        },
      },
      include: { user: true },
    });

    return {
      taskId: existing.taskId,
      activity,
      gc,
    };
  }, {
    maxWait: 15_000,
    timeout: 30_000,
  });

  emitEvent('attachment:deleted', {
    taskId: txResult.taskId,
    id: attachmentId,
  });
  emitEvent('activity:new', toActivityDTO(txResult.activity));

  return {
    ok: true,
    id: attachmentId,
    taskId: txResult.taskId,
    removedBlob: txResult.gc.removedBlobs > 0,
    freedBytes: txResult.gc.freedBytes,
  };
}
