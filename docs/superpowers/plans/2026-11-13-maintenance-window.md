# Plan de Implementación: Ventana de Mantenimiento

> **Para agentes implementadores:** Respetar estrictamente la propiedad de archivos. Prohibido tocar permisos de tarjetas (`TaskCard.tsx`, `TaskDetailModal.tsx`, `Solo lectura`, `taskService.ts`). Prohibido activar `maintenance.json` en `true` en el commit final (debe quedar `"enabled": false` tras aprobar pruebas).

## Estructura de Archivos (Propiedad por Agente)

### Agente Backend Mantenimiento (`server/` + `maintenance.json`)
- **Create:** `maintenance.json` (`enabled: false`)
- **Modify:** `server/prisma/schema.prisma` (añadir `model SystemConfig`)
- **Modify:** `server/src/config.ts` (`maintenanceMode`, `maintenanceTitle`, `maintenanceMessage`, `maintenanceEtaMinutes`)
- **Modify:** `server/src/types/domain.ts` (`MaintenanceSource`, `MaintenanceStatus`)
- **Modify:** `server/src/realtime/bus.ts` (evento `'maintenance:updated': MaintenanceStatus`)
- **Create:** `server/src/services/maintenanceService.ts`
- **Create:** `server/src/routes/maintenance.ts` (`GET /status`, `PATCH /`)
- **Create:** `server/src/middleware/maintenance.ts` (página HTML autónoma CSP-safe, script `/maintenance-client.js`, guard API `/api/*` con bypass `LEADER`)
- **Modify:** `server/src/routes/health.ts` (incluir `maintenance: boolean`)
- **Modify:** `server/src/routes/auth.ts` (bloquear login de no-Líder durante mantenimiento con HTTP `503`)
- **Modify:** `server/src/realtime/socket.ts` (handshake/move guard durante mantenimiento para no-Líder)
- **Modify:** `server/src/app.ts` (registrar `/maintenance-client.js`, `/api/maintenance`, guards de mantenimiento y fallback seguro en producción)

### Agente Frontend Mantenimiento (`client/`)
- **Modify:** `client/src/types/kanban.ts` (`MaintenanceSource`, `MaintenanceStatus`)
- **Modify:** `client/src/lib/socket.ts` (evento `'maintenance:updated'`)
- **Modify:** `client/src/lib/api.ts` (`getMaintenanceStatus`, `updateMaintenanceStatus`, `setMaintenanceHandler` al recibir HTTP `503 { maintenance: true }`)
- **Modify:** `client/src/context/AuthContext.tsx` (estado `maintenanceStatus`, `refreshMaintenance`, carga en `bootstrap`, escucha socket `'maintenance:updated'` y handler HTTP `503`)
- **Create:** `client/src/components/maintenance/MaintenanceScreen.tsx`
- **Create:** `client/src/components/maintenance/MaintenanceModal.tsx`
- **Modify:** `client/src/components/layout/TopHeader.tsx` (botón `Mantenimiento` exclusivo para `LEADER` con indicador activo)
- **Modify:** `client/src/App.tsx` (mostrar `<MaintenanceScreen />` a no-Líder cuando esté activo, y banner persistente al `LEADER` para reabrir el tablero)

### Agente QA & Documentación (`server/scripts/` + Docs)
- **Create:** `server/scripts/test-maintenance.ts` (pruebas integrales de precedencia `env` > `file` > `database`, HTML `503` + `/maintenance-client.js`, `/api/health` siempre `200`, bloqueo `503` a `MEMBER`/`SUBLEADER` en REST/login/Socket, bypass y toggle `LEADER`, emisión `maintenance:updated` y limpieza completa de `SystemConfig` / `ActivityLog`)
- **Modify:** `server/package.json` (script `"test:maintenance": "tsx scripts/test-maintenance.ts"` integrado en `"test"`)
- **Modify:** `render.yaml`, `.env.example`, `server/.env.example`, `DESPLIEGUE_RENDER.md`, `README.md` (documentar `MAINTENANCE_MODE`, `maintenance.json` y regla operativa de hacer push a mantenimiento primero antes de cada cambio)

---

## Contratos Exactos entre Capas

1. **`MaintenanceStatus` (`server/src/types/domain.ts` & `client/src/types/kanban.ts`):**
```ts
export type MaintenanceSource = 'none' | 'env' | 'file' | 'database';

export interface MaintenanceStatus {
  active: boolean;
  source: MaintenanceSource;
  canDisableInApp: boolean;
  title: string;
  message: string;
  estimatedMinutes: number | null;
  updatedByName: string | null;
  updatedAt: string | null;
}
```

2. **`PATCH /api/maintenance` Payload (validado con Zod):**
```ts
{
  enabled: boolean;
  title?: string; // 3..100 chars
  message?: string; // 5..400 chars
  estimatedMinutes?: number | null; // 1..1440 o null
}
```
Respuesta: `MaintenanceStatus` efectivo actual. Emite `emitEvent('maintenance:updated', effectiveStatus)`.

3. **Respuesta HTTP `503` en API bloqueada:**
```json
{
  "error": "<status.message>",
  "maintenance": true,
  "status": { ...MaintenanceStatus }
}
```

4. **HTML autónomo y `/maintenance-client.js` (CSP strict `'self'`):**
   - HTML sin scripts inline (`helmet` `script-src 'self'`), `<meta http-equiv="refresh" content="20" />` + `<script src="/maintenance-client.js" defer></script>`.
   - `/maintenance-client.js` consulta `GET /api/maintenance/status` cada 10s, recarga al terminar (`active === false`), y gestiona el acordeón **"Acceso exclusivo Líder"** (`POST /api/auth/login` + `PATCH /api/maintenance`).
