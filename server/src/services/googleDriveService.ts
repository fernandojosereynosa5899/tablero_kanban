import crypto from 'node:crypto';
import { config } from '../config';
import { HttpError } from '../utils/errors';
import { fetchWithGoogleAuth, isGoogleOAuthConfigured } from './googleAuthService';

export interface DriveUploadInput {
  taskId: string;
  taskTitle: string;
  knownFolderId?: string | null;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  uploaderName: string;
  uploaderUsername: string;
}

export interface DriveUploadResult {
  fileId: string;
  folderId: string;
  webViewLink: string | null;
  sizeBytes: number;
}

export interface DriveQuotaInfo {
  limitBytes: number | null;
  usageBytes: number;
  usageInDriveBytes: number;
  userEmail: string | null;
}

export interface GoogleDriveAdapter {
  isEnabled(): boolean;
  uploadFile(input: DriveUploadInput): Promise<DriveUploadResult>;
  downloadFile(fileId: string): Promise<Buffer>;
  deleteFile(fileId: string): Promise<void>;
  deleteFolder(folderId: string): Promise<void>;
  getStorageQuota(): Promise<DriveQuotaInfo | null>;
}

const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_ABOUT_API = 'https://www.googleapis.com/drive/v3/about';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const QUOTA_CACHE_TTL_MS = 30_000;

interface DriveFileResource {
  id?: string;
  name?: string;
  size?: string;
  webViewLink?: string;
  parents?: string[];
}

interface DriveListResponse {
  files?: DriveFileResource[];
}

interface DriveAboutResponse {
  user?: {
    emailAddress?: string;
    displayName?: string;
  };
  storageQuota?: {
    limit?: string;
    usage?: string;
    usageInDrive?: string;
  };
}

let customTestAdapter: GoogleDriveAdapter | null = null;
let cachedRootFolderId: string | null = null;
let inFlightRootPromise: Promise<string> | null = null;
const taskFolderCache = new Map<string, string>();
const inFlightTaskFolders = new Map<string, Promise<string>>();
let cachedQuota: { value: DriveQuotaInfo; fetchedAtMs: number } | null = null;
let inFlightQuotaPromise: Promise<DriveQuotaInfo | null> | null = null;

function clearDriveCaches(): void {
  cachedRootFolderId = null;
  inFlightRootPromise = null;
  taskFolderCache.clear();
  inFlightTaskFolders.clear();
  cachedQuota = null;
  inFlightQuotaPromise = null;
}

/** Configura un adaptador mock de Google Drive para pruebas automatizadas. */
export function setGoogleDriveAdapterForTests(adapter: GoogleDriveAdapter | null): void {
  customTestAdapter = adapter;
  clearDriveCaches();
}

/** Indica si el almacenamiento en Google Drive está habilitado y configurado. */
export function isGoogleDriveEnabled(): boolean {
  if (customTestAdapter) {
    return customTestAdapter.isEnabled();
  }
  return isGoogleOAuthConfigured();
}

function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function sanitizeDriveName(raw: string, maxLength = 72): string {
  const cleaned = raw
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f/\\<>:"|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const sliced = cleaned.slice(0, maxLength).trim();
  return sliced || 'Actividad';
}

function sanitizeDriveFileName(raw: string): string {
  const cleaned = raw
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f/\\]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 180).trim() || 'archivo';
}

async function readDriveErrorDetail(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '');
  if (!raw) return `HTTP ${response.status}`;

  try {
    const parsed = JSON.parse(raw) as { error?: { message?: unknown } | unknown };
    if (
      parsed.error &&
      typeof parsed.error === 'object' &&
      'message' in parsed.error &&
      typeof parsed.error.message === 'string' &&
      parsed.error.message.trim()
    ) {
      return `HTTP ${response.status}: ${parsed.error.message.trim()}`;
    }
  } catch {
    // Respuesta no JSON
  }

  return `HTTP ${response.status}`;
}

