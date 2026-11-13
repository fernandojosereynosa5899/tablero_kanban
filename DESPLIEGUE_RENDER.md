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

## 3. Crear el Web Service (opción Blueprint con `render.yaml`)
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
   - `SMTP_USER`: cuenta de Gmail remitente para enviar notificaciones de archivos adjuntos.
   - `SMTP_PASS`: **Contraseña de aplicación** de 16 caracteres generada en Google Account → Seguridad.
   - `MAIL_NOTIFY_TO`: correo destinatario que recibirá automáticamente cada archivo subido con el nombre de quien lo subió.
4. `JWT_SECRET` se generará automáticamente (`generateValue: true`), y `ATTACHMENTS_QUOTA_MB` queda por defecto en `512` MB (ajustable según tu cuota de PostgreSQL, pensado para proteger planes de 1 GB).

## 4. Alternativa manual (sin Blueprint)
Si creas el servicio manualmente desde **New + → Web Service**:
- **Runtime**: `Node`
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Health Check Path**: `/api/health`
- **Variables de entorno**:
  - `NODE_VERSION` = `22`
  - `NODE_ENV` = `production`
  - `DATABASE_URL` = `<tu-url-de-postgresql>`
  - `JWT_SECRET` = `<secreto-aleatorio-de-64-caracteres-hex>`
  - `SMTP_HOST` = `smtp.gmail.com`
  - `SMTP_PORT` = `465`
  - `SMTP_SECURE` = `true`
  - `SMTP_USER` = `<tu-correo@gmail.com>`
  - `SMTP_PASS` = `<contrasena-de-aplicacion-gmail>`
  - `MAIL_NOTIFY_TO` = `<correo-destino@gmail.com>`
  - `ATTACHMENTS_QUOTA_MB` = `512`

## 5. Base de datos, esquema y seed idempotente al arrancar
Cada vez que inicia el servicio (`npm start` → `npm --prefix server run start:prod`):
1. `prisma db push --skip-generate` sincroniza el esquema Prisma con PostgreSQL sin regenerar el cliente.
2. `node dist/prisma/seed.js` ejecuta el **seed idempotente**:
   - Si la tabla `User` está vacía, crea automáticamente los 6 cupos iniciales (`lider` e `integrante1`..`integrante5`) junto con tareas, subtareas y comentarios de ejemplo.
   - Si ya existen usuarios en la base de datos, omite el seed sin sobrescribir cambios ni datos existentes.
3. `node dist/src/index.js` levanta el servidor unificado escuchando en `process.env.PORT` (por defecto `3000`) sirviendo:
   - API REST bajo `/api/*`
   - Tiempo real Socket.IO bajo `/socket.io` (WebSocket + polling)
   - Assets estáticos y fallback SPA desde `client/dist`

## 6. Verificación post-despliegue
1. Abre `https://<tu-app>.onrender.com/api/health` y confirma respuesta HTTP `200` con JSON:
   ```json
   { "status": "ok", "db": true, "time": "..." }
   ```
2. Abre `https://<tu-app>.onrender.com/` en el navegador, inicia sesión con `lider` o cualquiera de los integrantes iniciales y verifica la etiqueta **En vivo** (conexión Socket.IO activa).
3. Recuerda cambiar las contraseñas iniciales desde **Mi Perfil & Avatar → Cambiar Contraseña** o **Equipo** una vez desplegado en producción.
