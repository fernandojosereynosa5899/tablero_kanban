# Guía de Despliegue en Render — Tablero Kanban Colaborativo

Esta aplicación se despliega como un **Web Service unificado** en Render (Express + Socket.IO + API REST + frontend React compilado en `client/dist`) conectado a una base de datos **PostgreSQL**.

## 1. Requisitos previos
- Repositorio en GitHub conectado a tu cuenta de Render.
- Base de datos PostgreSQL creada en Render (o externa con SSL habilitado).

## 2. Crear la base de datos PostgreSQL en Render
1. En el panel de Render, selecciona **New + → PostgreSQL**.
2. Asigna un nombre (por ejemplo, `tablero-kanban-db`), elige el plan (por ejemplo, **Free**) y la región más cercana.
3. Una vez aprovisionada, copia la **External Database URL** o **Internal Database URL** (si el Web Service está en la misma cuenta y región de Render).
   - Asegúrate de incluir `?sslmode=require` si tu cadena de conexión externa lo requiere.

## 3. Google Drive privado + Gmail REST API (OAuth 2.0) en Render Free

En el plan gratuito de Render existen dos restricciones clave que resuelve la integración OAuth 2.0:

1. **Google Drive privado + Proxy JWT (ahorra la cuota de 1 GB en PostgreSQL):** la base de datos PostgreSQL Free tiene un límite de **1 GB**. Cuando Google OAuth 2.0 está configurado, cada adjunto nuevo se almacena en carpetas privadas de tu Google Drive (`Tablero Kanban/<Actividad>`) con **0 bytes binarios en PostgreSQL** (la BD solo guarda metadatos como `driveFolderId`, `driveFileId` y `contentSha256`). Las descargas y vistas previas pasan por el **Proxy JWT** de Express (`GET /api/attachments/:id/download`) sin exponer enlaces ni IDs de Drive al frontend, con caché `ETag` (`304 Not Modified`) para evitar re-descargar desde Drive y total retrocompatibilidad con adjuntos previos en `AttachmentBlob`.
2. **Gmail REST API v1 sobre HTTPS (`443`):** Render Free bloquea los puertos SMTP salientes (`25`, `465` y `587`). Reutilizando las mismas credenciales OAuth 2.0, el servidor envía los correos con el adjunto y el enlace de respaldo mediante **Gmail REST API v1** sobre **HTTPS puerto `443`**, conservando SMTP únicamente como respaldo en entorno local.

### Cómo generar `GOOGLE_REFRESH_TOKEN` localmente
1. En **Google Cloud Console**, crea o selecciona un proyecto y habilita **Google Drive API** y **Gmail API**.
2. Configura la **Pantalla de consentimiento OAuth** y, si la app está en modo *Prueba (Testing)*, añade la cuenta Google propietaria en *Test users*.
3. Crea un **ID de cliente de OAuth**:
   - **Opción recomendada — App de escritorio (*Desktop app*):** permite el callback loopback local sin configuración extra.
   - **Opción alternativa — Aplicación web (*Web application*):** registra exactamente `http://127.0.0.1:48152/oauth2callback` en *URIs de redireccionamiento autorizados*.
4. Ejecuta el asistente interactivo en tu máquina local:
   ```bash
   npm --prefix server run google:auth
   ```
   El script solicitará `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` (si no están ya en `server/.env`), abrirá el consentimiento con los scopes `drive.file` (`https://www.googleapis.com/auth/drive.file`) y `gmail.send` (`https://www.googleapis.com/auth/gmail.send`), validará la cuota de Drive e imprimirá en consola `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` y `GOOGLE_DRIVE_ROOT_FOLDER`.

## 4. Crear el Web Service (opción Blueprint con `render.yaml`)
1. En Render, selecciona **New + → Blueprint** y conecta este repositorio (`main`).
2. Render detectará automáticamente el archivo [`render.yaml`](./render.yaml) con la configuración:
   - **Runtime**: `node` (`NODE_VERSION=22`)
   - **Build Command**: `npm install && npm run build`
     - Instala dependencias (incluyendo `devDependencies` con `--include=dev` para compilar TypeScript, generar Prisma Client y construir Vite) y genera `server/dist` y `client/dist`.
   - **Start Command**: `npm start`
     - Ejecuta `prisma db push --skip-generate && node dist/prisma/seed.js && node dist/src/index.js`.
   - **Health Check Path**: `/api/health`
