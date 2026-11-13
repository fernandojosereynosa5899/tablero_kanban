# Diseño: Ventana de Mantenimiento y Flujo Push-First en Render

**Fecha:** 2026-11-13  
**Estado:** Aprobado por el usuario (tablero activo tras el push inicial; triple control por `maintenance.json` + env `MAINTENANCE_MODE` + botón en vivo exclusivo para Líder; activar ventana de mantenimiento en el primer push antes de cada cambio futuro)

## 1. Objetivo
Evitar que el equipo vea errores sueltos, fallos de red o `Cannot GET /` mientras se despliegan cambios o se aplican mejoras en Render:
1. Mostrar una **página / pantalla de mantenimiento profesional** con auto-verificación periódica (`10–20s`) y reanudación automática en cuanto concluya el mantenimiento.
2. Permitir activación inmediata por **tres canales** con precedencia determinística (`env` → `maintenance.json` → `database` en vivo por Líder).
3. Mantener `/api/health` siempre en HTTP `200 OK` (agregando `maintenance: boolean`) para que Render no considere fallido el despliegue ni reinicie el contenedor en bucle.

## 2. Precedencia de Activación
1. **Variable de entorno Render (`MAINTENANCE_MODE=true`)**: fuerza el estado desde configuración de servidor (`source: 'env'`, `canDisableInApp: false`). Soporta `MAINTENANCE_TITLE`, `MAINTENANCE_MESSAGE`, `MAINTENANCE_ETA_MINUTES`.
2. **Archivo rastreado en repositorio (`maintenance.json`)**: permite que cualquier push previo con `"enabled": true` active la ventana de mantenimiento automáticamente en Render (`source: 'file'`, `canDisableInApp: false`). Su estado por defecto al cerrar cambios es `"enabled": false`.
3. **Estado en PostgreSQL (`SystemConfig`, fila `key = "global"`)**: control en tiempo real desde la interfaz web exclusivo para **Líder** (`PATCH /api/maintenance`, `source: 'database'`, `canDisableInApp: true`), sincronizado por Socket.IO (`maintenance:updated`).

## 3. Comportamiento por Tipo de Cliente y Ruta
- **`GET /api/health`**: responde siempre HTTP `200` (mientras la BD responda) con `{ status: 'ok', db: true, maintenance, time }`.
- **`GET /api/maintenance/status`**: endpoint público de solo lectura con `{ active, source, canDisableInApp, title, message, estimatedMinutes, updatedByName, updatedAt }`.
- **`PATCH /api/maintenance`**: exclusivo para **Líder** (`requireAuth` + `requireLeader`), permite activar/desactivar mantenimiento en BD y emite `maintenance:updated`.
- **`POST /api/auth/login` y rutas REST `/api/*`**: durante mantenimiento, bloquean con HTTP `503` a `MEMBER` y `SUBLEADER` (y peticiones anónimas), mientras permiten autenticar/operar al `LEADER` para que nunca quede bloqueado.
- **Peticiones HTML del navegador (`GET /`, rutas SPA)** durante mantenimiento: Express responde HTTP `503 Service Unavailable` (`Retry-After: 30`, `Cache-Control: no-store`) con una página HTML autónoma compatible con CSP (`<meta http-equiv="refresh" content="20" />` + `/maintenance-client.js` servido desde `'self'`), que incluye auto-recarga al terminar el mantenimiento y un acceso discreto solo para el **Líder** para iniciar sesión o finalizar mantenimiento de BD.
- **Socket.IO**: rechaza nuevos handshakes de `MEMBER`/`SUBLEADER` con `Error('maintenance')` durante mantenimiento (sin cerrar su sesión JWT); cuando el Líder activa mantenimiento en vivo, emite `maintenance:updated` para mostrar `<MaintenanceScreen />` al instante en el navegador de los integrantes, mientras el Líder ve una barra superior para desactivarlo.

## 4. Flujo operativo para cambios futuros
Antes de implementar o subir cambios funcionales futuros a `main`:
1. Primer push: cambiar `maintenance.json` a `"enabled": true` con mensaje descriptivo y ejecutar `git push origin main`.
2. Desarrollar, compilar y probar los cambios localmente.
3. Push final: restaurar `"enabled": false` en `maintenance.json` junto con la entrega verificada y volver a subir a `main`.
