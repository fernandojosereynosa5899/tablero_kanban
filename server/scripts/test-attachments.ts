import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import { createServer } from '../src/app';
import { prisma } from '../src/prisma';
import {
  type DriveQuotaInfo,
  type DriveUploadInput,
  type DriveUploadResult,
  type GoogleDriveAdapter,
  setGoogleDriveAdapterForTests,
} from '../src/services/googleDriveService';
import {
  type AttachmentEmailPayload,
  setMailDispatcherForTests,
  verifyMailConnection,
  verifySmtpConnection,
} from '../src/services/mailService';
import type {
  AttachmentStorageStats,
  AttachmentUploadResponse,
  Task,
  TaskAttachment,
  TaskDetail,
} from '../src/types/domain';
import { HttpError } from '../src/utils/errors';
import { getTestUserPassword } from './lib/testCredentials';

interface HttpResult<T = unknown> {
  status: number;
  headers: Headers;
  data: T;
}

interface DeleteAttachmentResponse {
  ok: boolean;
  id: string;
  taskId: string;
  removedBlob: boolean;
  freedBytes: number;
  removedFromDrive?: boolean;
}

interface MockDriveFileRecord {
  fileId: string;
  folderId: string;
  taskId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  webViewLink: string;
}

interface MockDriveFolderRecord {
  folderId: string;
  taskId: string;
  name: string;
}

interface InMemoryDriveState {
  driveFiles: Map<string, MockDriveFileRecord>;
  driveFolders: Map<string, MockDriveFolderRecord>;
  taskFolderMap: Map<string, string>;
  deletedFiles: string[];
  deletedFolders: string[];
  knownFolderIdsReceived: Array<string | null | undefined>;
  downloadCalls: number;
  onBeforeUpload?: (input: DriveUploadInput) => Promise<void>;
  adapter: GoogleDriveAdapter;
}

const DRIVE_QUOTA_BYTES = 15 * 1024 * 1024 * 1024; // 15 GB simulados

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function createInMemoryDriveState(): InMemoryDriveState {
  const driveFiles = new Map<string, MockDriveFileRecord>();
  const driveFolders = new Map<string, MockDriveFolderRecord>();
  const taskFolderMap = new Map<string, string>();
  const deletedFiles: string[] = [];
  const deletedFolders: string[] = [];
  const knownFolderIdsReceived: Array<string | null | undefined> = [];
  let folderSeq = 0;
  let fileSeq = 0;

  const state: InMemoryDriveState = {
    driveFiles,
    driveFolders,
    taskFolderMap,
    deletedFiles,
    deletedFolders,
    knownFolderIdsReceived,
    downloadCalls: 0,
    adapter: {
      isEnabled: () => true,

      uploadFile: async (input: DriveUploadInput): Promise<DriveUploadResult> => {
        if (state.onBeforeUpload) {
          await state.onBeforeUpload(input);
        }

        knownFolderIdsReceived.push(input.knownFolderId);

        let folderId =
          input.knownFolderId && driveFolders.has(input.knownFolderId)
            ? input.knownFolderId
            : undefined;

        if (!folderId) {
          const mappedFolderId = taskFolderMap.get(input.taskId);
          if (mappedFolderId && driveFolders.has(mappedFolderId)) {
            folderId = mappedFolderId;
          }
        }

        if (!folderId) {
          folderId = `drv_folder_${++folderSeq}`;
          driveFolders.set(folderId, {
            folderId,
            taskId: input.taskId,
            name: `${input.taskTitle} (${input.taskId.slice(-6)})`,
          });
          taskFolderMap.set(input.taskId, folderId);
        }

        const fileId = `drv_file_${++fileSeq}`;
        const webViewLink = `https://drive.google.com/file/d/${fileId}/view`;
        driveFiles.set(fileId, {
          fileId,
          folderId,
          taskId: input.taskId,
          originalName: input.originalName,
          mimeType: input.mimeType,
          buffer: Buffer.from(input.buffer),
          webViewLink,
        });

        return {
          fileId,
          folderId,
          webViewLink,
          sizeBytes: input.buffer.length,
        };
      },

      downloadFile: async (fileId: string): Promise<Buffer> => {
        state.downloadCalls += 1;
        const record = driveFiles.get(fileId);
        if (!record) {
          throw new HttpError(404, 'El archivo ya no está disponible en Google Drive');
        }
        return Buffer.from(record.buffer);
      },

      deleteFile: async (fileId: string): Promise<void> => {
        deletedFiles.push(fileId);
        driveFiles.delete(fileId);
      },

      deleteFolder: async (folderId: string): Promise<void> => {
        deletedFolders.push(folderId);
        driveFolders.delete(folderId);
        for (const [taskId, mapped] of taskFolderMap.entries()) {
          if (mapped === folderId) {
            taskFolderMap.delete(taskId);
          }
        }
      },

      getStorageQuota: async (): Promise<DriveQuotaInfo> => {
        let usage = 0;
        for (const record of driveFiles.values()) {
          usage += record.buffer.length;
        }
        return {
          limitBytes: DRIVE_QUOTA_BYTES,
          usageBytes: usage,
          usageInDriveBytes: usage,
          userEmail: 'kanban-drive-test@example.com',
        };
      },
    },
  };

  return state;
}

