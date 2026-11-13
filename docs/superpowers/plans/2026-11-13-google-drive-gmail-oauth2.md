# Plan de Implementación: Google Drive Privado + Gmail REST API (OAuth 2.0)

> **Para agentes implementadores:** Ejecutar cada bloque estrictamente dentro de los archivos asignados a su rol. Prohibido modificar lógica de permisos de tarjetas (`TaskCard.tsx`, `TaskDetailModal.tsx`, reglas RBAC de `moveTask`/`updateSubtask`). Prohibido escribir credenciales o tokens reales en archivos rastreados por Git.

**Goal:** Almacenar los nuevos archivos adjuntos en carpetas privadas del Google Drive del propietario (`Tablero Kanban/<Actividad>`) servidos mediante proxy JWT autenticado en Express, y enviar las notificaciones por correo con el archivo adjunto vía Gmail REST API (HTTPS puerto `443`) reutilizando las mismas credenciales OAuth 2.0.

**Architecture:** Node `fetch` nativo contra Google OAuth 2.0 (`oauth2.googleapis.com/token`), Drive REST API v3 y Gmail REST API v1 (`upload/gmail/v1/users/me/messages/send?uploadType=media` con `Content-Type: message/rfc822` generado con `nodemailer/lib/mail-composer`). Prisma guarda únicamente metadatos de Drive mientras conserva lectura/borrado retrocompatible de `AttachmentBlob`.

---

## Estructura de Archivos (Propiedad por Agente)

### Agente 1 — Schema Prisma + Config + Google OAuth2 / Drive / Gmail + Script CLI
- **Modify:** `server/prisma/schema.prisma`
- **Modify:** `server/src/config.ts`
- **Create:** `server/src/services/googleAuthService.ts`
- **Create:** `server/src/services/googleDriveService.ts`
- **Modify:** `server/src/services/mailService.ts`
- **Create:** `server/scripts/google-oauth-setup.ts`
- **Modify:** `server/package.json` (script `"google:auth": "tsx scripts/google-oauth-setup.ts"`)

### Agente 2 — DTOs + Servicio de Adjuntos + Limpieza en Tareas + Rutas
- **Modify:** `server/src/types/domain.ts`
- **Modify:** `server/src/services/attachmentService.ts`
- **Modify:** `server/src/routes/attachments.ts`
- **Modify:** `server/src/services/taskService.ts` (únicamente limpieza Drive dentro/después de `deleteTask`)

### Agente 3 — Frontend (`TaskAttachmentsSection` + Tipos + Cliente API)
- **Modify:** `client/src/types/kanban.ts`
- **Modify:** `client/src/lib/api.ts`
- **Modify:** `client/src/components/kanban/TaskAttachmentsSection.tsx`

### Agente 4 — Pruebas Automatizadas + Plantillas `.env` + Guías Render / README
- **Modify:** `server/scripts/test-attachments.ts`
- **Modify:** `render.yaml`
- **Modify:** `.env.example`
- **Modify:** `server/.env.example`
- **Modify:** `DESPLIEGUE_RENDER.md`
- **Modify:** `README.md`

---

## Tareas Detalladas e Interfaces

### Task 1 (Agente 1): Schema Prisma, Config, `googleAuthService`, `googleDriveService`, `mailService` y CLI OAuth2

**Files:**
- `server/prisma/schema.prisma`
- `server/src/config.ts`
- `server/src/services/googleAuthService.ts`
- `server/src/services/googleDriveService.ts`
- `server/src/services/mailService.ts`
- `server/scripts/google-oauth-setup.ts`
- `server/package.json`

**Interfaces y Contratos:**
1. **`server/prisma/schema.prisma`**:
   - En `model Task`: agregar `driveFolderId String?`.
   - En `model TaskAttachment`:
     - Cambiar `blobSha256 String` → `blobSha256 String?`.
     - Cambiar `blob AttachmentBlob @relation(...)` → `blob AttachmentBlob? @relation(fields: [blobSha256], references: [sha256], onDelete: Restrict)`.
     - Agregar:
       - `storageProvider String @default("db")`
       - `driveFileId String?`
       - `driveFolderId String?`
       - `contentSha256 String?`
     - Agregar `@@index([driveFileId])`.

