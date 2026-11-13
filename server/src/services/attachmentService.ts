import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Prisma, Role, TaskStatus, type User } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../prisma';
import { emitEvent } from '../realtime/bus';
import {
  type AttachmentStorageProvider,
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
import {
  deleteAttachmentFromDrive,
  downloadAttachmentFromDrive,
  getDriveStorageQuota,
  isGoogleDriveEnabled,
  uploadAttachmentToDrive,
} from './googleDriveService';
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

interface TaskUploadTarget {
  id: string;
  title: string;
  status: TaskStatus;
  assigneeId: string | null;
  assignedToAll: boolean;
  driveFolderId: string | null;
  _count: { attachments: number };
}

function prepareBlobForStorage(rawBuffer: Buffer, precomputedSha256?: string): PreparedBlob {
  const sha256 = precomputedSha256 ?? createHash('sha256').update(rawBuffer).digest('hex');
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

function matchesIfNoneMatch(headerValue: string | undefined, etag: string): boolean {
  if (!headerValue) return false;
  const trimmed = headerValue.trim();
  if (!trimmed) return false;
  if (trimmed === '*') return true;

  const normalizedTarget = etag.replace(/^W\//i, '').trim();
  return trimmed.split(',').some((part) => {
    const candidate = part.trim().replace(/^W\//i, '').trim();
    return candidate === normalizedTarget;
  });
}

async function assertTaskUploadAllowed(
  actor: User,
  task: TaskUploadTarget | null,
  taskId: string
): Promise<TaskUploadTarget> {
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

  return task;
}

/** Elimina de PostgreSQL los blobs binarios que ya no tienen ninguna referencia en TaskAttachment. */
export async function cleanupOrphanBlobs(
  tx: Prisma.TransactionClient,
  candidateSha256s: Array<string | null | undefined>
): Promise<{ removedBlobs: number; freedBytes: number }> {
  const uniqueHashes = [
    ...new Set(
      candidateSha256s
        .filter((sha): sha is string => typeof sha === 'string' && sha.trim().length > 0)
        .map((sha) => sha.trim())
    ),
  ];
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
  const driveEnabled = isGoogleDriveEnabled();
  const quotaBytes = config.attachmentsQuotaMb * 1024 * 1024;

  const [blobAgg, driveAgg, dbAgg, driveQuota] = await Promise.all([
    prisma.attachmentBlob.aggregate({
      _sum: { storedBytes: true },
      _count: { _all: true },
    }),
    prisma.taskAttachment.aggregate({
      where: { storageProvider: 'gdrive' },
      _sum: { sizeBytes: true },
      _count: { _all: true },
    }),
    prisma.taskAttachment.aggregate({
      where: { storageProvider: { not: 'gdrive' } },
      _sum: { sizeBytes: true },
      _count: { _all: true },
    }),
    driveEnabled ? getDriveStorageQuota() : Promise.resolve(null),
  ]);

  const usedBytes = blobAgg._sum.storedBytes ?? 0;
  const driveAttachments = driveAgg._count._all;
  const driveLogicalBytes = driveAgg._sum.sizeBytes ?? 0;
  const dbAttachments = dbAgg._count._all;
  const dbLogicalBytes = dbAgg._sum.sizeBytes ?? 0;
  const logicalBytes = dbLogicalBytes + driveLogicalBytes;
  const totalAttachments = dbAttachments + driveAttachments;
  const savedBytes = Math.max(0, dbLogicalBytes - usedBytes + driveLogicalBytes);
  const usageRatio = quotaBytes > 0 ? usedBytes / quotaBytes : 0;

  const driveQuotaBytes = driveQuota?.limitBytes ?? null;
  const driveUsedBytes = driveQuota ? driveQuota.usageBytes : null;
  const driveUsageRatio =
    driveQuotaBytes !== null && driveQuotaBytes > 0 && driveUsedBytes !== null
      ? driveUsedBytes / driveQuotaBytes
      : null;

  return {
    storageMode: driveEnabled ? 'gdrive' : 'db',
    usedBytes,
    storedBytes: usedBytes,
    logicalBytes,
    uniqueBlobs: blobAgg._count._all,
    totalAttachments,
    driveAttachments,
    driveLogicalBytes,
    dbAttachments,
    savedBytes,
    quotaBytes,
    usageRatio,
    driveQuotaBytes,
    driveUsedBytes,
    driveUsageRatio,
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

const taskUploadSelect = {
  id: true,
  title: true,
  status: true,
  assigneeId: true,
  assignedToAll: true,
  driveFolderId: true,
  _count: { select: { attachments: true } },
} satisfies Prisma.TaskSelect;

export async function uploadTaskAttachment(
  actor: User,
  taskId: string,
  file: { originalname: string; mimetype?: string; buffer: Buffer } | undefined
): Promise<AttachmentUploadResponse> {
  if (!file) {
    throw new HttpError(400, 'Selecciona un archivo para subir');
  }

  const validated = validateAttachmentUpload(file);
  const sha256 = createHash('sha256').update(validated.buffer).digest('hex');

  let txResult: {
    task: TaskUploadTarget;
    attachment: Prisma.TaskAttachmentGetPayload<{ include: typeof attachmentMetaInclude }>;
    activity: Prisma.ActivityLogGetPayload<{ include: { user: true } }>;
    deduplicated: boolean;
    storageProvider: AttachmentStorageProvider;
    driveWebViewLink?: string | null;
  };

  if (isGoogleDriveEnabled()) {
    const precheckTask = await prisma.task.findUnique({
      where: { id: taskId },
      select: taskUploadSelect,
    });
    const verifiedTask = await assertTaskUploadAllowed(actor, precheckTask, taskId);

    const driveResult = await uploadAttachmentToDrive({
      taskId: verifiedTask.id,
      taskTitle: verifiedTask.title,
      knownFolderId: verifiedTask.driveFolderId,
      originalName: validated.originalName,
      mimeType: validated.mimeType,
      buffer: validated.buffer,
      uploaderName: actor.displayName,
      uploaderUsername: actor.username,
    });

    try {
      txResult = await prisma.$transaction(
        async (tx) => {
          const taskRow = await tx.task.findUnique({
            where: { id: taskId },
            select: taskUploadSelect,
          });
          const task = await assertTaskUploadAllowed(actor, taskRow, taskId);

          if (task.driveFolderId !== driveResult.folderId) {
            await tx.task.update({
              where: { id: taskId },
              data: { driveFolderId: driveResult.folderId },
            });
          }

          const attachment = await tx.taskAttachment.create({
            data: {
              taskId,
              uploadedById: actor.id,
              storageProvider: 'gdrive',
              driveFileId: driveResult.fileId,
              driveFolderId: driveResult.folderId,
              contentSha256: sha256,
              blobSha256: null,
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
                storedBytes: 0,
                isCompressed: false,
                deduplicated: false,
                storageProvider: 'gdrive',
              },
            },
            include: { user: true },
          });

          return {
            task,
            attachment,
            activity,
            deduplicated: false,
            storageProvider: 'gdrive' as const,
            driveWebViewLink: driveResult.webViewLink,
          };
        },
        {
          maxWait: 15_000,
          timeout: 30_000,
        }
      );
    } catch (err) {
      await deleteAttachmentFromDrive(driveResult.fileId).catch(() => undefined);
      throw err;
    }
  } else {
    const prepared = prepareBlobForStorage(validated.buffer, sha256);
    const quotaBytes = config.attachmentsQuotaMb * 1024 * 1024;

    txResult = await prisma.$transaction(
      async (tx) => {
        const taskRow = await tx.task.findUnique({
          where: { id: taskId },
          select: taskUploadSelect,
        });
        const task = await assertTaskUploadAllowed(actor, taskRow, taskId);

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
            storageProvider: 'db',
            contentSha256: prepared.sha256,
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
              storageProvider: 'db',
            },
          },
          include: { user: true },
        });

        return {
          task,
          attachment,
          activity,
          deduplicated,
          storageProvider: 'db' as const,
        };
      },
      {
        // Subir binarios bytea de hasta 5 MB a PostgreSQL remoto puede superar los 5 s por defecto de Prisma.
        maxWait: 20_000,
        timeout: 120_000,
      }
    );
  }

  const attachmentDTO = toAttachmentDTO(txResult.attachment);

  emitEvent('attachment:created', {
    taskId,
    attachment: attachmentDTO,
  });
  emitEvent('activity:new', toActivityDTO(txResult.activity));

  const emailResult = await sendAttachmentNotificationEmail({
    attachment: attachmentDTO,
    task: {
      id: txResult.task.id,
      title: txResult.task.title,
      status: txResult.task.status,
    },
    uploader: toUserPublic(actor),
    buffer: validated.buffer,
    ...(txResult.storageProvider === 'gdrive'
      ? { driveWebViewLink: txResult.driveWebViewLink }
      : {}),
    storageProvider: txResult.storageProvider,
  });

  return {
    attachment: attachmentDTO,
    emailSent: emailResult.sent,
    ...(emailResult.provider ? { emailProvider: emailResult.provider } : {}),
    ...(!emailResult.sent && emailResult.error
      ? { emailWarning: emailResult.error, emailError: emailResult.error }
      : {}),
    deduplicated: txResult.deduplicated,
    storageProvider: txResult.storageProvider,
  };
}

export async function getAttachmentBinary(
  attachmentId: string,
  ifNoneMatch?: string
): Promise<{
  attachment: TaskAttachment;
  buffer: Buffer | null;
  etag: string;
  notModified: boolean;
}> {
  const row = await prisma.taskAttachment.findUnique({
    where: { id: attachmentId },
    include: attachmentMetaInclude,
  });

  if (!row) {
    throw new HttpError(404, 'Archivo adjunto no encontrado');
  }

  const etagKey = row.contentSha256 || row.blobSha256 || row.id;
  const etag = `"${etagKey}"`;
  const attachment = toAttachmentDTO(row);

  if (matchesIfNoneMatch(ifNoneMatch, etag)) {
    return {
      attachment,
      buffer: null,
      etag,
      notModified: true,
    };
  }

  if (row.storageProvider === 'gdrive') {
    if (!row.driveFileId) {
      throw new HttpError(404, 'El archivo ya no está disponible en Google Drive');
    }
    const buffer = await downloadAttachmentFromDrive(row.driveFileId);
    return {
      attachment,
      buffer,
      etag,
      notModified: false,
    };
  }

  if (!row.blobSha256 || !row.blob) {
    throw new HttpError(404, 'Archivo adjunto no encontrado');
  }

  const blobRow = await prisma.attachmentBlob.findUnique({
    where: { sha256: row.blobSha256 },
    select: {
      data: true,
      isCompressed: true,
    },
  });

  if (!blobRow) {
    throw new HttpError(404, 'Archivo adjunto no encontrado');
  }

  const rawStored = Buffer.from(blobRow.data);
  const buffer = blobRow.isCompressed ? gunzipSync(rawStored) : rawStored;

  return {
    attachment,
    buffer,
    etag,
    notModified: false,
  };
}

export async function deleteTaskAttachment(
  actor: User,
  attachmentId: string
): Promise<{
  ok: true;
  id: string;
  taskId: string;
  removedBlob: boolean;
  freedBytes: number;
  removedFromDrive: boolean;
}> {
  const existing = await prisma.taskAttachment.findUnique({
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

  let removedFromDrive = false;
  if (existing.storageProvider === 'gdrive' && existing.driveFileId) {
    await deleteAttachmentFromDrive(existing.driveFileId);
    removedFromDrive = true;
  }

  const txResult = await prisma.$transaction(
    async (tx) => {
      const deleted = await tx.taskAttachment.deleteMany({
        where: { id: attachmentId },
      });

      if (deleted.count === 0) {
        throw new HttpError(404, 'Archivo adjunto no encontrado');
      }

      const gc = existing.blobSha256
        ? await cleanupOrphanBlobs(tx, [existing.blobSha256])
        : { removedBlobs: 0, freedBytes: 0 };

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
            storageProvider: existing.storageProvider,
          },
        },
        include: { user: true },
      });

      return {
        taskId: existing.taskId,
        activity,
        gc,
      };
    },
    {
      maxWait: 15_000,
      timeout: 30_000,
    }
  );

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
    removedFromDrive,
  };
}
