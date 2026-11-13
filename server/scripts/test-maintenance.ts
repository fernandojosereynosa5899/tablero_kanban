import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import { createServer } from '../src/app';
import { config } from '../src/config';
import { prisma } from '../src/prisma';
import {
  resetMaintenanceCacheForTests,
  setMaintenanceEnvOverrideForTests,
  setMaintenanceFilePathForTests,
} from '../src/services/maintenanceService';
import type { MaintenanceStatus, Task } from '../src/types/domain';
import { getTestUserPassword } from './lib/testCredentials';

interface HttpResult<T = unknown> {
  status: number;
  headers: Headers;
  data: T;
}

interface RawResponse {
  status: number;
  headers: Headers;
  text: string;
}

interface LoginData {
  token: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    role: string;
  };
}

interface MaintenanceBlockedPayload {
  error: string;
  maintenance: boolean;
  status: MaintenanceStatus;
}

async function requestJson<T = unknown>(
  baseUrl: string,
  reqPath: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {},
): Promise<HttpResult<T>> {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${baseUrl}${reqPath}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  const data = (text ? JSON.parse(text) : null) as T;
  return { status: res.status, headers: res.headers, data };
}

async function requestRaw(baseUrl: string, reqPath: string): Promise<RawResponse> {
  const res = await fetch(`${baseUrl}${reqPath}`);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

async function login(
  baseUrl: string,
  username: string,
  password: string,
): Promise<{ token: string; userId: string; displayName: string; role: string }> {
  const res = await requestJson<LoginData>(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  assert.equal(res.status, 200, `Login falló para ${username}`);
  return {
    token: res.data.token,
    userId: res.data.user.id,
    displayName: res.data.user.displayName,
    role: res.data.user.role,
  };
}

function connectSocket(baseUrl: string, token?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createSocketClient(baseUrl, {
      auth: token ? { token } : undefined,
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 5000,
    });

    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Timeout esperando conexión Socket.IO'));
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
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timeout esperando evento "${eventName}"`));
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

function assertCspSafeMaintenanceHtml(html: string): void {
  const scriptTags = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi));
  assert.ok(scriptTags.length >= 1, 'El HTML de mantenimiento debe referenciar /maintenance-client.js');

  for (const match of scriptTags) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    assert.match(
      attrs,
      /\bsrc=["']\/maintenance-client\.js["']/i,
      'Todo tag <script> debe apuntar a /maintenance-client.js',
    );
    assert.equal(body.trim(), '', 'No se permiten scripts inline en el HTML de mantenimiento');
  }

  assert.equal(
    /<[^>]*\son[a-z]+\s*=/i.test(html),
    false,
    'No se permiten manejadores inline on* en el HTML de mantenimiento',
  );
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const initialSystemConfig = await prisma.systemConfig.findUnique({
    where: { key: 'global' },
  });

  setMaintenanceEnvOverrideForTests(null);
  setMaintenanceFilePathForTests(null);
  resetMaintenanceCacheForTests();

  const { httpServer, io } = createServer();
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });

  const address = httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`[test:maintenance] Servidor temporal escuchando en ${baseUrl}`);

  const sockets: Socket[] = [];
  let tempFilePath: string | null = null;
  let passed = 0;

  const check = (label: string, fn: () => void) => {
    fn();
    passed += 1;
    console.log(`  [OK] ${label}`);
  };

  try {
    const teamCredential = getTestUserPassword();

    // =========================================================================
    // 1. Estado inicial (active: false, source: 'none')
    // =========================================================================
    const initialHealth = await requestJson<{
      status: string;
      db: boolean;
      maintenance: boolean;
      time: string;
    }>(baseUrl, '/api/health');

    const initialStatus = await requestJson<MaintenanceStatus>(baseUrl, '/api/maintenance/status');
    const initialRoot = await requestRaw(baseUrl, '/');
    const initialClientJs = await requestRaw(baseUrl, '/maintenance-client.js');

    const prodIndexPath = path.resolve(__dirname, '../../client/dist/index.html');
    const expectsProdHtml = config.isProd && fs.existsSync(prodIndexPath);

    check(
      '1. Estado inicial (active: false, source: "none"): /api/health 200, /api/maintenance/status 200 y GET / sin bloqueo',
      () => {
        assert.equal(initialHealth.status, 200);
        assert.equal(initialHealth.data.status, 'ok');
        assert.equal(initialHealth.data.db, true);
        assert.equal(initialHealth.data.maintenance, false);
        assert.ok(typeof initialHealth.data.time === 'string');

        assert.equal(initialStatus.status, 200);
        assert.ok((initialStatus.headers.get('cache-control') ?? '').includes('no-store'));
        assert.equal(initialStatus.data.active, false);
        assert.equal(initialStatus.data.source, 'none');
        assert.equal(initialStatus.data.canDisableInApp, true);
        assert.equal(initialStatus.data.estimatedMinutes, null);

        if (expectsProdHtml) {
          assert.equal(initialRoot.status, 200);
        } else {
          assert.notEqual(initialRoot.status, 503);
          assert.equal(initialRoot.headers.get('retry-after'), null);
        }

        assert.equal(initialClientJs.status, 200);
        assert.ok((initialClientJs.headers.get('content-type') ?? '').includes('javascript'));
      },
    );

    // Autenticar cuentas reales del equipo y abrir sockets en vivo antes de activar mantenimiento
    const liderAuth = await login(baseUrl, 'lider', teamCredential);
    const member1Auth = await login(baseUrl, 'integrante1', teamCredential);
    const subleaderAuth = await login(baseUrl, 'integrante5', teamCredential);

    const liderSocket = await connectSocket(baseUrl, liderAuth.token);
    sockets.push(liderSocket);
    const member1Socket = await connectSocket(baseUrl, member1Auth.token);
    sockets.push(member1Socket);

    // =========================================================================
    // 2. Modo Database (LEADER en vivo vía PATCH /api/maintenance)
    // =========================================================================
    const memberPatchRes = await requestJson<{ error: string }>(baseUrl, '/api/maintenance', {
      method: 'PATCH',
      token: member1Auth.token,
      body: {
        enabled: true,
        title: 'Intento sin permiso',
        message: 'Un integrante no puede activar mantenimiento.',
        estimatedMinutes: 5,
      },
    });
    const subleaderPatchRes = await requestJson<{ error: string }>(baseUrl, '/api/maintenance', {
      method: 'PATCH',
      token: subleaderAuth.token,
      body: {
        enabled: true,
        title: 'Intento sublíder',
        message: 'Un sublíder tampoco puede activar mantenimiento.',
        estimatedMinutes: 5,
      },
    });

    check('2a. integrante1 y sublíder reciben HTTP 403 al intentar PATCH /api/maintenance', () => {
      assert.equal(memberPatchRes.status, 403);
      assert.equal(subleaderPatchRes.status, 403);
    });

    const customTitle = 'Mantenimiento programado QA';
    const customMessage =
      'Estamos realizando una actualización controlada en la base de datos y sincronización.';
    const customEta = 12;

    const liderActivatedEvPromise = waitForEvent<MaintenanceStatus>(
      liderSocket,
      'maintenance:updated',
      (payload) =>
        payload.active === true &&
        payload.source === 'database' &&
        payload.title === customTitle,
      5000,
    );
    const memberActivatedEvPromise = waitForEvent<MaintenanceStatus>(
      member1Socket,
      'maintenance:updated',
      (payload) =>
        payload.active === true &&
        payload.source === 'database' &&
        payload.title === customTitle,
      5000,
    );

    const enableRes = await requestJson<MaintenanceStatus>(baseUrl, '/api/maintenance', {
      method: 'PATCH',
      token: liderAuth.token,
      body: {
        enabled: true,
        title: customTitle,
        message: customMessage,
        estimatedMinutes: customEta,
      },
    });

    const [liderActivatedEv, memberActivatedEv] = await Promise.all([
      liderActivatedEvPromise,
      memberActivatedEvPromise,
    ]);

    check(
      '2b. Líder activa mantenimiento en BD (PATCH /api/maintenance -> 200) y emite maintenance:updated',
      () => {
        assert.equal(enableRes.status, 200);
        assert.equal(enableRes.data.active, true);
        assert.equal(enableRes.data.source, 'database');
        assert.equal(enableRes.data.canDisableInApp, true);
        assert.equal(enableRes.data.title, customTitle);
        assert.equal(enableRes.data.message, customMessage);
        assert.equal(enableRes.data.estimatedMinutes, customEta);
        assert.equal(enableRes.data.updatedByName, liderAuth.displayName);
        assert.ok(typeof enableRes.data.updatedAt === 'string' && enableRes.data.updatedAt.length > 0);

        for (const ev of [liderActivatedEv, memberActivatedEv]) {
          assert.equal(ev.active, true);
          assert.equal(ev.source, 'database');
          assert.equal(ev.canDisableInApp, true);
          assert.equal(ev.title, customTitle);
          assert.equal(ev.message, customMessage);
          assert.equal(ev.estimatedMinutes, customEta);
        }
      },
    );

    const healthDuringMaintenance = await requestJson<{
      status: string;
      db: boolean;
      maintenance: boolean;
    }>(baseUrl, '/api/health');

    check('2c. GET /api/health sigue respondiendo HTTP 200 con maintenance: true', () => {
      assert.equal(healthDuringMaintenance.status, 200);
      assert.equal(healthDuringMaintenance.data.status, 'ok');
      assert.equal(healthDuringMaintenance.data.db, true);
      assert.equal(healthDuringMaintenance.data.maintenance, true);
    });

    const htmlDuringMaintenance = await requestRaw(baseUrl, '/');
    const clientJsDuringMaintenance = await requestRaw(baseUrl, '/maintenance-client.js');

    check(
      '2d. GET / responde HTTP 503 HTML CSP-safe con Retry-After: 30 y GET /maintenance-client.js responde 200 JS',
      () => {
        assert.equal(htmlDuringMaintenance.status, 503);
        assert.equal(htmlDuringMaintenance.headers.get('retry-after'), '30');
        assert.ok((htmlDuringMaintenance.headers.get('cache-control') ?? '').includes('no-store'));
        assert.ok((htmlDuringMaintenance.headers.get('content-type') ?? '').includes('text/html'));

        const cspHeader = htmlDuringMaintenance.headers.get('content-security-policy') ?? '';
        assert.ok(cspHeader.includes("script-src 'self'"));

        assert.ok(htmlDuringMaintenance.text.includes(customTitle));
        assert.ok(htmlDuringMaintenance.text.includes(customMessage));
        assert.ok(htmlDuringMaintenance.text.includes(`~${customEta} min`));
        assertCspSafeMaintenanceHtml(htmlDuringMaintenance.text);

        assert.equal(clientJsDuringMaintenance.status, 200);
        assert.ok((clientJsDuringMaintenance.headers.get('content-type') ?? '').includes('javascript'));
        assert.ok(clientJsDuringMaintenance.text.includes('/api/maintenance/status'));
        assert.ok(clientJsDuringMaintenance.text.includes('/api/auth/login'));
        assert.ok(clientJsDuringMaintenance.text.includes('/api/maintenance'));
      },
    );

    const memberLoginBlocked = await requestJson<MaintenanceBlockedPayload>(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'integrante1', password: teamCredential },
    });
    const subleaderLoginBlocked = await requestJson<MaintenanceBlockedPayload>(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'integrante5', password: teamCredential },
    });
    const liderLoginAllowed = await requestJson<LoginData>(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'lider', password: teamCredential },
    });

    check(
      '2e. POST /api/auth/login bloquea con 503 (maintenance: true) a integrante1/sublíder y permite 200 a lider',
      () => {
        assert.equal(memberLoginBlocked.status, 503);
        assert.equal(memberLoginBlocked.headers.get('retry-after'), '30');
        assert.equal(memberLoginBlocked.data.maintenance, true);
        assert.equal(memberLoginBlocked.data.error, customMessage);
        assert.equal(memberLoginBlocked.data.status.active, true);
        assert.equal(memberLoginBlocked.data.status.source, 'database');

        assert.equal(subleaderLoginBlocked.status, 503);
        assert.equal(subleaderLoginBlocked.data.maintenance, true);

        assert.equal(liderLoginAllowed.status, 200);
        assert.ok(typeof liderLoginAllowed.data.token === 'string' && liderLoginAllowed.data.token.length > 20);
        assert.equal(liderLoginAllowed.data.user.role, 'LEADER');
      },
    );

    const memberTasksBlocked = await requestJson<MaintenanceBlockedPayload>(baseUrl, '/api/tasks', {
      token: member1Auth.token,
    });
    const subleaderTasksBlocked = await requestJson<MaintenanceBlockedPayload>(baseUrl, '/api/tasks', {
      token: subleaderAuth.token,
    });
    const liderTasksAllowed = await requestJson<Task[]>(baseUrl, '/api/tasks', {
      token: liderAuth.token,
    });

    check(
      '2f. GET /api/tasks bloquea con 503 (maintenance: true) a integrante1/sublíder y permite 200 a lider',
      () => {
        assert.equal(memberTasksBlocked.status, 503);
        assert.equal(memberTasksBlocked.headers.get('retry-after'), '30');
        assert.equal(memberTasksBlocked.data.maintenance, true);
        assert.equal(memberTasksBlocked.data.status.active, true);

        assert.equal(subleaderTasksBlocked.status, 503);
        assert.equal(subleaderTasksBlocked.data.maintenance, true);

        assert.equal(liderTasksAllowed.status, 200);
        assert.ok(Array.isArray(liderTasksAllowed.data));
      },
    );

    await assert.rejects(
      () => connectSocket(baseUrl, member1Auth.token),
      (err: Error) => err.message === 'maintenance',
    );
    await assert.rejects(
      () => connectSocket(baseUrl, subleaderAuth.token),
      (err: Error) => err.message === 'maintenance',
    );
    const liderReconnectSocket = await connectSocket(baseUrl, liderAuth.token);
    sockets.push(liderReconnectSocket);

    check(
      '2g. Nuevo handshake Socket.IO rechaza a integrante1/sublíder con error "maintenance" y permite conectar a lider',
      () => {
        assert.equal(liderReconnectSocket.connected, true);
      },
    );

    // =========================================================================
    // 3. Precedencia file (maintenance.json) sobre database
    // =========================================================================
    tempFilePath = path.join(
      os.tmpdir(),
      `kanban-maintenance-${Date.now()}-${process.pid}.json`,
    );
    fs.writeFileSync(
      tempFilePath,
      JSON.stringify(
        {
          enabled: true,
          title: 'Deploy en curso',
          message: 'Actualizando servidor',
          estimatedMinutes: 5,
        },
        null,
        2,
      ),
      'utf8',
    );

    setMaintenanceFilePathForTests(tempFilePath);
    resetMaintenanceCacheForTests();

    const fileOverrideStatus = await requestJson<MaintenanceStatus>(baseUrl, '/api/maintenance/status');

    setMaintenanceFilePathForTests(null);
    resetMaintenanceCacheForTests();

    const afterFileRestoreStatus = await requestJson<MaintenanceStatus>(
      baseUrl,
      '/api/maintenance/status',
    );

    check(
      '3. Precedencia file (maintenance.json) supera a database y al restaurar vuelve a database',
      () => {
        assert.equal(fileOverrideStatus.status, 200);
        assert.equal(fileOverrideStatus.data.active, true);
        assert.equal(fileOverrideStatus.data.source, 'file');
        assert.equal(fileOverrideStatus.data.canDisableInApp, false);
        assert.equal(fileOverrideStatus.data.title, 'Deploy en curso');
        assert.equal(fileOverrideStatus.data.message, 'Actualizando servidor');
        assert.equal(fileOverrideStatus.data.estimatedMinutes, 5);

        assert.equal(afterFileRestoreStatus.status, 200);
        assert.equal(afterFileRestoreStatus.data.active, true);
        assert.equal(afterFileRestoreStatus.data.source, 'database');
        assert.equal(afterFileRestoreStatus.data.canDisableInApp, true);
      },
    );

    // =========================================================================
    // 4. Precedencia env (MAINTENANCE_MODE=true) sobre file y database
    // =========================================================================
    setMaintenanceFilePathForTests(tempFilePath);
    setMaintenanceEnvOverrideForTests({
      enabled: true,
      title: 'Mantenimiento Env',
      message: 'Override Render',
      estimatedMinutes: 10,
    });
    resetMaintenanceCacheForTests();

    const envOverrideStatus = await requestJson<MaintenanceStatus>(baseUrl, '/api/maintenance/status');

    setMaintenanceEnvOverrideForTests(null);
    setMaintenanceFilePathForTests(null);
    resetMaintenanceCacheForTests();

    const afterEnvRestoreStatus = await requestJson<MaintenanceStatus>(
      baseUrl,
      '/api/maintenance/status',
    );

    check(
      '4. Precedencia env (MAINTENANCE_MODE=true) supera a file y database; al restaurar vuelve a database',
      () => {
        assert.equal(envOverrideStatus.status, 200);
        assert.equal(envOverrideStatus.data.active, true);
        assert.equal(envOverrideStatus.data.source, 'env');
        assert.equal(envOverrideStatus.data.canDisableInApp, false);
        assert.equal(envOverrideStatus.data.title, 'Mantenimiento Env');
        assert.equal(envOverrideStatus.data.message, 'Override Render');
        assert.equal(envOverrideStatus.data.estimatedMinutes, 10);

        assert.equal(afterEnvRestoreStatus.status, 200);
        assert.equal(afterEnvRestoreStatus.data.active, true);
        assert.equal(afterEnvRestoreStatus.data.source, 'database');
        assert.equal(afterEnvRestoreStatus.data.canDisableInApp, true);
      },
    );

    // =========================================================================
    // 5. Desactivación por Líder (PATCH /api/maintenance { enabled: false })
    // =========================================================================
    const liderDisabledEvPromise = waitForEvent<MaintenanceStatus>(
      liderSocket,
      'maintenance:updated',
      (payload) => payload.active === false && payload.source === 'none',
      5000,
    );
    const memberDisabledEvPromise = waitForEvent<MaintenanceStatus>(
      member1Socket,
      'maintenance:updated',
      (payload) => payload.active === false && payload.source === 'none',
      5000,
    );

    const disableRes = await requestJson<MaintenanceStatus>(baseUrl, '/api/maintenance', {
      method: 'PATCH',
      token: liderAuth.token,
      body: { enabled: false },
    });

    const [liderDisabledEv, memberDisabledEv] = await Promise.all([
      liderDisabledEvPromise,
      memberDisabledEvPromise,
    ]);

    const finalHealth = await requestJson<{
      status: string;
      db: boolean;
      maintenance: boolean;
    }>(baseUrl, '/api/health');
    const memberLoginRestored = await requestJson<LoginData>(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'integrante1', password: teamCredential },
    });
    const memberTasksRestored = await requestJson<Task[]>(baseUrl, '/api/tasks', {
      token: memberLoginRestored.data.token,
    });
    const memberSocketRestored = await connectSocket(baseUrl, memberLoginRestored.data.token);
    sockets.push(memberSocketRestored);

    check(
      '5. Desactivación por Líder emite maintenance:updated (active: false), health -> maintenance: false y restaura acceso a integrante1',
      () => {
        assert.equal(disableRes.status, 200);
        assert.equal(disableRes.data.active, false);
        assert.equal(disableRes.data.source, 'none');
        assert.equal(disableRes.data.canDisableInApp, true);

        assert.equal(liderDisabledEv.active, false);
        assert.equal(liderDisabledEv.source, 'none');
        assert.equal(memberDisabledEv.active, false);
        assert.equal(memberDisabledEv.source, 'none');

        assert.equal(finalHealth.status, 200);
        assert.equal(finalHealth.data.status, 'ok');
        assert.equal(finalHealth.data.db, true);
        assert.equal(finalHealth.data.maintenance, false);

        assert.equal(memberLoginRestored.status, 200);
        assert.ok(
          typeof memberLoginRestored.data.token === 'string' &&
            memberLoginRestored.data.token.length > 20,
        );

        assert.equal(memberTasksRestored.status, 200);
        assert.ok(Array.isArray(memberTasksRestored.data));
        assert.equal(memberSocketRestored.connected, true);
      },
    );

    console.log(`\n[test:maintenance] TODOS LOS CHECKS PASARON (${passed}/${passed}).`);
  } finally {
    setMaintenanceEnvOverrideForTests(null);
    setMaintenanceFilePathForTests(null);
    resetMaintenanceCacheForTests();

    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.rmSync(tempFilePath, { force: true });
    }

    if (initialSystemConfig) {
      await prisma.systemConfig
        .upsert({
          where: { key: 'global' },
          create: {
            key: initialSystemConfig.key,
            maintenanceEnabled: initialSystemConfig.maintenanceEnabled,
            maintenanceTitle: initialSystemConfig.maintenanceTitle,
            maintenanceMessage: initialSystemConfig.maintenanceMessage,
            estimatedMinutes: initialSystemConfig.estimatedMinutes,
            updatedById: initialSystemConfig.updatedById,
            updatedByName: initialSystemConfig.updatedByName,
          },
          update: {
            maintenanceEnabled: initialSystemConfig.maintenanceEnabled,
            maintenanceTitle: initialSystemConfig.maintenanceTitle,
            maintenanceMessage: initialSystemConfig.maintenanceMessage,
            estimatedMinutes: initialSystemConfig.estimatedMinutes,
            updatedById: initialSystemConfig.updatedById,
            updatedByName: initialSystemConfig.updatedByName,
          },
        })
        .catch(() => undefined);
    } else {
      await prisma.systemConfig
        .deleteMany({
          where: { key: 'global' },
        })
        .catch(() => undefined);
    }
    resetMaintenanceCacheForTests();

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
  console.error('[test:maintenance] ERROR:', err);
  process.exitCode = 1;
});