3. Cuando Render solicite las variables marcadas con `sync: false`:
   - `DATABASE_URL`: tu cadena de conexión PostgreSQL (`?sslmode=require`).
   - `GOOGLE_CLIENT_ID`: Client ID de OAuth 2.0 (`<TU_CLIENT_ID>`).
   - `GOOGLE_CLIENT_SECRET`: Client Secret de OAuth 2.0 (`<TU_CLIENT_SECRET>`).
   - `GOOGLE_REFRESH_TOKEN`: token obtenido con `npm --prefix server run google:auth` (`<TU_REFRESH_TOKEN>`).
   - `MAIL_NOTIFY_TO`: correo destino que recibirá automáticamente cada archivo subido con el nombre de quien lo subió.
   - *(Respaldo local / opcional)* `SMTP_USER` y `SMTP_PASS`: solo necesarios si no configuras Google OAuth 2.0 y despliegas en un entorno con SMTP saliente permitido.
4. `JWT_SECRET` se generará automáticamente (`generateValue: true`), `GOOGLE_DRIVE_ROOT_FOLDER` quedará en `Tablero Kanban` y `ATTACHMENTS_QUOTA_MB` queda por defecto en `512` MB (para compatibilidad DB o adjuntos legados).

## 5. Alternativa manual (sin Blueprint)
Si creas el servicio manualmente desde **New + → Web Service**:
- **Runtime**: `Node`
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Health Check Path**: `/api/health`
- **Variables de entorno obligatorias / recomendadas en Render Free**:
  - `NODE_VERSION` = `22`
  - `NODE_ENV` = `production`
  - `DATABASE_URL` = `<TU_DATABASE_URL_POSTGRESQL>`
  - `JWT_SECRET` = `<SECRETO_HEX_ALEATORIO_MIN_64_CHARS>`
  - `GOOGLE_CLIENT_ID` = `<TU_CLIENT_ID>`
  - `GOOGLE_CLIENT_SECRET` = `<TU_CLIENT_SECRET>`
  - `GOOGLE_REFRESH_TOKEN` = `<TU_REFRESH_TOKEN>`
  - `GOOGLE_DRIVE_ROOT_FOLDER` = `Tablero Kanban`
  - `MAIL_NOTIFY_TO` = `<CORREO_DESTINO_NOTIFICACIONES>`
  - `ATTACHMENTS_QUOTA_MB` = `512`
- **Variables opcionales de respaldo SMTP (solo local o entornos fuera de Render Free)**:
  - `SMTP_HOST` = `smtp.gmail.com`
  - `SMTP_PORT` = `465`
  - `SMTP_SECURE` = `true`
  - `SMTP_USER` = `<TU_CORREO_GMAIL>`
  - `SMTP_PASS` = `<CLAVE_DE_APLICACION_GMAIL>`

## 6. Base de datos, esquema y seed idempotente al arrancar
Cada vez que inicia el servicio (`npm start` → `npm --prefix server run start:prod`):
1. `prisma db push --skip-generate` sincroniza el esquema Prisma con PostgreSQL sin regenerar el cliente.
2. `node dist/prisma/seed.js` ejecuta el **seed idempotente**:
   - Si la tabla `User` está vacía, crea automáticamente los 6 cupos iniciales (`lider` e `integrante1`..`integrante5`) junto con tareas, subtareas y comentarios de ejemplo.
   - Si ya existen usuarios en la base de datos, omite el seed sin sobrescribir cambios ni datos existentes.
3. `node dist/src/index.js` levanta el servidor unificado escuchando en `process.env.PORT` (por defecto `3000`) sirviendo:
   - API REST bajo `/api/*`
   - Tiempo real Socket.IO bajo `/socket.io` (WebSocket + polling)
   - Assets estáticos y fallback SPA desde `client/dist`

## 7. Verificación post-despliegue
1. Abre `https://<tu-app>.onrender.com/api/health` y confirma respuesta HTTP `200` con JSON:
   ```json
   { "status": "ok", "db": true, "time": "..." }
   ```
2. Abre `https://<tu-app>.onrender.com/` en el navegador, inicia sesión con `lider` o cualquiera de los integrantes iniciales y verifica la etiqueta **En vivo** (conexión Socket.IO activa).
3. Recuerda cambiar las contraseñas iniciales desde **Mi Perfil & Avatar → Cambiar Contraseña** o **Equipo** una vez desplegado en producción.