2. **`server/src/config.ts`**:
   - Agregar propiedades al objeto `config`:
     - `googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || ''`
     - `googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || ''`
     - `googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN?.trim() || ''`
     - `googleDriveRootFolder: process.env.GOOGLE_DRIVE_ROOT_FOLDER?.trim() || 'Tablero Kanban'`

3. **`server/src/services/googleAuthService.ts`**:
   - `export const GOOGLE_OAUTH_SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/gmail.send'] as const;`
   - `export function isGoogleOAuthConfigured(): boolean`
   - `export function invalidateGoogleAccessToken(): void`
   - `export async function getGoogleAccessToken(forceRefresh?: boolean): Promise<string>`
     - Caché en memoria (`expiresAtMs - 60_000`) + deduplicación *singleflight* (`inFlightRefreshPromise`).
     - `POST https://oauth2.googleapis.com/token` con `client_id`, `client_secret`, `refresh_token`, `grant_type=refresh_token`.
   - `export async function fetchWithGoogleAuth(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response>`
     - Adjunta `Authorization: Bearer <token>`; si responde `401`, invalida caché, refresca una vez y reintenta una vez. Nunca imprime secretos en logs.

4. **`server/src/services/googleDriveService.ts`**:
   - Exportar tipos e interfaces:
     - `DriveUploadInput`: `{ taskId: string; taskTitle: string; knownFolderId?: string | null; originalName: string; mimeType: string; buffer: Buffer; uploaderName: string; uploaderUsername: string }`
     - `DriveUploadResult`: `{ fileId: string; folderId: string; webViewLink: string | null; sizeBytes: number }`
     - `DriveQuotaInfo`: `{ limitBytes: number | null; usageBytes: number; usageInDriveBytes: number; userEmail: string | null }`
     - `GoogleDriveAdapter`: `{ isEnabled(): boolean; uploadFile(input: DriveUploadInput): Promise<DriveUploadResult>; downloadFile(fileId: string): Promise<Buffer>; deleteFile(fileId: string): Promise<void>; deleteFolder(folderId: string): Promise<void>; getStorageQuota(): Promise<DriveQuotaInfo | null> }`
   - Exportar funciones públicas:
     - `setGoogleDriveAdapterForTests(adapter: GoogleDriveAdapter | null): void`
     - `isGoogleDriveEnabled(): boolean`
     - `uploadAttachmentToDrive(input: DriveUploadInput): Promise<DriveUploadResult>`
     - `downloadAttachmentFromDrive(fileId: string): Promise<Buffer>`
     - `deleteAttachmentFromDrive(fileId: string): Promise<void>`
     - `deleteTaskDriveFolder(folderId: string): Promise<void>`
     - `getDriveStorageQuota(forceRefresh?: boolean): Promise<DriveQuotaInfo | null>`
   - Detalles reales Drive API v3:
     - Carpeta raíz = `config.googleDriveRootFolder`; subcarpeta por tarea = `${sanitizeDriveName(taskTitle, 72)} (${taskId.slice(-6)})`, usando `knownFolderId` cuando exista y recuperándose si Drive devuelve `404` creando nueva carpeta. Usar *singleflight* por raíz y por `taskId` para evitar carpetas duplicadas en subidas concurrentes.
     - Upload `multipart/related` a `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,webViewLink,parents`.
     - Download por `GET https://www.googleapis.com/drive/v3/files/:id?alt=media` (`404` → `HttpError(404, 'El archivo ya no está disponible en Google Drive')`).
     - Delete idempotente (`DELETE https://www.googleapis.com/drive/v3/files/:id`, tratando `404` como éxito).
     - Cuota por `GET https://www.googleapis.com/drive/v3/about?fields=storageQuota,user` con caché en memoria de 30s (invalidado en upload/delete).