async function findFolderByQuery(query: string): Promise<string | null> {
  const url = `${DRIVE_FILES_API}?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(
    'files(id,name)'
  )}&pageSize=1&spaces=drive`;

  const response = await fetchWithGoogleAuth(url, {
    method: 'GET',
    timeoutMs: 20_000,
  });

  if (!response.ok) {
    const detail = await readDriveErrorDetail(response);
    throw new HttpError(502, `Error al consultar carpetas en Google Drive (${detail})`);
  }

  const data = (await response.json().catch(() => ({}))) as DriveListResponse;
  const firstId = data.files?.[0]?.id?.trim();
  return firstId || null;
}

async function createDriveFolder(
  name: string,
  parentId: string,
  appProperties?: Record<string, string>
): Promise<{ status: number; id: string | null; detail?: string }> {
  const response = await fetchWithGoogleAuth(`${DRIVE_FILES_API}?fields=id,name`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      name,
      mimeType: DRIVE_FOLDER_MIME,
      parents: [parentId],
      ...(appProperties ? { appProperties } : {}),
    }),
    timeoutMs: 20_000,
  });

  if (!response.ok) {
    const detail = await readDriveErrorDetail(response);
    return { status: response.status, id: null, detail };
  }

  const created = (await response.json().catch(() => ({}))) as DriveFileResource;
  return { status: response.status, id: created.id?.trim() || null };
}

async function resolveOrCreateRootFolderId(): Promise<string> {
  const rootName = sanitizeDriveName(config.googleDriveRootFolder || 'Tablero Kanban', 100);
  const query = `name = '${escapeDriveQueryLiteral(
    rootName
  )}' and mimeType = '${DRIVE_FOLDER_MIME}' and 'root' in parents and trashed = false`;

  const existingId = await findFolderByQuery(query);
  if (existingId) {
    cachedRootFolderId = existingId;
    return existingId;
  }

  const created = await createDriveFolder(rootName, 'root');
  if (!created.id) {
    throw new HttpError(
      502,
      `No se pudo crear la carpeta raíz en Google Drive (${created.detail ?? `HTTP ${created.status}`})`
    );
  }

  cachedRootFolderId = created.id;
  return created.id;
}

async function ensureRootFolderId(): Promise<string> {
  if (cachedRootFolderId) {
    return cachedRootFolderId;
  }

  if (!inFlightRootPromise) {
    inFlightRootPromise = resolveOrCreateRootFolderId().finally(() => {
      inFlightRootPromise = null;
    });
  }

  return inFlightRootPromise;
}

async function resolveOrCreateTaskFolderId(taskId: string, taskTitle: string): Promise<string> {
  const folderName = `${sanitizeDriveName(taskTitle, 72)} (${taskId.slice(-6)})`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const rootFolderId = await ensureRootFolderId();
    const query = `name = '${escapeDriveQueryLiteral(
      folderName
    )}' and mimeType = '${DRIVE_FOLDER_MIME}' and '${escapeDriveQueryLiteral(
      rootFolderId
    )}' in parents and trashed = false`;

    const existingId = await findFolderByQuery(query);
    if (existingId) {
      taskFolderCache.set(taskId, existingId);
      return existingId;
    }

    const created = await createDriveFolder(folderName, rootFolderId, {
      kanbanTaskId: taskId,
    });

    if (created.id) {
      taskFolderCache.set(taskId, created.id);
      return created.id;
    }

    // Si la carpeta raíz cacheada ya no existe en Drive, re-resolver raíz y reintentar una vez.
    if (created.status === 404 && attempt === 0) {
      cachedRootFolderId = null;
      continue;
    }

    throw new HttpError(
      502,
      `No se pudo crear la carpeta de la tarea en Google Drive (${created.detail ?? `HTTP ${created.status}`})`
    );
  }

  throw new HttpError(502, 'No se pudo resolver la carpeta de la tarea en Google Drive');
}

async function ensureTaskFolderId(
  taskId: string,
  taskTitle: string,
  knownFolderId?: string | null
): Promise<string> {
  const trimmedKnown = knownFolderId?.trim();
  if (trimmedKnown) {
    taskFolderCache.set(taskId, trimmedKnown);
    return trimmedKnown;
  }

  const cached = taskFolderCache.get(taskId);
  if (cached) {
    return cached;
  }

  let inFlight = inFlightTaskFolders.get(taskId);
  if (!inFlight) {
    inFlight = resolveOrCreateTaskFolderId(taskId, taskTitle).finally(() => {
      inFlightTaskFolders.delete(taskId);
    });
    inFlightTaskFolders.set(taskId, inFlight);
  }

  return inFlight;
}