async function requestJson<T = unknown>(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<HttpResult<T>> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  const data = (text ? JSON.parse(text) : null) as T;
  return { status: res.status, headers: res.headers, data };
}

async function uploadMultipart<T = unknown>(
  baseUrl: string,
  path: string,
  token: string,
  filename: string,
  mimeType: string,
  buffer: Buffer
): Promise<HttpResult<T>> {
  const form = new FormData();
  const file = new File([new Uint8Array(buffer)], filename, { type: mimeType });
  form.append('file', file);

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const text = await res.text();
  const data = (text ? JSON.parse(text) : null) as T;
  return { status: res.status, headers: res.headers, data };
}

async function login(baseUrl: string, username: string, password: string) {
  const res = await requestJson<{ token: string; user: { id: string; displayName: string } }>(
    baseUrl,
    '/api/auth/login',
    {
      method: 'POST',
      body: { username, password },
    }
  );
  assert.equal(res.status, 200, `Login falló para ${username}`);
  return { token: res.data.token, userId: res.data.user.id, displayName: res.data.user.displayName };
}

async function createTempTask(
  baseUrl: string,
  token: string,
  title: string,
  assigneeId: string,
  tempTaskIds: string[]
): Promise<string> {
  const res = await requestJson<Task>(baseUrl, '/api/tasks', {
    method: 'POST',
    token,
    body: {
      title,
      description: `Descripción temporal para ${title}`,
      assigneeId,
      priority: 'MEDIUM',
      dueDate: '2026-11-28T12:00:00.000Z',
      status: 'TODO',
      subtasks: [`Subtarea ${title}`],
    },
  });
  assert.equal(res.status, 201, `No se pudo crear tarea temporal ${title}`);
  tempTaskIds.push(res.data.id);
  return res.data.id;
}

async function deleteTempTask(
  baseUrl: string,
  token: string,
  taskId: string,
  tempTaskIds: string[]
): Promise<void> {
  const res = await requestJson<{ ok: boolean }>(baseUrl, `/api/tasks/${taskId}`, {
    method: 'DELETE',
    token,
  });
  assert.equal(res.status, 200, `No se pudo eliminar tarea temporal ${taskId}`);
  const idx = tempTaskIds.indexOf(taskId);
  if (idx >= 0) tempTaskIds.splice(idx, 1);
}

function connectSocket(baseUrl: string, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createSocketClient(baseUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 5000,
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Timeout conectando Socket.IO'));
    }, 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(err);
    });
  });
}