5. **`server/src/services/mailService.ts`**:
   - Extender `AttachmentEmailPayload` con `driveWebViewLink?: string | null;` y usar `storageProvider: 'gdrive' | 'db'` desde `payload.attachment.storageProvider`.
   - Extender `EmailDispatchResult` con `provider?: 'gmail_api' | 'smtp';`.
   - Mantener `setMailDispatcherForTests` y `verifySmtpConnection`. Exportar también `verifyMailConnection`.
   - Construir MIME RFC 2822 UTF-8 completo mediante `nodemailer/lib/mail-composer` (compartido entre Gmail API y la lógica del mensaje).
   - Flujo en `sendAttachmentNotificationEmail`:
     1. Si `_testDispatcher` está definido → delegar al mock de pruebas.
     2. Validar destinatario (`config.mailNotifyTo || config.smtpUser`).
     3. Si `isGoogleOAuthConfigured()` → enviar por HTTPS `443` usando `fetchWithGoogleAuth('https://www.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', { method: 'POST', headers: { 'Content-Type': 'message/rfc822' }, body: new Uint8Array(mimeBuffer) })` y retornar `{ sent: true, provider: 'gmail_api' }`.
     4. Si no, y existen `config.smtpUser && config.smtpPass` → respaldo SMTP con Nodemailer (`provider: 'smtp'`).
     5. Incluir en el cuerpo del correo (HTML + texto) quién subió el archivo, título y estado de la tarea, tamaño y ubicación (`Google Drive privado` + botón/enlace `driveWebViewLink` cuando exista) además del binario adjunto.

6. **`server/scripts/google-oauth-setup.ts` + `server/package.json`**:
   - Script interactivo CLI (`npm --prefix server run google:auth`) que levanta servidor HTTP loopback en `127.0.0.1:48152` (o `--port` / `GOOGLE_OAUTH_PORT`), genera la URL OAuth2 con `drive.file` + `gmail.send` (`access_type=offline&prompt=consent`), recibe `?code=...`, intercambia tokens en `oauth2.googleapis.com/token`, verifica acceso leyendo `/drive/v3/about?fields=user,storageQuota` e imprime únicamente en consola las líneas listas para pegar en Render y `server/.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`).

**Steps:**
- Leer/reusar estructura actual de `mailService.ts` antes de editarlo.
- Editar `schema.prisma`, `config.ts`, `mailService.ts`, `package.json`; crear `googleAuthService.ts`, `googleDriveService.ts`, `google-oauth-setup.ts`.
- Ejecutar `npx --prefix server prisma generate` y `npx --prefix server tsc --noEmit` para validar tipos tras coordinación con Agente 2 (o primero esperar a que `domain.ts` de Agente 2 esté alineado).

---

### Task 2 (Agente 2): DTOs, `attachmentService.ts`, `routes/attachments.ts` y `taskService.ts`

**Files:**
- `server/src/types/domain.ts`
- `server/src/services/attachmentService.ts`
- `server/src/routes/attachments.ts`
- `server/src/services/taskService.ts`

**Dependency:** Requiere contratos de Task 1 (`googleDriveService.ts`, `mailService.ts`, `schema.prisma`).

**Interfaces y Contratos:**
1. **`server/src/types/domain.ts`**:
   - `export type AttachmentStorageProvider = 'gdrive' | 'db';`
   - En `TaskAttachment`:
     - `storageProvider: AttachmentStorageProvider;`
     - `contentSha256: string;`
     - `blobSha256: string | null;` (reemplaza `blobSha256: string`)
     - `storedBytes: number;` (`0` cuando `storageProvider === 'gdrive'`)
     - `isCompressed: boolean;` (`false` cuando `storageProvider === 'gdrive'`)
     - **NO** exponer `driveFileId` ni URLs de Drive al frontend.
   - En `AttachmentUploadResponse`: añadir `emailProvider?: 'gmail_api' | 'smtp'; storageProvider: AttachmentStorageProvider;`.
   - En `AttachmentStorageStats`:
     ```ts
     export interface AttachmentStorageStats {
       storageMode: 'gdrive' | 'db';
       usedBytes: number;
       logicalBytes: number;
       uniqueBlobs: number;
       totalAttachments: number;
       driveAttachments: number;
       driveLogicalBytes: number;
       dbAttachments: number;
       savedBytes: number;
       quotaBytes: number;
       usageRatio: number;
       driveQuotaBytes: number | null;
       driveUsedBytes: number | null;
       driveUsageRatio: number | null;
     }
     ```
   - Actualizar `AttachmentRecordMeta` (`blob?: { ... } | null`, `storageProvider`, `contentSha256`, `blobSha256: string | null`) y `toAttachmentDTO` de forma segura cuando `row.blob` sea `null`.