function buildDriveMultipartBody(
  input: DriveUploadInput,
  folderId: string
): { boundary: string; body: Uint8Array } {
  const boundary = `kanban_${crypto.randomUUID().replace(/-/g, '')}`;
  const safeFileName = sanitizeDriveFileName(input.originalName);

  const metadata = {
    name: safeFileName,
    parents: [folderId],
    description: `Subido por ${input.uploaderName} (@${input.uploaderUsername}) en tarea ${input.taskId}`,
    appProperties: {
      kanbanTaskId: input.taskId,
      uploaderUsername: input.uploaderUsername.slice(0, 64),
    },
  };

  const preamble = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${input.mimeType || 'application/octet-stream'}\r\n\r\n`,
    'utf8'
  );
  const epilogue = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const combined = Buffer.concat([preamble, input.buffer, epilogue]);

  return {
    boundary,
    body: new Uint8Array(combined),
  };
}

async function performDriveMultipartUpload(
  input: DriveUploadInput,
  folderId: string
): Promise<{ status: number; data?: DriveFileResource; detail?: string }> {
  const { boundary, body } = buildDriveMultipartBody(input, folderId);
  const url = `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=${encodeURIComponent(
    'id,name,size,webViewLink,parents'
  )}`;

  const response = await fetchWithGoogleAuth(url, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
    timeoutMs: 60_000,
  });

  if (!response.ok) {
    const detail = await readDriveErrorDetail(response);
    return { status: response.status, detail };
  }

  const data = (await response.json().catch(() => ({}))) as DriveFileResource;
  return { status: response.status, data };
}

/**
 * Sube un archivo adjunto a la subcarpeta privada de la tarea en Google Drive.
 * Reutiliza `knownFolderId` cuando existe y se recupera automáticamente ante 404.
 */
export async function uploadAttachmentToDrive(
  input: DriveUploadInput
): Promise<DriveUploadResult> {
  if (customTestAdapter) {
    return customTestAdapter.uploadFile(input);
  }

  let folderId = await ensureTaskFolderId(input.taskId, input.taskTitle, input.knownFolderId);
  let uploadAttempt = await performDriveMultipartUpload(input, folderId);

  if (uploadAttempt.status === 404) {
    taskFolderCache.delete(input.taskId);
    folderId = await ensureTaskFolderId(input.taskId, input.taskTitle, null);
    uploadAttempt = await performDriveMultipartUpload(input, folderId);
  }

  if (!uploadAttempt.data?.id) {
    throw new HttpError(
      502,
      `No se pudo subir el archivo a Google Drive (${uploadAttempt.detail ?? `HTTP ${uploadAttempt.status}`})`
    );
  }

  cachedQuota = null;

  const parsedSize = uploadAttempt.data.size ? Number(uploadAttempt.data.size) : input.buffer.length;
  return {
    fileId: uploadAttempt.data.id,
    folderId: uploadAttempt.data.parents?.[0]?.trim() || folderId,
    webViewLink: uploadAttempt.data.webViewLink?.trim() || null,
    sizeBytes: Number.isFinite(parsedSize) && parsedSize >= 0 ? parsedSize : input.buffer.length,
  };
}

/** Descarga los bytes originales de un archivo almacenado en Google Drive. */
export async function downloadAttachmentFromDrive(fileId: string): Promise<Buffer> {
  if (customTestAdapter) {
    return customTestAdapter.downloadFile(fileId);
  }

  const cleanId = fileId.trim();
  if (!cleanId) {
    throw new HttpError(404, 'El archivo ya no está disponible en Google Drive');
  }

  const url = `${DRIVE_FILES_API}/${encodeURIComponent(cleanId)}?alt=media`;
  const response = await fetchWithGoogleAuth(url, {
    method: 'GET',
    timeoutMs: 60_000,
  });

  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    throw new HttpError(404, 'El archivo ya no está disponible en Google Drive');
  }

  if (!response.ok) {
    const detail = await readDriveErrorDetail(response);
    throw new HttpError(502, `Error al descargar el archivo desde Google Drive (${detail})`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function deleteDriveNodeIdempotent(nodeId: string, label: string): Promise<void> {
  const cleanId = nodeId.trim();
  if (!cleanId) return;

  const url = `${DRIVE_FILES_API}/${encodeURIComponent(cleanId)}`;
  const response = await fetchWithGoogleAuth(url, {
    method: 'DELETE',
    timeoutMs: 20_000,
  });

  if (response.status === 200 || response.status === 204 || response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    cachedQuota = null;
    return;
  }

  const detail = await readDriveErrorDetail(response);
  throw new HttpError(502, `No se pudo eliminar ${label} en Google Drive (${detail})`);
}

/** Elimina de forma idempotente un archivo en Google Drive (404 se considera éxito). */
export async function deleteAttachmentFromDrive(fileId: string): Promise<void> {
  if (customTestAdapter) {
    return customTestAdapter.deleteFile(fileId);
  }
  await deleteDriveNodeIdempotent(fileId, 'el archivo');
}

/** Elimina de forma idempotente la carpeta de una tarea en Google Drive. */
export async function deleteTaskDriveFolder(folderId: string): Promise<void> {
  if (customTestAdapter) {
    return customTestAdapter.deleteFolder(folderId);
  }
  const cleanFolderId = folderId.trim();
  if (!cleanFolderId) return;

  for (const [taskId, cachedId] of taskFolderCache.entries()) {
    if (cachedId === cleanFolderId) {
      taskFolderCache.delete(taskId);
    }
  }
  await deleteDriveNodeIdempotent(cleanFolderId, 'la carpeta de la tarea');
}

async function fetchDriveStorageQuota(): Promise<DriveQuotaInfo | null> {
  try {
    const url = `${DRIVE_ABOUT_API}?fields=${encodeURIComponent('storageQuota,user')}`;
    const response = await fetchWithGoogleAuth(url, {
      method: 'GET',
      timeoutMs: 10_000,
    });

    if (!response.ok) {
      const detail = await readDriveErrorDetail(response);
      console.warn(`[googleDriveService] No se pudo consultar la cuota de Drive (${detail})`);
      return null;
    }

    const data = (await response.json().catch(() => ({}))) as DriveAboutResponse;
    const rawLimit = data.storageQuota?.limit;
    const parsedLimit = rawLimit !== undefined && rawLimit !== null ? Number(rawLimit) : null;
    const limitBytes =
      parsedLimit !== null && Number.isFinite(parsedLimit) && parsedLimit >= 0
        ? parsedLimit
        : null;

    const rawUsage = Number(data.storageQuota?.usage ?? 0);
    const rawUsageInDrive = Number(data.storageQuota?.usageInDrive ?? 0);

    const quota: DriveQuotaInfo = {
      limitBytes,
      usageBytes: Number.isFinite(rawUsage) && rawUsage >= 0 ? rawUsage : 0,
      usageInDriveBytes:
        Number.isFinite(rawUsageInDrive) && rawUsageInDrive >= 0 ? rawUsageInDrive : 0,
      userEmail: data.user?.emailAddress?.trim() || null,
    };

    cachedQuota = {
      value: quota,
      fetchedAtMs: Date.now(),
    };

    return quota;
  } catch (err) {
    console.warn(
      '[googleDriveService] Error al consultar la cuota de Google Drive:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Obtiene el uso y cuota del almacenamiento de Google Drive con caché de 30s.
 * Ante fallos no críticos o si Drive no está configurado devuelve `null`.
 */
export async function getDriveStorageQuota(
  forceRefresh = false
): Promise<DriveQuotaInfo | null> {
  if (customTestAdapter) {
    if (!customTestAdapter.isEnabled()) {
      return null;
    }
    return customTestAdapter.getStorageQuota();
  }

  if (!isGoogleOAuthConfigured()) {
    return null;
  }

  if (
    !forceRefresh &&
    cachedQuota &&
    Date.now() - cachedQuota.fetchedAtMs < QUOTA_CACHE_TTL_MS
  ) {
    return cachedQuota.value;
  }

  if (!inFlightQuotaPromise) {
    inFlightQuotaPromise = fetchDriveStorageQuota().finally(() => {
      inFlightQuotaPromise = null;
    });
  }

  return inFlightQuotaPromise;
}
