import assert from 'node:assert/strict';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import { getTestUserPassword } from './lib/testCredentials';

const PORT = Number(process.env.TEST_ACCOUNTS_PORT || 3108);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ROOT_DIR = path.resolve(__dirname, '../..');

function killProcessTree(child: ChildProcess | null): void {
  if (!child || child.pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // Proceso ya terminado
  }
}

async function waitForHealth(timeoutMs = 35000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.status === 200) {
        const body = (await res.json()) as { status?: string; db?: boolean };
        if (body.status === 'ok' && body.db === true) return;
      }
    } catch {
      // Reintentar
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Servidor no disponible en /api/health tras ${timeoutMs}ms`);
}

async function jsonReq<T>(
  method: string,
  urlPath: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as T) : ({} as T);
  return { status: res.status, data: parsed };
}

const EXPECTED_ACCOUNTS = [
  { username: 'lider', role: 'LEADER', namePrefix: 'Reynosa' },
  { username: 'integrante1', role: 'MEMBER', namePrefix: 'Eunice' },
  { username: 'integrante2', role: 'MEMBER', namePrefix: 'Kuri' },
  { username: 'integrante3', role: 'MEMBER', namePrefix: 'Velazquez' },
  { username: 'integrante4', role: 'MEMBER', namePrefix: 'López' },
  { username: 'integrante5', role: 'SUBLEADER', namePrefix: 'David' },
];

async function main(): Promise<void> {
  console.log(`[test:all-accounts] Iniciando servidor en ${BASE_URL}...`);
  const serverChild = spawn('npm', ['--prefix', 'server', 'run', 'start:prod'], {
    cwd: ROOT_DIR,
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverChild.stdout?.on('data', (d) => process.stdout.write(`[srv:out] ${d}`));
  serverChild.stderr?.on('data', (d) => process.stderr.write(`[srv:err] ${d}`));

  const sockets: Socket[] = [];
  const cleanupTasks: string[] = [];
  let leaderToken = '';

  try {
    await waitForHealth(35000);
    console.log('[test:all-accounts] 1. Servidor saludable en /api/health -> OK');

    // 1. Probar login de las 6 cuentas con la credencial configurada en entorno
    const teamCredential = getTestUserPassword();
    const tokens: Record<string, string> = {};
    for (const acc of EXPECTED_ACCOUNTS) {
      const loginRes = await jsonReq<{
        token: string;
        user: { id: string; username: string; displayName: string; role: string; slot: number };
      }>('POST', '/api/auth/login', undefined, {
        username: acc.username,
        password: teamCredential,
      });

      assert.equal(loginRes.status, 200, `Login de ${acc.username} debe responder 200 con TEST_USER_PASSWORD`);
      assert.ok(loginRes.data.token, `Token JWT no retornado para ${acc.username}`);
      assert.equal(loginRes.data.user.role, acc.role, `Rol incorrecto para ${acc.username}`);
      assert.ok(
        loginRes.data.user.displayName.includes(acc.namePrefix),
        `Nombre no contiene ${acc.namePrefix}: ${loginRes.data.user.displayName}`,
      );

      tokens[acc.username] = loginRes.data.token;
      console.log(`  ✓ Login ${acc.username} (${acc.role}) -> 200 OK [${loginRes.data.user.displayName}]`);
    }
    leaderToken = tokens.lider;

    // 2. Conectar Socket.IO simultáneamente para verificar presencia
    const onlineCheckPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout en presence:update')), 8000);
      let seenLeader = false;
      let seenMember2 = false;

      const s1 = createSocketClient(BASE_URL, {
        auth: { token: tokens.lider },
        transports: ['websocket'],
      });
      const s2 = createSocketClient(BASE_URL, {
        auth: { token: tokens.integrante2 },
        transports: ['websocket'],
      });
      sockets.push(s1, s2);

      s1.on('presence:update', (payload: { onlineUserIds: string[] }) => {
        if (payload.onlineUserIds.length >= 2) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    await onlineCheckPromise;
    console.log('[test:all-accounts] 2. Presencia Socket.IO concurrente para 2+ usuarios -> OK');

    // 3. Crear una tarea de prueba asignada a "Todo el equipo"
    const createShared = await jsonReq<{ id: string; assignedToAll: boolean }>('POST', '/api/tasks', leaderToken, {
      title: '[TEST] Tarea colectiva error-proof',
      description: 'Verificando robustez y permisos',
      priority: 'MEDIUM',
      dueDate: '2026-11-20T12:00:00.000Z',
      assignedToAll: true,
      status: 'TODO',
      subtasks: ['Paso seguro 1', 'Paso seguro 2'],
    });
    assert.equal(createShared.status, 201);
    assert.equal(createShared.data.assignedToAll, true);
    cleanupTasks.push(createShared.data.id);
    const sharedId = createShared.data.id;
    console.log('[test:all-accounts] 3. Tarea colectiva (assignedToAll: true) creada por el Líder -> OK');

    // 4. Cada integrante puede mover la tarea colectiva y comentar
    for (const username of ['integrante1', 'integrante3', 'integrante4', 'integrante5']) {
      const moveRes = await jsonReq<{ task: { status: string } }>(
        'PATCH',
        `/api/tasks/${sharedId}/move`,
        tokens[username],
        { status: 'IN_PROGRESS' },
      );
      assert.equal(moveRes.status, 200, `${username} debe poder mover tarea colectiva`);

      const commentRes = await jsonReq<{ id: string }>(
        'POST',
        `/api/tasks/${sharedId}/comments`,
        tokens[username],
        { content: `Nota de verificación por ${username}` },
      );
      assert.equal(commentRes.status, 201, `${username} debe poder comentar tarea colectiva`);
    }
    console.log('[test:all-accounts] 4. Integrantes mueven y comentan tarea colectiva -> OK');

    // 5. David Alejandro (integrante5, SUBLEADER) crea una tarea pero no puede aprobarla
    const subCreate = await jsonReq<{ id: string; status: string }>('POST', '/api/tasks', tokens.integrante5, {
      title: '[TEST] Tarea de David Alejandro',
      description: 'Sublíder agregando actividad',
      priority: 'LOW',
      dueDate: '2026-12-01T12:00:00.000Z',
      assignedToAll: true,
      status: 'TODO',
      subtasks: ['Paso inicial sublíder'],
    });
    assert.equal(subCreate.status, 201, 'Sublíder puede crear tareas');
    cleanupTasks.push(subCreate.data.id);

    const subApproveFail = await jsonReq('PATCH', `/api/tasks/${subCreate.data.id}/move`, tokens.integrante5, {
      status: 'APPROVED',
    });
    assert.equal(subApproveFail.status, 403, 'Sublíder no debe poder aprobar tareas en APROBADO');
    console.log('[test:all-accounts] 5. Permisos de Sublíder (David Alejandro) verificados -> OK');

    // 6. Prueba anti-errores: Fechas fuera de rango (antes del 07/11/2026 o después del 19/12/2026) son rechazadas
    const badDate1 = await jsonReq('POST', '/api/tasks', leaderToken, {
      title: 'Fecha inválida previa',
      description: 'Validación de fecha fuera de rango mínimo',
      priority: 'LOW',
      dueDate: '2026-10-15T12:00:00.000Z',
      assignedToAll: true,
      status: 'TODO',
      subtasks: ['Verificar rango'],
    });
    assert.equal(badDate1.status, 400, 'Fecha previa al 07/11/2026 debe ser rechazada con 400');

    const badDate2 = await jsonReq('POST', '/api/tasks', leaderToken, {
      title: 'Fecha inválida posterior',
      description: 'Validación de fecha fuera de rango máximo',
      priority: 'LOW',
      dueDate: '2026-12-25T12:00:00.000Z',
      assignedToAll: true,
      status: 'TODO',
      subtasks: ['Verificar rango'],
    });
    assert.equal(badDate2.status, 400, 'Fecha posterior al 19/12/2026 debe ser rechazada con 400');
    console.log('[test:all-accounts] 6. Validación a prueba de errores de rango de fechas -> OK');

    // 7. Prueba anti-manipulación Kuri: Intento de borrado no autorizado bloqueado con mensaje personalizado
    const kuriDel = await jsonReq<{ error: string }>('DELETE', `/api/tasks/${sharedId}`, tokens.integrante2);
    assert.equal(kuriDel.status, 403);
    assert.ok(kuriDel.data.error.includes('Oye Kuri'), `Mensaje debe avisar a Kuri: ${kuriDel.data.error}`);
    console.log('[test:all-accounts] 7. Mensaje anti-manipulación de Kuri en 403 -> OK');

    console.log('[test:all-accounts] ¡TODAS LAS 7 PRUEBAS DE INTEGRACIÓN Y SEGURIDAD PASARON!');
  } finally {
    for (const s of sockets) s.disconnect();
    if (leaderToken && cleanupTasks.length > 0) {
      for (const tId of cleanupTasks) {
        await jsonReq('DELETE', `/api/tasks/${tId}`, leaderToken).catch(() => {});
      }
    }
    killProcessTree(serverChild);
  }
}

main().catch((err) => {
  console.error('[test:all-accounts] FALLÓ:', err);
  process.exit(1);
});