2. **`server/src/services/attachmentService.ts`**:
   - En `cleanupOrphanBlobs`: aceptar `(string | null | undefined)[]`, filtrar nulos/vacíos antes de consultar `prisma`.
   - En `getAttachmentStorageStats`: combinar agregados DB (`AttachmentBlob`, `TaskAttachment`) con `getDriveStorageQuota()` (si `isGoogleDriveEnabled()`). `savedBytes` incluye el espacio binario evitado en PostgreSQL por archivos alojados en Drive más el ahorro gzip/dedup de blobs DB legados.
   - En `uploadTaskAttachment`:
     - Validar RBAC, límite `MAX_ATTACHMENTS_PER_TASK` y `validateUploadedFile`.
     - Si `isGoogleDriveEnabled()`:
       1. Subir archivo a Drive mediante `uploadAttachmentToDrive(...)`.
       2. En `prisma.$transaction`: verificar conteo `< MAX_ATTACHMENTS_PER_TASK` (si falla, capturar error y borrar `driveResult.fileId` como compensación), guardar `Task.driveFolderId` si cambió, crear `TaskAttachment` con `storageProvider: 'gdrive'`, `blobSha256: null`, `driveFileId`, `driveFolderId`, `contentSha256`. Registrar `ActivityLog`.
     - Si NO está habilitado Drive: flujo actual deduplicado + gzip en `AttachmentBlob` (`storageProvider: 'db'`).
     - Enviar correo vía `sendAttachmentNotificationEmail({ attachment, task, uploader, buffer, driveWebViewLink })`. Emitir `attachment:created` y `activity:new`.
   - En `getAttachmentBinary(attachmentId, ifNoneMatch?)`:
     - Consultar metadatos primero; calcular `etagKey = row.contentSha256 || row.blobSha256 || row.id` y `etag = \`"\${etagKey}"\``.
     - Si `ifNoneMatch` coincide con `etag` (soportando prefijo `W/`), retornar `{ attachment: dto, buffer: null, etag, notModified: true }` **sin descargar desde Google Drive**.
     - Si no: descargar desde `downloadAttachmentFromDrive(row.driveFileId)` para `'gdrive'` o descomprimir `row.blob` para `'db'`.
   - En `deleteTaskAttachment(actor, attachmentId)`:
     - Verificar RBAC actual (`LEADER`, uploader o asignado a tarea / `TODO_TEAM`).
     - Si es `'gdrive'` y tiene `driveFileId`, llamar `deleteAttachmentFromDrive(row.driveFileId)` (idempotente ante 404).
     - En transacción DB: eliminar `TaskAttachment`, limpiar `cleanupOrphanBlobs`, registrar `ActivityLog`. Retornar `{ ok: true, id, taskId, removedBlob, freedBytes, removedFromDrive }`.

3. **`server/src/routes/attachments.ts`**:
   - Actualizar `GET /:id/download` para pasar `req.header('if-none-match')` a `getAttachmentBinary` y responder `304` inmediato cuando `result.notModified` o `!result.buffer`. Mantener `ETag`, `Cache-Control: private, max-age=3600`, `Content-Disposition` seguro y `X-Content-Type-Options: nosniff`.

4. **`server/src/services/taskService.ts`**:
   - ÚNICAMENTE dentro/alrededor de `deleteTask`: seleccionar también `driveFolderId` en `existing` y `storageProvider`, `driveFileId` en `attachedRows`. Filtrar `blobSha256` nulos para `cleanupOrphanBlobs`. Tras confirmar la transacción, ejecutar limpieza *best-effort* (`Promise.allSettled`) de cada `driveFileId` y de `existing.driveFolderId` en Google Drive. **No tocar** permisos ni funciones `createTask`/`updateTask`/`moveTask`/`updateSubtask`.

---

### Task 3 (Agente 3): Frontend UI y Cliente API

**Files:**
- `client/src/types/kanban.ts`
- `client/src/lib/api.ts`
- `client/src/components/kanban/TaskAttachmentsSection.tsx`