function waitForEvent<T = unknown>(
  socket: Socket,
  eventName: string,
  predicate: (payload: T) => boolean = () => true,
  timeoutMs = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timeout esperando evento ${eventName}`));
    }, timeoutMs);
    const handler = (payload: T) => {
      if (predicate(payload)) {
        clearTimeout(timer);
        socket.off(eventName, handler);
        resolve(payload);
      }
    };
    socket.on(eventName, handler);
  });
}

function assertNoDriveSecretsExposed(
  payload: unknown,
  internalDriveIds: string[],
  context: string
): void {
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes('"driveFileId"'), `${context}: no debe exponer driveFileId`);
  assert.ok(!serialized.includes('"driveFolderId"'), `${context}: no debe exponer driveFolderId`);
  assert.ok(
    !serialized.includes('"driveWebViewLink"'),
    `${context}: no debe exponer driveWebViewLink`
  );
  assert.ok(
    !serialized.includes('drive.google.com'),
    `${context}: no debe exponer enlaces directos de Google Drive`
  );
  for (const id of internalDriveIds) {
    if (id) {
      assert.ok(
        !serialized.includes(id),
        `${context}: no debe filtrar ID interno de Drive (${id})`
      );
    }
  }
}

function createSamplePdf(repetitions = 120): Buffer {
  const repeatedText = 'Resumen academico Kanban maestria optimizacion almacenamiento '.repeat(
    repetitions
  );
  return Buffer.from(
    `%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${repeatedText}\n%%EOF\n`,
    'utf8'
  );
}

function createBomPrefixedPdf(): Buffer {
  return Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n', 'utf8'),
  ]);
}

function createMinimalOoxml(markerDir: 'word/' | 'ppt/' | 'xl/'): Buffer {
  const header = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const body = Buffer.from(
    `[Content_Types].xml\0${markerDir}document.xml\0contenido_ooxml_test`,
    'utf8'
  );
  return Buffer.concat([header, body]);
}

function createMinimalPng(): Buffer {
  return Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
    'hex'
  );
}

function createMinimalJpg(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const initialBlobCount = await prisma.attachmentBlob.count();
  const initialBlobAgg = await prisma.attachmentBlob.aggregate({
    _sum: { storedBytes: true },
  });
  const initialDbUsedBytes = initialBlobAgg._sum.storedBytes ?? 0;
  const initialAttachmentCount = await prisma.taskAttachment.count();

  const sentEmails: AttachmentEmailPayload[] = [];
  const driveState = createInMemoryDriveState();

  setGoogleDriveAdapterForTests(driveState.adapter);
  setMailDispatcherForTests(async (payload) => {
    sentEmails.push(payload);
    return { sent: true, provider: 'gmail_api' };
  });

  const { httpServer, io } = createServer();
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });

  const address = httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`[test:attachments] Servidor temporal escuchando en ${baseUrl}`);

  const sockets: Socket[] = [];
  const tempTaskIds: string[] = [];
  let liderToken = '';

  let passed = 0;
  const check = (label: string, fn: () => void) => {
    fn();
    passed += 1;
    console.log(`  [OK] ${label}`);
  };

  try {
    const teamCredential = getTestUserPassword();
    const lider = await login(baseUrl, 'lider', teamCredential);
    const m1 = await login(baseUrl, 'integrante1', teamCredential);
    const m2 = await login(baseUrl, 'integrante2', teamCredential);
    liderToken = lider.token;

    const liderSocket = await connectSocket(baseUrl, lider.token);
    sockets.push(liderSocket);

    const pdfBuffer = createSamplePdf();
    const pptxBuffer = createMinimalOoxml('ppt/');
    const docxBuffer = createMinimalOoxml('word/');
    const pngBuffer = createMinimalPng();
    const jpgBuffer = createMinimalJpg();
    const bomPdfBuffer = createBomPrefixedPdf();

    // =========================================================================
    // BLOQUE 1 — Modo Google Drive Privado + Gmail HTTPS mockeado
    // =========================================================================
    console.log('\n[test:attachments] Bloque 1: Google Drive Privado + Gmail REST API HTTPS');

    const taskAId = await createTempTask(
      baseUrl,
      lider.token,
      '__TEST__ Drive Adjuntos Tarea A',
      m1.userId,
      tempTaskIds
    );
    const taskBId = await createTempTask(
      baseUrl,
      lider.token,
      '__TEST__ Drive Adjuntos Tarea B',
      m2.userId,
      tempTaskIds
    );

    // 1.1 Validación de formatos, firmas binarias, tamaño máximo y RBAC
    const badSvg = await uploadMultipart(
      baseUrl,
      `/api/tasks/${taskAId}/attachments`,
      m1.token,
      'vector.svg',
      'image/svg+xml',
      Buffer.from('<svg></svg>', 'utf8')
    );
    const spoofedPdf = await uploadMultipart(
      baseUrl,
      `/api/tasks/${taskAId}/attachments`,
      m1.token,
      'falso.pdf',
      'application/pdf',
      Buffer.from('MZ\x90\x00ESTE_NO_ES_PDF', 'latin1')
    );
    const spoofedPptx = await uploadMultipart(
      baseUrl,
      `/api/tasks/${taskAId}/attachments`,
      m1.token,
      'falso.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x41, 0x42, 0x43])
    );
    const tooLarge = await uploadMultipart(
      baseUrl,
      `/api/tasks/${taskAId}/attachments`,
      m1.token,
      'enorme.pdf',
      'application/pdf',
      Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024 + 512, 0x41)])
    );
    const unauthUpload = await uploadMultipart(
      baseUrl,
      `/api/tasks/${taskAId}/attachments`,
      m2.token,
      'entrometido.pdf',
      'application/pdf',
      pdfBuffer
    );

    check(
      'Bloque 1: rechaza .svg, PDF falsificado, PPTX sin firma OOXML, >5 MB (400) y RBAC ajeno (403) sin subir a Drive',
      () => {
        assert.equal(badSvg.status, 400);
        assert.equal(spoofedPdf.status, 400);
        assert.equal(spoofedPptx.status, 400);
        assert.equal(tooLarge.status, 400);
        assert.equal(unauthUpload.status, 403);
        assert.equal(driveState.driveFiles.size, 0);
        assert.equal(driveState.driveFolders.size, 0);
      }
    );

    // 1.2 Primera subida a Tarea A (.pdf) -> crea carpeta en Drive, persiste Task.driveFolderId, 0 blobs en PostgreSQL
    const attCreatedPromise = waitForEvent<{ taskId: string; attachment: TaskAttachment }>(
      liderSocket,
      'attachment:created',
      (e) => e.taskId === taskAId && e.attachment.originalName === 'reporte_final.pdf'
    );
    const uploadPdfRes = await uploadMultipart<AttachmentUploadResponse>(
      baseUrl,
      `/api/tasks/${taskAId}/attachments`,
      m1.token,
      'reporte_final.pdf',
      'application/pdf',
      pdfBuffer
    );
    const attCreatedEvent = await attCreatedPromise;

    const taskAAfterFirst = await prisma.task.findUnique({
      where: { id: taskAId },
      select: { driveFolderId: true },
    });
    const pdfAttDb = await prisma.taskAttachment.findUnique({
      where: { id: uploadPdfRes.data.attachment.id },
      select: {
        storageProvider: true,
        driveFileId: true,
        driveFolderId: true,
        blobSha256: true,
        contentSha256: true,
      },
    });

    // 1.3 Segunda y tercera subida a Tarea A (.pptx y .png) deben reutilizar Task.driveFolderId
    const pptxRes = await uploadMultipart<AttachmentUploadResponse>(
      baseUrl,
      `/api/tasks/${taskAId}/attachments`,
      m1.token,
      'presentacion.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      pptxBuffer
    );
    const pngRes = await uploadMultipart<AttachmentUploadResponse>(
      baseUrl,
      `/api/tasks/${taskAId}/attachments`,
      m1.token,
      'captura.png',
      'image/png',
      pngBuffer
    );

    // 1.4 Subidas a Tarea B (.pdf duplicado de contenido, .docx, .jpg, .pdf con BOM UTF-8)
    const dupDrivePdfRes = await uploadMultipart<AttachmentUploadResponse>(
      baseUrl,
      `/api/tasks/${taskBId}/attachments`,
      m2.token,
      'copia_reporte.pdf',
      'application/pdf',
      pdfBuffer
    );
    const docxRes = await uploadMultipart<AttachmentUploadResponse>(
      baseUrl,
      `/api/tasks/${taskBId}/attachments`,
      m2.token,
      'documento.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      docxBuffer
    );
    const jpgRes = await uploadMultipart<AttachmentUploadResponse>(
      baseUrl,
      `/api/tasks/${taskBId}/attachments`,
      m2.token,
      'foto.jpg',
      'image/jpeg',
      jpgBuffer
    );
    const bomPdfRes = await uploadMultipart<AttachmentUploadResponse>(
      baseUrl,
      `/api/tasks/${taskBId}/attachments`,
      m2.token,
      'con_bom.pdf',
      'application/pdf',
      bomPdfBuffer
    );

    const taskAAfterAll = await prisma.task.findUnique({
      where: { id: taskAId },
      select: { driveFolderId: true },
    });
    const taskBAfterAll = await prisma.task.findUnique({
      where: { id: taskBId },
      select: { driveFolderId: true },
    });
    const blobsAfterDriveUploads = await prisma.attachmentBlob.count();
    const listTaskARes = await requestJson<TaskAttachment[]>(
      baseUrl,
      `/api/tasks/${taskAId}/attachments`,
      { token: m1.token }
    );
    const detailTaskARes = await requestJson<TaskDetail>(baseUrl, `/api/tasks/${taskAId}`, {
      token: m1.token,
    });
    const taskADbRows = await prisma.taskAttachment.findMany({
      where: { taskId: taskAId },
      select: { id: true, driveFileId: true, driveFolderId: true },
    });
    const taskBDbRows = await prisma.taskAttachment.findMany({
      where: { taskId: taskBId },
      select: { id: true, driveFileId: true, driveFolderId: true },
    });

    const knownDriveIds = [
      taskAAfterAll?.driveFolderId ?? '',
      taskBAfterAll?.driveFolderId ?? '',
      ...taskADbRows.map((r) => r.driveFileId ?? ''),
      ...taskBDbRows.map((r) => r.driveFileId ?? ''),
    ];

    check(
      'Bloque 1: sube .pdf/.pptx/.docx/.png/.jpg/PDF-BOM a Drive con 0 bytes en PostgreSQL, reutiliza driveFolderId, oculta IDs de Drive en HTTP y dispara Gmail mock',
      () => {
        assert.equal(uploadPdfRes.status, 201);
        assert.equal(uploadPdfRes.data.storageProvider, 'gdrive');
        assert.equal(uploadPdfRes.data.emailSent, true);
        assert.equal(uploadPdfRes.data.emailProvider, 'gmail_api');
        assert.equal(uploadPdfRes.data.attachment.storageProvider, 'gdrive');
        assert.equal(uploadPdfRes.data.attachment.storedBytes, 0);
        assert.equal(uploadPdfRes.data.attachment.isCompressed, false);
        assert.equal(uploadPdfRes.data.attachment.blobSha256, null);
        assert.equal(uploadPdfRes.data.attachment.contentSha256, sha256Hex(pdfBuffer));

        assert.equal(pptxRes.status, 201);
        assert.equal(pptxRes.data.storageProvider, 'gdrive');
        assert.equal(pptxRes.data.attachment.storedBytes, 0);
        assert.equal(pngRes.status, 201);
        assert.equal(pngRes.data.attachment.isPreviewableImage, true);
        assert.equal(dupDrivePdfRes.status, 201);
        assert.equal(dupDrivePdfRes.data.storageProvider, 'gdrive');
        assert.equal(docxRes.status, 201);
        assert.equal(jpgRes.status, 201);
        assert.equal(bomPdfRes.status, 201);

        assert.equal(blobsAfterDriveUploads, initialBlobCount);
        assert.ok(taskAAfterFirst?.driveFolderId);
        assert.equal(taskAAfterAll?.driveFolderId, taskAAfterFirst?.driveFolderId);
        assert.ok(taskBAfterAll?.driveFolderId);
        assert.notEqual(taskBAfterAll?.driveFolderId, taskAAfterFirst?.driveFolderId);

        assert.equal(pdfAttDb?.storageProvider, 'gdrive');
        assert.ok(pdfAttDb?.driveFileId);
        assert.equal(pdfAttDb?.driveFolderId, taskAAfterFirst?.driveFolderId);
        assert.equal(pdfAttDb?.blobSha256, null);
        assert.equal(pdfAttDb?.contentSha256, sha256Hex(pdfBuffer));

        // Verifica que la segunda subida a Tarea A reutilizó el folderId conocido
        assert.equal(driveState.knownFolderIdsReceived[1], taskAAfterFirst?.driveFolderId);
        assert.equal(driveState.knownFolderIdsReceived[2], taskAAfterFirst?.driveFolderId);
        assert.equal(driveState.driveFolders.size, 2);
        assert.equal(driveState.driveFiles.size, 7);

        // Verifica que POST, GET /attachments, GET /tasks/:id y Socket.IO NO exponen IDs/URLs de Drive
        assert.equal(listTaskARes.status, 200);
        assert.equal(listTaskARes.data.length, 3);
        assert.equal(detailTaskARes.status, 200);
        assert.equal(detailTaskARes.data.attachmentCount, 3);
        assertNoDriveSecretsExposed(uploadPdfRes.data, knownDriveIds, 'POST /attachments');
        assertNoDriveSecretsExposed(attCreatedEvent, knownDriveIds, 'Socket attachment:created');
        assertNoDriveSecretsExposed(listTaskARes.data, knownDriveIds, 'GET /attachments');
        assertNoDriveSecretsExposed(detailTaskARes.data, knownDriveIds, 'GET /tasks/:id');

        // Verifica correos enviados vía Gmail API mockeado
        assert.equal(sentEmails.length, 7);
        const firstEmail = sentEmails[0];
        const firstDriveRecord = driveState.driveFiles.get(pdfAttDb?.driveFileId ?? '');
        assert.ok(firstDriveRecord);
        assert.equal(firstEmail.uploader.displayName, m1.displayName);
        assert.equal(firstEmail.attachment.originalName, 'reporte_final.pdf');
        assert.equal(firstEmail.driveWebViewLink, firstDriveRecord.webViewLink);
        assert.ok(firstEmail.buffer.equals(pdfBuffer));
      }
    );

    // 1.5 Descarga proxy JWT + Content-Disposition seguro + ETag 304 sin re-descargar de Drive
    const callsBeforePdfDl = driveState.downloadCalls;
    const dlPdf = await fetch(
      `${baseUrl}/api/attachments/${uploadPdfRes.data.attachment.id}/download?inline=1`,
      {
        headers: { Authorization: `Bearer ${m1.token}` },
      }
    );
    const dlPdfBuf = Buffer.from(await dlPdf.arrayBuffer());
    const etagPdf = dlPdf.headers.get('etag');
    const callsAfterPdfDl = driveState.downloadCalls;

    const dlPdf304 = await fetch(
      `${baseUrl}/api/attachments/${uploadPdfRes.data.attachment.id}/download`,
      {
        headers: {
          Authorization: `Bearer ${m1.token}`,
          ...(etagPdf ? { 'If-None-Match': etagPdf } : {}),
        },
      }
    );
    const callsAfter304 = driveState.downloadCalls;

    const dlPngInline = await fetch(
      `${baseUrl}/api/attachments/${pngRes.data.attachment.id}/download?inline=1`,
      {
        headers: { Authorization: `Bearer ${m1.token}` },
      }
    );
    const dlPngBuf = Buffer.from(await dlPngInline.arrayBuffer());

    const storageDriveRes = await requestJson<AttachmentStorageStats>(
      baseUrl,
      '/api/attachments/storage',
      { token: m1.token }
    );

    check(
      'Bloque 1: descarga proxy JWT entrega bytes exactos, Content-Disposition seguro, 304 sin re-descargar de Drive y /storage reporta gdrive',
      () => {
        assert.equal(dlPdf.status, 200);
        assert.ok(dlPdfBuf.equals(pdfBuffer));
        assert.ok((dlPdf.headers.get('content-disposition') ?? '').startsWith('attachment;'));
        assert.ok(etagPdf);
        assert.equal(callsAfterPdfDl, callsBeforePdfDl + 1);

        assert.equal(dlPdf304.status, 304);
        assert.equal(callsAfter304, callsAfterPdfDl);

        assert.equal(dlPngInline.status, 200);
        assert.ok(dlPngBuf.equals(pngBuffer));
        assert.ok((dlPngInline.headers.get('content-disposition') ?? '').startsWith('inline;'));

        assert.equal(storageDriveRes.status, 200);
        assert.equal(storageDriveRes.data.storageMode, 'gdrive');
        assert.equal(storageDriveRes.data.usedBytes - initialDbUsedBytes, 0);
        assert.ok(storageDriveRes.data.driveAttachments >= 7);
        assert.ok(storageDriveRes.data.driveLogicalBytes > 0);
        assert.equal(storageDriveRes.data.driveQuotaBytes, DRIVE_QUOTA_BYTES);
        assert.ok(
          storageDriveRes.data.driveUsedBytes !== null && storageDriveRes.data.driveUsedBytes > 0
        );
        assert.ok(storageDriveRes.data.savedBytes >= storageDriveRes.data.driveLogicalBytes);
      }
    );

    // 1.6 Eliminación RBAC, eliminación de archivo único y eliminación de tarea completa en Drive
    const pdfDriveId = pdfAttDb?.driveFileId ?? '';
    const forbiddenDel = await requestJson(
      baseUrl,
      `/api/attachments/${uploadPdfRes.data.attachment.id}`,
      { method: 'DELETE', token: m2.token }
    );
    assert.equal(forbiddenDel.status, 403);
    assert.ok(driveState.driveFiles.has(pdfDriveId));

    const delPdfA = await requestJson<DeleteAttachmentResponse>(
      baseUrl,
      `/api/attachments/${uploadPdfRes.data.attachment.id}`,
      { method: 'DELETE', token: m1.token }
    );

    const remainingTaskAFileIds = taskADbRows
      .map((r) => r.driveFileId ?? '')
      .filter((id) => id && id !== pdfDriveId);
    const taskAFolderId = taskAAfterAll?.driveFolderId ?? '';

    await deleteTempTask(baseUrl, lider.token, taskAId, tempTaskIds);

    const taskBFileIds = taskBDbRows.map((r) => r.driveFileId ?? '').filter(Boolean);
    const taskBFolderId = taskBAfterAll?.driveFolderId ?? '';

    await deleteTempTask(baseUrl, lider.token, taskBId, tempTaskIds);

    check(
      'Bloque 1: eliminación respeta RBAC, borra archivo único en Drive y DELETE /tasks/:id limpia archivos restantes y carpeta',
      () => {
        assert.equal(delPdfA.status, 200);
        assert.equal(delPdfA.data.removedBlob, false);
        assert.equal(delPdfA.data.removedFromDrive, true);
        assert.ok(driveState.deletedFiles.includes(pdfDriveId));
        assert.ok(!driveState.driveFiles.has(pdfDriveId));

        for (const id of remainingTaskAFileIds) {
          assert.ok(driveState.deletedFiles.includes(id));
          assert.ok(!driveState.driveFiles.has(id));
        }
        assert.ok(driveState.deletedFolders.includes(taskAFolderId));
        assert.ok(!driveState.driveFolders.has(taskAFolderId));

        for (const id of taskBFileIds) {
          assert.ok(driveState.deletedFiles.includes(id));
          assert.ok(!driveState.driveFiles.has(id));
        }
        assert.ok(driveState.deletedFolders.includes(taskBFolderId));
        assert.ok(!driveState.driveFolders.has(taskBFolderId));

        assert.equal(driveState.driveFiles.size, 0);
        assert.equal(driveState.driveFolders.size, 0);
      }
    );

    // 1.7 Compensación ante error DB / límite > 10 adjuntos por actividad
    const taskLimitId = await createTempTask(
      baseUrl,
      lider.token,
      '__TEST__ Drive Limite y Compensacion',
      lider.userId,
      tempTaskIds
    );

    for (let i = 1; i <= 9; i++) {
      const res = await uploadMultipart<AttachmentUploadResponse>(
        baseUrl,
        `/api/tasks/${taskLimitId}/attachments`,
        lider.token,
        `limite_${i}.png`,
        'image/png',
        pngBuffer
      );
      assert.equal(res.status, 201, `Falló subida ${i}/9 en prueba de límite`);
    }

    let raceTriggered = false;
    let tenthUploadRes: HttpResult<AttachmentUploadResponse> | null = null;
    driveState.onBeforeUpload = async (input) => {
      if (
        input.taskId === taskLimitId &&
        input.originalName === 'carrera_limite.png' &&
        !raceTriggered
      ) {
        raceTriggered = true;
        tenthUploadRes = await uploadMultipart<AttachmentUploadResponse>(
          baseUrl,
          `/api/tasks/${taskLimitId}/attachments`,
          lider.token,
          'limite_10.png',
          'image/png',
          pngBuffer
        );
      }
    };

    const deletedBeforeRace = driveState.deletedFiles.length;
    const raceLimitRes = await uploadMultipart(
      baseUrl,
      `/api/tasks/${taskLimitId}/attachments`,
      lider.token,
      'carrera_limite.png',
      'image/png',
      pngBuffer
    );
    driveState.onBeforeUpload = undefined;

    const seq11Res = await uploadMultipart(
      baseUrl,
      `/api/tasks/${taskLimitId}/attachments`,
      lider.token,
      'limite_11.png',
      'image/png',
      pngBuffer
    );

    const limitDbRows = await prisma.taskAttachment.findMany({
      where: { taskId: taskLimitId },
      select: { driveFileId: true },
    });
    const limitDriveFiles = Array.from(driveState.driveFiles.values()).filter(
      (f) => f.taskId === taskLimitId
    );
    const limitDbFileIdSet = new Set(
      limitDbRows.map((row) => row.driveFileId).filter((id): id is string => Boolean(id))
    );

    await deleteTempTask(baseUrl, lider.token, taskLimitId, tempTaskIds);

    check(
      'Bloque 1: compensación ante límite >10 archivos / error transacción DB evita archivos huérfanos en Drive',
      () => {
        assert.equal(raceTriggered, true);
        assert.equal(tenthUploadRes?.status, 201);
        assert.equal(raceLimitRes.status, 400);
        assert.equal(seq11Res.status, 400);
        assert.ok(driveState.deletedFiles.length > deletedBeforeRace);
        assert.equal(limitDbRows.length, 10);
        assert.equal(limitDriveFiles.length, 10);
        for (const driveFile of limitDriveFiles) {
          assert.ok(limitDbFileIdSet.has(driveFile.fileId));
        }
        assert.equal(driveState.driveFiles.size, 0);
        assert.equal(driveState.driveFolders.size, 0);
      }
    );

    // =========================================================================
    // BLOQUE 2 — Retrocompatibilidad / Fallback DB sin Google Drive
    // =========================================================================
    console.log('\n[test:attachments] Bloque 2: Retrocompatibilidad / Fallback DB (sin Drive)');

    let fallbackDriveCalls = 0;
    setGoogleDriveAdapterForTests({
      isEnabled: () => false,
      uploadFile: async () => {
        fallbackDriveCalls += 1;
        throw new Error('uploadFile no debe invocarse cuando Drive está deshabilitado');
      },
      downloadFile: async () => {
        fallbackDriveCalls += 1;
        throw new Error('downloadFile no debe invocarse cuando Drive está deshabilitado');
      },
      deleteFile: async () => {
        fallbackDriveCalls += 1;
        throw new Error('deleteFile no debe invocarse cuando Drive está deshabilitado');
      },
      deleteFolder: async () => {
        fallbackDriveCalls += 1;
        throw new Error('deleteFolder no debe invocarse cuando Drive está deshabilitado');
      },
      getStorageQuota: async () => {
        fallbackDriveCalls += 1;
        return null;
      },
    });

    const dbEmailsStartIdx = sentEmails.length;
    setMailDispatcherForTests(async (payload) => {
      sentEmails.push(payload);
      return { sent: true, provider: 'smtp' };
    });

    const taskDbAId = await createTempTask(
      baseUrl,
      lider.token,
      '__TEST__ DB Fallback Tarea A',
      m1.userId,
      tempTaskIds
    );
    const taskDbBId = await createTempTask(
      baseUrl,
      lider.token,
      '__TEST__ DB Fallback Tarea B',
      m2.userId,
      tempTaskIds
    );

    // 2.1 Subida compresible con gzip a PostgreSQL
    const dbPdfRes = await uploadMultipart<AttachmentUploadResponse>(
      baseUrl,
      `/api/tasks/${taskDbAId}/attachments`,
      m1.token,
      'db_reporte.pdf',
      'application/pdf',
      pdfBuffer
    );

    // 2.2 Deduplicación SHA-256 en PostgreSQL (mismo contenido en otra tarea)
    const dbDupPdfRes = await uploadMultipart<AttachmentUploadResponse>(
      baseUrl,
      `/api/tasks/${taskDbBId}/attachments`,
      m2.token,
      'copia_db_reporte.pdf',
      'application/pdf',
      pdfBuffer
    );
    const blobsAfterDbDup = await prisma.attachmentBlob.count();

    // 2.3 Subida de imagen en modo DB
    const dbPngRes = await uploadMultipart<AttachmentUploadResponse>(
      baseUrl,
      `/api/tasks/${taskDbAId}/attachments`,
      m1.token,
      'db_captura.png',
      'image/png',
      pngBuffer
    );

    check(
      'Bloque 2: guarda en AttachmentBlob con gzip + deduplicación SHA-256 sin invocar Google Drive',
      () => {
        assert.equal(dbPdfRes.status, 201);
        assert.equal(dbPdfRes.data.storageProvider, 'db');
        assert.equal(dbPdfRes.data.deduplicated, false);
        assert.equal(dbPdfRes.data.emailSent, true);
        assert.equal(dbPdfRes.data.attachment.storageProvider, 'db');
        assert.equal(dbPdfRes.data.attachment.isCompressed, true);
        assert.ok(
          dbPdfRes.data.attachment.storedBytes > 0 &&
            dbPdfRes.data.attachment.storedBytes < dbPdfRes.data.attachment.sizeBytes
        );
        assert.equal(dbPdfRes.data.attachment.blobSha256, sha256Hex(pdfBuffer));
        assert.equal(dbPdfRes.data.attachment.contentSha256, sha256Hex(pdfBuffer));

        assert.equal(dbDupPdfRes.status, 201);
        assert.equal(dbDupPdfRes.data.storageProvider, 'db');
        assert.equal(dbDupPdfRes.data.deduplicated, true);
        assert.equal(dbDupPdfRes.data.attachment.blobSha256, dbPdfRes.data.attachment.blobSha256);
        assert.equal(blobsAfterDbDup, initialBlobCount + 1);

        assert.equal(dbPngRes.status, 201);
        assert.equal(dbPngRes.data.storageProvider, 'db');
        assert.equal(dbPngRes.data.attachment.isPreviewableImage, true);
        assert.equal(sentEmails.length, dbEmailsStartIdx + 3);
        assert.equal(sentEmails[dbEmailsStartIdx].uploader.displayName, m1.displayName);
        assert.ok(sentEmails[dbEmailsStartIdx].buffer.equals(pdfBuffer));
      }
    );

    // 2.4 Descarga descomprimida, ETag 304 y /api/attachments/storage en modo DB
    const dlDbPdf = await fetch(
      `${baseUrl}/api/attachments/${dbPdfRes.data.attachment.id}/download?inline=1`,
      {
        headers: { Authorization: `Bearer ${m1.token}` },
      }
    );
    const dlDbPdfBuf = Buffer.from(await dlDbPdf.arrayBuffer());
    const etagDbPdf = dlDbPdf.headers.get('etag');

    const dlDbPdf304 = await fetch(
      `${baseUrl}/api/attachments/${dbPdfRes.data.attachment.id}/download`,
      {
        headers: {
          Authorization: `Bearer ${m1.token}`,
          ...(etagDbPdf ? { 'If-None-Match': etagDbPdf } : {}),
        },
      }
    );

    const dbStorageRes = await requestJson<AttachmentStorageStats>(
      baseUrl,
      '/api/attachments/storage',
      { token: m1.token }
    );

    check('Bloque 2: descarga descomprime bytes exactos, aplica ETag 304 y /storage reporta db', () => {
      assert.equal(dlDbPdf.status, 200);
      assert.ok(dlDbPdfBuf.equals(pdfBuffer));
      assert.ok((dlDbPdf.headers.get('content-disposition') ?? '').startsWith('attachment;'));
      assert.equal(dlDbPdf304.status, 304);
      assert.equal(dbStorageRes.status, 200);
      assert.equal(dbStorageRes.data.storageMode, 'db');
      assert.ok(dbStorageRes.data.usedBytes > initialDbUsedBytes);
      assert.ok(dbStorageRes.data.logicalBytes > dbStorageRes.data.usedBytes);
      assert.ok(dbStorageRes.data.savedBytes > 0);
    });

    // 2.5 Eliminación y garbage collection de AttachmentBlob
    const delDbPdfA = await requestJson<DeleteAttachmentResponse>(
      baseUrl,
      `/api/attachments/${dbPdfRes.data.attachment.id}`,
      { method: 'DELETE', token: m1.token }
    );
    const delDbPngA = await requestJson<DeleteAttachmentResponse>(
      baseUrl,
      `/api/attachments/${dbPngRes.data.attachment.id}`,
      { method: 'DELETE', token: m1.token }
    );

    await deleteTempTask(baseUrl, lider.token, taskDbBId, tempTaskIds);
    await deleteTempTask(baseUrl, lider.token, taskDbAId, tempTaskIds);

    const finalBlobCount = await prisma.attachmentBlob.count();
    const finalAttachmentCount = await prisma.taskAttachment.count();

    check(
      'Bloque 2: limpieza de AttachmentBlob deja finalBlobCount === initialBlobCount y finalAttachmentCount === initialAttachmentCount',
      () => {
        assert.equal(delDbPdfA.status, 200);
        assert.equal(delDbPdfA.data.removedBlob, false);
        assert.equal(delDbPngA.status, 200);
        assert.equal(delDbPngA.data.removedBlob, true);
        assert.ok(delDbPngA.data.freedBytes > 0);
        assert.equal(finalBlobCount, initialBlobCount);
        assert.equal(finalAttachmentCount, initialAttachmentCount);
        assert.equal(fallbackDriveCalls, 0);
      }
    );

    // =========================================================================
    // BLOQUE OPCIONAL — Verificación real de transporte de correo
    // =========================================================================
    if (process.env.VERIFY_SMTP === '1') {
      const mailOk = await verifyMailConnection();
      const smtpOk = mailOk ? true : await verifySmtpConnection();
      check('Transporte de correo verificado (Gmail REST API OAuth2 / respaldo SMTP)', () => {
        assert.equal(mailOk || smtpOk, true);
      });
    }

    console.log(`\n[test:attachments] TODOS LOS CHECKS PASARON (${passed}/${passed}).`);
  } finally {
    try {
      for (const id of [...tempTaskIds]) {
        if (liderToken) {
          await requestJson(baseUrl, `/api/tasks/${id}`, {
            method: 'DELETE',
            token: liderToken,
          }).catch(() => undefined);
        }
      }
    } finally {
      setGoogleDriveAdapterForTests(null);
      setMailDispatcherForTests(null);
    }

    await prisma.activityLog
      .deleteMany({
        where: { createdAt: { gte: startedAt } },
      })
      .catch(() => undefined);

    for (const s of sockets) {
      s.disconnect();
    }

    await new Promise<void>((resolve) => {
      io.close(() => resolve());
    });
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[test:attachments] ERROR:', err);
  process.exitCode = 1;
});
