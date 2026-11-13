import assert from 'node:assert/strict';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import { generateEphemeralSecret, getTestUserPassword } from './lib/testCredentials';

const PORT = Number(process.env.SECURITY_TEST_PORT || 3103);
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
    // El proceso pudo haber terminado ya
  }
}

async function waitForHealth(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.status === 200) {
        const body = (await res.json()) as { status?: string; db?: boolean };
        if (body.status === 'ok' && body.db === true) return;
      }
    } catch {
      // Seguir esperando
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`El servidor de prueba no respondió /api/health en ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  console.log(`[test:security] Levantando servidor unificado en ${BASE_URL}...`);
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

  const testStart = new Date();
  let kuriSocket: Socket | null = null;
  let kuriUserId: string | null = null;

  try {
    await waitForHealth(35000);

    // 1. Verificar headers de ciberseguridad (Helmet + CSP + Permissions-Policy + sin X-Powered-By)
    const rootRes = await fetch(`${BASE_URL}/`);
    assert.equal(rootRes.status, 200);
    assert.equal(rootRes.headers.get('x-frame-options'), 'DENY');
    assert.equal(rootRes.headers.get('x-powered-by'), null);
    assert.equal(rootRes.headers.get('cross-origin-resource-policy'), 'same-origin');
    const csp = rootRes.headers.get('content-security-policy') || '';
    assert.ok(csp.includes("default-src 'self'"), `CSP faltante default-src: ${csp}`);
    assert.ok(csp.includes("object-src 'none'"), `CSP faltante object-src: ${csp}`);
    assert.ok(csp.includes("frame-ancestors 'none'"), `CSP faltante frame-ancestors: ${csp}`);
    assert.ok((rootRes.headers.get('permissions-policy') || '').includes('camera=()'));
    console.log('[test:security] 1. Headers HTTP + CSP + X-Frame-Options DENY -> OK');

    // 2. Verificar CORS estricto: bloquea origen malicioso y permite Render
    const allowedCors = await fetch(`${BASE_URL}/api/health`, {
      headers: { Origin: 'https://tablero-kanban.onrender.com' },
    });
    assert.equal(allowedCors.headers.get('access-control-allow-origin'), 'https://tablero-kanban.onrender.com');

    const blockedCors = await fetch(`${BASE_URL}/api/health`, {
      headers: { Origin: 'https://evil-attacker.example' },
    });
    assert.equal(blockedCors.headers.get('access-control-allow-origin'), null);
    console.log('[test:security] 2. CORS estricto bloquea origen no autorizado -> OK');

    // 3. Login como Kuri (integrante2) y validar firma JWT HS256 / rechazo de alg=none
    const teamCredential = getTestUserPassword();
    const kuriLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'integrante2', password: teamCredential }),
    });
    assert.equal(kuriLoginRes.status, 200, 'Login de Kuri (integrante2) debe responder 200');
    const kuriAuth = (await kuriLoginRes.json()) as {
      token: string;
      user: { id: string; username: string; displayName: string; role: string };
    };
    kuriUserId = kuriAuth.user.id;
    assert.ok(kuriAuth.user.displayName.toLowerCase().includes('kuri'));

    const fakeAlgNoneToken = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ sub: kuriUserId, role: 'LEADER', tv: 0, iss: 'tablero-kanban', aud: 'tablero-kanban-app' }),
    ).toString('base64url')}.`;
    const forgedRes = await fetch(`${BASE_URL}/api/users/me`, {
      headers: { Authorization: `Bearer ${fakeAlgNoneToken}` },
    });
    assert.equal(forgedRes.status, 401, 'Token JWT sin firma (alg=none) debe ser rechazado con 401');
    console.log('[test:security] 3. JWT HS256 estricto rechaza token forjado alg=none -> 401 OK');

    // 4. Validación estricta de ID de parámetro + sanitización anti-prototype pollution
    const badIdRes = await fetch(`${BASE_URL}/api/tasks/id$malicioso!`, {
      headers: { Authorization: `Bearer ${kuriAuth.token}` },
    });
    assert.equal(badIdRes.status, 400);

    const reportRes = await fetch(`${BASE_URL}/api/security/report`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kuriAuth.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventType: 'devtools_opened',
        detail: 'Prueba F12\u0000',
        __proto__: { isAdmin: true },
      }),
    });
    assert.equal(reportRes.status, 200);
    const reportBody = (await reportRes.json()) as {
      ok: boolean;
      isMonitoredTarget: boolean;
      warning: string;
    };
    assert.equal(reportBody.isMonitoredTarget, true);
    assert.ok(reportBody.warning.includes('Oye Kuri'), `Mensaje esperado para Kuri: ${reportBody.warning}`);
    console.log('[test:security] 4. Reporte anti-manipulación para Kuri -> OK:', reportBody.warning);

    // 5. Intentos no autorizados de Kuri por REST y Socket.IO devuelven aviso personalizado "Oye Kuri"
    const kuriCreateRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kuriAuth.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Intento Kuri' }),
    });
    assert.equal(kuriCreateRes.status, 403);
    const kuriCreateBody = (await kuriCreateRes.json()) as { error: string };
    assert.ok(kuriCreateBody.error.includes('Oye Kuri'), `Error 403 debe avisar a Kuri: ${kuriCreateBody.error}`);

    const tasksRes = await fetch(`${BASE_URL}/api/tasks`, {
      headers: { Authorization: `Bearer ${kuriAuth.token}` },
    });
    const tasks = (await tasksRes.json()) as Array<{ id: string; assigneeId: string | null; status: string }>;
    let anyTask = tasks[0];
    let createdTempTaskId: string | null = null;
    let leaderTokenForCleanup: string | null = null;
    if (!anyTask) {
      const leaderRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'lider', password: teamCredential }),
      });
      assert.equal(leaderRes.status, 200);
      const leaderAuth = (await leaderRes.json()) as { token: string };
      leaderTokenForCleanup = leaderAuth.token;
      const createTmpRes = await fetch(`${BASE_URL}/api/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${leaderAuth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: '[TEST SECURITY] Tarea temporal',
          description: 'Tarea temporal de prueba de seguridad',
          status: 'TODO',
          priority: 'LOW',
          dueDate: '2026-11-28T12:00:00.000Z',
          assigneeId: kuriUserId,
          subtasks: ['Subtarea temporal seguridad'],
        }),
      });
      assert.equal(createTmpRes.status, 201);
      anyTask = (await createTmpRes.json()) as { id: string; assigneeId: string | null; status: string };
      createdTempTaskId = anyTask.id;
    }
    assert.ok(anyTask);

    kuriSocket = createSocketClient(BASE_URL, {
      auth: { token: kuriAuth.token },
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 5000,
    });
    await new Promise<void>((resolve, reject) => {
      kuriSocket!.on('connect', () => resolve());
      kuriSocket!.on('connect_error', (err) => reject(err));
    });
    const socketAck = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      kuriSocket!.emit(
        'task:move',
        { taskId: anyTask.id, status: 'APPROVED', position: 0 },
        (ack: { ok: boolean; error?: string }) => resolve(ack),
      );
    });
    assert.equal(socketAck.ok, false);
    assert.ok(socketAck.error?.includes('Oye Kuri'), `Socket error debe avisar a Kuri: ${socketAck.error}`);
    if (createdTempTaskId && leaderTokenForCleanup) {
      await fetch(`${BASE_URL}/api/tasks/${createdTempTaskId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${leaderTokenForCleanup}` },
      });
    }
    console.log('[test:security] 5. Bloqueo REST + Socket con aviso "Oye Kuri" -> OK');

    // 6. Bloqueo por fuerza bruta en login tras 6 fallos
    const wrongAttemptSecret = generateEphemeralSecret('Brute');
    for (let i = 0; i < 6; i += 1) {
      const failRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'usuario_bruteforce_test', password: wrongAttemptSecret }),
      });
      assert.equal(failRes.status, 401);
    }
    const lockedRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'usuario_bruteforce_test', password: wrongAttemptSecret }),
    });
    assert.equal(lockedRes.status, 429, 'El 7mo intento fallido consecutivo debe responder 429');
    console.log('[test:security] 6. Protección anti fuerza bruta en login (429 al 7mo fallo) -> OK');

    console.log('[test:security] TODAS LAS VERIFICACIONES DE CIBERSEGURIDAD PASARON.');
  } finally {
    kuriSocket?.disconnect();
    killProcessTree(serverChild);

    // Limpiar alertas sintéticas de prueba creadas en esta ejecución
    if (kuriUserId) {
      const prisma = new PrismaClient();
      try {
        await prisma.activityLog.deleteMany({
          where: {
            userId: kuriUserId,
            action: 'security.alert',
            createdAt: { gte: testStart },
          },
        });
      } finally {
        await prisma.$disconnect();
      }
    }
  }
}

main().catch((err: unknown) => {
  console.error('[test:security] FALLÓ:', err);
  process.exit(1);
});