**Steps:**
1. Actualizar `TaskAttachment`, `AttachmentUploadResponse` y `AttachmentStorageStats` en `client/src/types/kanban.ts` con `storageProvider`, `contentSha256`, `blobSha256: string | null`, `emailProvider`, `storageMode`, `driveAttachments`, `driveLogicalBytes`, `driveQuotaBytes`, `driveUsedBytes`, `driveUsageRatio`.
2. Actualizar firma de `api.deleteTaskAttachment` en `client/src/lib/api.ts` para incluir `removedFromDrive?: boolean`.
3. Actualizar `TaskAttachmentsSection.tsx`:
   - Badge de almacenamiento en cabecera:
     - Si `storageStats.storageMode === 'gdrive'`: mostrar cuota de Google Drive cuando `driveUsedBytes != null && driveQuotaBytes != null` (`Drive: X / Y`) o `Google Drive activo`, junto con píldora compacta confirmando `DB: 0 B` (o el uso legado real `formatBytes(storageStats.usedBytes)` si aún hay adjuntos antiguos en PostgreSQL).
     - Si `storageMode === 'db'`: mantener indicador DB existente.
   - Leyenda en dropzone: indicar `"Almacenamiento privado en Google Drive + respaldo al correo por Gmail HTTPS"` cuando `storageMode === 'gdrive'`.
   - En cada archivo listado: si `att.storageProvider === 'gdrive'`, mostrar píldora `Google Drive · 0 B DB`; si es legado `'db'`, mantener `{storedBytes} DB`.
   - En toast al subir/eliminar: mencionar Google Drive y proveedor (`Gmail HTTPS` / `SMTP`) cuando aplique. Mantener visor PDF/Imagen/Texto y modal de confirmación exactamente funcionales.
   - **Prohibido tocar** `TaskCard.tsx`, `TaskDetailModal.tsx` o reglas `Solo lectura`.

---

### Task 4 (Agente 4): Pruebas Automatizadas + Configuración y Documentación Render

**Files:**
- `server/scripts/test-attachments.ts`
- `render.yaml`
- `.env.example`
- `server/.env.example`
- `DESPLIEGUE_RENDER.md`
- `README.md`

**Steps:**
1. Ampliar `server/scripts/test-attachments.ts` (conservando pruebas de formato, RBAC, DB fallback/compatibilidad y limpieza total al finalizar):
   - Escenario A (Modo Drive + Gmail REST API mockeados vía `setGoogleDriveAdapterForTests` + `setMailDispatcherForTests`):
     - Verificar subida de `.pdf`, `.pptx`, `.docx`, `.png`, `.jpg` → `storageProvider === 'gdrive'`, `0` nuevos `AttachmentBlob` en PostgreSQL (`dbBlobsAfter === initialBlobCount`), `Task.driveFolderId` persistido y reutilizado entre archivos de la misma tarea, `TaskAttachment.driveFileId` guardado en DB pero **NO** expuesto en el JSON HTTP público al cliente.
     - Verificar correo disparado con nombre/usuario del uploader, `driveWebViewLink` y binario íntegro.
     - Verificar descarga proxy autenticada JWT (`GET /api/attachments/:id/download?inline=1`) devuelve bytes exactos y `If-None-Match` responde `304` **sin** invocar `adapter.downloadFile` nuevamente.
     - Verificar eliminación de archivo único borra en Drive (`deletedFileIds`) y eliminación de tarea completa limpia los archivos Drive restantes y la subcarpeta de la tarea en Drive.
     - Verificar rollback compensatorio: si falla el límite de adjuntos o creación en DB, no queda archivo huérfano en Drive.
   - Escenario B (Modo DB fallback sin Drive):
     - Desactivar adaptador Drive (`isEnabled() => false`) y comprobar compatibilidad legada (`gzipSync`, deduplicación SHA-256, `AttachmentBlob` cleanup y `/api/attachments/storage`).
2. Actualizar `render.yaml`, `.env.example`, `server/.env.example`, `DESPLIEGUE_RENDER.md` y `README.md` documentando `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_ROOT_FOLDER`, `npm --prefix server run google:auth`, y explicando por qué se usa Gmail REST API HTTPS (`443`) en Render Free. Solo usar marcadores `<...>` cortos (cero secretos reales).

---

## Verification & Review Focus
1. Ejecutar en este orden tras integrar los cambios de todos los agentes:
   - `npx --prefix server prisma db push` (o `generate` + `db push` si PostgreSQL local/remoto está configurado)
   - `npm --prefix server run build`
   - `npm --prefix client run build`
   - `npm --prefix server run db:check`
   - `npm --prefix server test` (`test:auth && test:realtime && test:attachments`)
   - `npx --prefix server tsx scripts/test-prod.ts` y `npx --prefix server tsx scripts/test-security.ts`
2. Verificar con `git diff` y `git grep` que:
   - Ningún archivo de permisos de tarjetas (`TaskCard.tsx`, `TaskDetailModal.tsx`, `moveTask`, `updateSubtask`) fue modificado.
   - Ningún secreto o credencial real quedó en archivos rastreados.
   - No existen enlaces públicos de Google Drive expuestos en DTOs ni respuestas al cliente.
