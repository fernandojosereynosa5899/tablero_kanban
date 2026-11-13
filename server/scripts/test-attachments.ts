import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import { createServer } from '../src/app';
import { prisma } from '../src/prisma';
import {
  type AttachmentEmailPayload,
  setMailDispatcherForTests,
  verifySmtpConnection,
} from '../src/services/mailService';
import { getTestUserPassword } from './lib/testCredentials';
import type {
  AttachmentStorageStats,
  AttachmentUploadResponse,
  Task,
  TaskAttachment,
  TaskDetail,
} from '../src/types/domain';

interface HttpResult<T = unknown> {
  status: number;
  headers: Headers;
  data: T;
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

function createSamplePdf(repetitions = 120): Buffer {
  const repeatedText = 'Resumen academico Kanban maestria optimizacion almacenamiento '.repeat(repetitions);
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
  // Cabecera ZIP PK\x03\x04 + nombres internos OOXML requeridos para validación de firma binaria
  const header = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const body = Buffer.from(`[Content_Types].xml\0${markerDir}document.xml\0contenido_ooxml_test`, 'utf8');
  return Buffer.concat([header, body]);
}

function createMinimalPng(): Buffer {
  // PNG 1x1 píxel transparente válido
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
  const initialAttachmentCount = await prisma.taskAttachment.count();
  const sentEmails: AttachmentEmailPayload[] = [];

  setMailDispatcherForTests(async (payload) => {
    sentEmails.push(payload);
    return { sent: true };
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

    // 1. Crear 2 tareas temporales: tarea A asignada a integrante1, tarea B asignada a integrante2
    const tARes = await requestJson<Task>(baseUrl, '/api/tasks', {
      method: 'POST',
      token: lider.token,
      body: {
        title: '__TEST__ Adjuntos Tarea A',
        description: 'Tarea temporal A para validar archivos adjuntos',
        assigneeId: m1.userId,
        priority: 'MEDIUM',
        dueDate: '2026-11-28T12:00:00.000Z',
        status: 'TODO',
        subtasks: ['Subtarea adjunto A'],
      },
    });
    assert.equal(tARes.status, 201);
    const taskAId = tARes.data.id;
    tempTaskIds.push(taskAId);

    const tBRes = await requestJson<Task>(baseUrl, '/api/tasks', {
      method: 'POST',
      token: lider.token,
      body: {
        title: '__TEST__ Adjuntos Tarea B',
        description: 'Tarea temporal B para validar RBAC de adjuntos',
        assigneeId: m2.userId,
        priority: 'LOW',
        dueDate: '2026-11-28T12:00:00.000Z',
        status: 'TODO',
        subtasks: ['Subtarea adjunto B'],
      },
    });
    assert.equal(tBRes.status, 201);
    const taskBId = tBRes.data.id;
    tempTaskIds.push(taskBId);

    // 2. Validar rechazo de formatos no permitidos (.svg, .exe) y firmas falsificadas (.pdf con MZ, .pptx genérico sin ppt/)
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

    check('Rechaza .svg, PDF falsificado, PPTX sin firma OOXML y archivos > 5 MB con HTTP 400', () => {
      assert.equal(badSvg.status, 400);
      assert.equal(spoofedPdf.status, 400);
      assert.equal(spoofedPptx.status, 400);
      assert.equal(tooLarge.status, 400);
    });

    // 3. RBAC: integrante2 no puede subir en tarea asignada únicamente a integrante1
    const pdfBuffer = createSamplePdf();
    const unauthUpload = await uploadMultipart(
      baseUrl,
      `/api/tasks/${taskAId}/attachments`,
      m2.token,
      'entrometido.pdf',
      'application/pdf',
      pdfBuffer
    );
    check('RBAC bloquea subida de integrante2 en tarea ajena (403)', () => {
      assert.equal(unauthUpload.status, 403);
    });

    // 4. Subida PDF compresible + evento Socket.IO + email con nombre del uploader + compresión gzip
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
    const attEvent = await attCreatedPromise;

    check('Sube .pdf válido, comprime con gzip en PostgreSQL, emite attachment:created y envía correo con nombre del usuario', () => {
      assert.equal(uploadPdfRes.status, 201);
      assert.equal(uploadPdfRes.data.deduplicated, false);
      assert.equal(uploadPdfRes.data.emailSent, true);
      assert.equal(uploadPdfRes.data.attachment.isCompressed, true);
      assert.ok(uploadPdfRes.data.attachment.storedBytes < uploadPdfRes.data.attachment.sizeBytes);
      assert.equal(attEvent.attachment.id, uploadPdfRes.data.attachment.id);
      assert.equal(sentEmails.length, 1);
      assert.equal(sentEmails[0].uploader.displayName, m1.displayName);
      assert.equal(sentEmails[0].attachment.originalName, 'reporte_final.pdf');
      assert.ok(sentEmails[0].buffer.equals(pdfBuffer));
    });

    // 5. Deduplicación SHA-256 al subir el MISMO archivo en Tarea B por integrante2
    const dupUploadRes = await uploadMultipart<AttachmentUploadResponse>(
      baseUrl,
      `/api/tasks/${taskBId}/attachments`,
      m2.token,
      'copia_reporte.pdf',
      'application/pdf',
      pdfBuffer
    );
    const blobsAfterDup = await prisma.attachmentBlob.count();

    check('Deduplicación SHA-256 reutiliza el blob existente (0 bytes binarios extra en DB)', () => {
      assert.equal(dupUploadRes.status, 201);
      assert.equal(dupUploadRes.data.deduplicated, true);
      assert.equal(
        dupUploadRes.data.attachment.blobSha256,
        uploadPdfRes.data.attachment.blobSha256
      );
      assert.equal(blobsAfterDup, initialBlobCount + 1);
    });

    // 6. Subir .pptx, .docx, .png, .jpg
    const pptxRes = await uploadMultipart<AttachmentUploadResponse>(
      baseUrl,
      `/api/tasks/${taskAId}/attachments`,
      m1.token,
      'presentacion.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      createMinimalOoxml('ppt/')
    );
    const docxRes = await uploadMultipart<AttachmentUploadResponse>(
      baseUrl,
      `/api/tasks/${taskBId}/attachments`,
      m2.token,
      'documento.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      createMinimalOoxml('word/')
    );
    const pngBuffer = createMinimalPng();
    const pngRes = await uploadMultipart<AttachmentUploadResponse>(
      baseUrl,
      `/api/tasks/${taskAId}/attachments`,
      m1.token,
      'captura.png',
      'image/png',
      pngBuffer
    );
    const jpgRes = await uploadMultipart<AttachmentUploadResponse>(
      baseUrl,
      `/api/tasks/${taskAId}/attachments`,
      m1.token,
      'foto.jpg',
      'image/jpeg',
      createMinimalJpg()
    );
    const bomPdfRes = await uploadMultipart<AttachmentUploadResponse>(
      baseUrl,
      `/api/tasks/${taskBId}/attachments`,
      m2.token,
      'con_bom.pdf',
      'application/pdf',
      createBomPrefixedPdf()
    );

    check('Soporta .pptx, .docx, .png, .jpg y .pdf con BOM UTF-8 válidos', () => {
      assert.equal(pptxRes.status, 201);
      assert.equal(docxRes.status, 201);
      assert.equal(pngRes.status, 201);
      assert.equal(jpgRes.status, 201);
      assert.equal(bomPdfRes.status, 201);
      assert.equal(pngRes.data.attachment.isPreviewableImage, true);
      assert.equal(pptxRes.data.attachment.isPreviewableImage, false);
    });

    // 7. Descarga íntegra, Content-Disposition seguro y ETag 304
    const dlPdf = await fetch(
      `${baseUrl}/api/attachments/${uploadPdfRes.data.attachment.id}/download?inline=1`,
      {
        headers: { Authorization: `Bearer ${m1.token}` },
      }
    );
    const dlPdfBuf = Buffer.from(await dlPdf.arrayBuffer());
    const etagPdf = dlPdf.headers.get('etag');

    const dlPdf304 = await fetch(
      `${baseUrl}/api/attachments/${uploadPdfRes.data.attachment.id}/download`,
      {
        headers: {
          Authorization: `Bearer ${m1.token}`,
          ...(etagPdf ? { 'If-None-Match': etagPdf } : {}),
        },
      }
    );

    const dlPngInline = await fetch(
      `${baseUrl}/api/attachments/${pngRes.data.attachment.id}/download?inline=1`,
      {
        headers: { Authorization: `Bearer ${m1.token}` },
      }
    );
    const dlPngBuf = Buffer.from(await dlPngInline.arrayBuffer());

    const detailA = await requestJson<TaskDetail>(baseUrl, `/api/tasks/${taskAId}`, {
      token: m1.token,
    });
    const storageRes = await requestJson<AttachmentStorageStats>(baseUrl, '/api/attachments/storage', {
      token: m1.token,
    });

    check('Descarga descomprime exactamente el binario original, aplica ETag 304, protege Content-Disposition y reporta cuota', () => {
      assert.equal(dlPdf.status, 200);
      assert.ok(dlPdfBuf.equals(pdfBuffer));
      assert.ok((dlPdf.headers.get('content-disposition') ?? '').startsWith('attachment;'));
      assert.equal(dlPdf304.status, 304);
      assert.equal(dlPngInline.status, 200);
      assert.ok(dlPngBuf.equals(pngBuffer));
      assert.ok((dlPngInline.headers.get('content-disposition') ?? '').startsWith('inline;'));
      assert.equal(detailA.status, 200);
      assert.equal(detailA.data.attachments.length, 4);
      assert.equal(detailA.data.attachmentCount, 4);
      assert.equal(storageRes.status, 200);
      assert.ok(storageRes.data.savedBytes > 0);
      assert.ok(storageRes.data.logicalBytes > storageRes.data.storedBytes);
    });

    // 8. Eliminación RBAC + Garbage Collection de blobs huérfanos
    const forbiddenDel = await requestJson(
      baseUrl,
      `/api/attachments/${uploadPdfRes.data.attachment.id}`,
      { method: 'DELETE', token: m2.token }
    );
    assert.equal(forbiddenDel.status, 403);

    // Al borrar PDF de Tarea A, el blob NO se borra aún porque Tarea B sigue referenciándolo
    const delPdfA = await requestJson<{ ok: boolean; removedBlob: boolean; freedBytes: number }>(
      baseUrl,
      `/api/attachments/${uploadPdfRes.data.attachment.id}`,
      { method: 'DELETE', token: m1.token }
    );

    // Al borrar PNG único de Tarea A, el blob SÍ se borra inmediatamente de PostgreSQL
    const delPngA = await requestJson<{ ok: boolean; removedBlob: boolean; freedBytes: number }>(
      baseUrl,
      `/api/attachments/${pngRes.data.attachment.id}`,
      { method: 'DELETE', token: m1.token }
    );

    // Al eliminar Tarea B completa, sus adjuntos (copia_reporte.pdf + documento.docx) y blobs huérfanos se limpian automáticamente
    const delTaskB = await requestJson<{ ok: boolean }>(baseUrl, `/api/tasks/${taskBId}`, {
      method: 'DELETE',
      token: lider.token,
    });
    assert.equal(delTaskB.status, 200);
    tempTaskIds.splice(tempTaskIds.indexOf(taskBId), 1);

    // También eliminar Tarea A
    const delTaskA = await requestJson<{ ok: boolean }>(baseUrl, `/api/tasks/${taskAId}`, {
      method: 'DELETE',
      token: lider.token,
    });
    assert.equal(delTaskA.status, 200);
    tempTaskIds.splice(tempTaskIds.indexOf(taskAId), 1);

    const finalBlobCount = await prisma.attachmentBlob.count();
    const finalAttachmentCount = await prisma.taskAttachment.count();

    check('Eliminación respeta RBAC y limpia blobs huérfanos en PostgreSQL tanto por archivo como al eliminar tarea', () => {
      assert.equal(delPdfA.status, 200);
      assert.equal(delPdfA.data.removedBlob, false);
      assert.equal(delPngA.status, 200);
      assert.equal(delPngA.data.removedBlob, true);
      assert.ok(delPngA.data.freedBytes > 0);
      assert.equal(finalBlobCount, initialBlobCount);
      assert.equal(finalAttachmentCount, initialAttachmentCount);
    });

    if (process.env.VERIFY_SMTP === '1') {
      const smtpOk = await verifySmtpConnection();
      check('Conexión SMTP Gmail verificada con credenciales de server/.env', () => {
        assert.equal(smtpOk, true);
      });
    }

    console.log(`\n[test:attachments] TODOS LOS CHECKS PASARON (${passed}/${passed}).`);
  } finally {
    setMailDispatcherForTests(null);

    for (const id of tempTaskIds) {
      if (liderToken) {
        await requestJson(baseUrl, `/api/tasks/${id}`, {
          method: 'DELETE',
          token: liderToken,
        }).catch(() => undefined);
      }
    }

    await prisma.activityLog.deleteMany({
      where: { createdAt: { gte: startedAt } },
    });

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
