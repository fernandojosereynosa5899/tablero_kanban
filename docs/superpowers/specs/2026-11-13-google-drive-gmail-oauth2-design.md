# Diseño: Almacenamiento Privado en Google Drive + Envío por Gmail REST API (OAuth 2.0)

**Fecha:** 2026-11-13  
**Estado:** Aprobado por el usuario (Opción 1 Drive privado + Proxy del servidor; Opción 1 Gmail REST API HTTPS 443; permisos de tarjetas sin cambios)

## 1. Contexto y problema
1. **Límite de 1 GB en PostgreSQL (Render)**: Guardar archivos adjuntos como blobs binarios (`bytea`) dentro de `AttachmentBlob` consume rápidamente la cuota gratuita de PostgreSQL.
2. **Bloqueo de SMTP saliente en Render Free**: `smtp.gmail.com:465` falla en producción con `Connection timeout` porque Render bloquea puertos SMTP (`25`, `465`, `587`), dejando únicamente el tráfico HTTPS por el puerto `443`.
3. **Cuenta `@gmail.com` personal en Google Drive**: Las Cuentas de Servicio (*Service Accounts*) tienen `0` bytes de cuota propia en cuentas personales (`403 storageQuotaExceeded`). El flujo **OAuth 2.0** con `refresh_token` de la cuenta propietaria (`fernando.jose.reynosa@gmail.com`) opera directamente sobre sus **15 GB** de Drive y permite enviar correos por HTTPS (`gmail.send`) con las mismas credenciales.

## 2. Decisiones arquitectónicas
1. **Google Drive privado + Proxy autenticado en Express (sin enlaces públicos ni login Google para compañeros)**:
   - Todos los archivos nuevos se suben a carpetas organizadas en el Drive privado del propietario: `<GOOGLE_DRIVE_ROOT_FOLDER>/<Título de Tarea> (<6 últimos chars del id>)` (por defecto raíz `Tablero Kanban`).
   - Los archivos y carpetas permanecen privados usando el alcance mínimo `https://www.googleapis.com/auth/drive.file` (la aplicación solo ve/gestiona los archivos y carpetas creados por ella misma).
   - PostgreSQL almacena únicamente metadatos (`TaskAttachment`: `storageProvider`, `driveFileId`, `driveFolderId`, `contentSha256`, `originalName`, `extension`, `mimeType`, `sizeBytes`; `Task.driveFolderId` para reutilizar la subcarpeta de la actividad).
   - Cuando cualquier integrante autenticado pulsa **Ver** o **Descargar**, Express valida su sesión JWT del tablero (`requireAuth`), verifica `If-None-Match` (`ETag` con respuesta `304` inmediata sin consultar Drive) y descarga/retransmite el binario desde Drive por `GET /api/attachments/:id/download`.
   - Al eliminar un adjunto o eliminar una tarea completa, el servidor elimina también el archivo (y la subcarpeta al borrar la tarea) en Google Drive y limpia los metadatos en PostgreSQL.
   - Se mantiene retrocompatibilidad completa de lectura y borrado para adjuntos legados guardados previamente en `AttachmentBlob` (`storageProvider = 'db'`).
   - Si Google OAuth2 no está configurado (por ejemplo, entorno local sin credenciales), el sistema conserva el almacenamiento deduplicado en PostgreSQL como respaldo.
2. **Gmail REST API v1 sobre HTTPS (`443`) + Nodemailer SMTP como respaldo local**:
   - Al configurarse OAuth 2.0 (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`), `mailService.ts` construye un mensaje RFC 2822 UTF-8 completo mediante `nodemailer/lib/mail-composer` (con nombre/usuario de quien subió el archivo, enlace directo privado a Drive para el propietario y el archivo adjunto binario) y lo envía por HTTPS (`443`) a `POST https://www.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media` (`Content-Type: message/rfc822`, límite 35 MB).
   - Si Google OAuth2 no está configurado y sí existen variables `SMTP_USER` / `SMTP_PASS`, utiliza SMTP como respaldo en desarrollo local.
3. **Zero dependencias pesadas**:
   - Uso directo de `fetch` nativo (Node `>= 20.19` / `22`) contra OAuth2, Drive REST API v3 y Gmail REST API v1 (evita instalar el paquete `googleapis`).
4. **Permisos de tarjetas intactos**:
   - No se modifican las reglas RBAC actuales de `TaskCard.tsx`, `TaskDetailModal.tsx` ni `taskService.ts` respecto a solo lectura, movimiento de tarjetas o subtareas.

## 3. Variables de entorno nuevas
- `GOOGLE_CLIENT_ID`: Client ID de OAuth 2.0 (Google Cloud Console).
- `GOOGLE_CLIENT_SECRET`: Client Secret de OAuth 2.0.
- `GOOGLE_REFRESH_TOKEN`: Refresh Token obtenido una única vez con el script `npm --prefix server run google:auth`.
- `GOOGLE_DRIVE_ROOT_FOLDER`: Nombre de la carpeta raíz en Google Drive (por defecto `Tablero Kanban`).

## 4. Seguridad y pruebas
- El `TaskAttachment` DTO público **no** expone `driveFileId` ni URLs de Drive al frontend del equipo; el enlace de Drive solo viaja en el correo privado hacia `MAIL_NOTIFY_TO`.
- Los tokens de acceso de Google se mantienen exclusivamente en memoria del servidor con caché *singleflight* y reintento automático único tras `401`.
- Pruebas automatizadas mediante adaptador inyectable (`setGoogleDriveAdapterForTests`) y `setMailDispatcherForTests` para validar flujos Drive + Gmail HTTPS + RBAC + ETag 304 + limpieza en borrado de archivo/tarea + compatibilidad DB legada sin depender de red externa en CI/tests.
