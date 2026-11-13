import assert from 'node:assert/strict';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import { getTestUserPassword } from './lib/testCredentials';

const PORT = Number(process.env.COLLAB_TEST_PORT || 3105);
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
    // Proceso ya cerrado
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
      // Seguir esperando
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`El servidor de prueba no respondió /api/health en ${timeoutMs}ms`);
}

async function jsonReq<T>(
  method: string,
  urlPath: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as T) : ({} as T);
  return { status: res.status, data: parsed };
}

async function tryLogin(username: string, password: string) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.status !== 200) return null;
  return (await res.json()) as {
    token: string;
    user: { id: string; username: string; displayName: string; role: string; slot: number };
  };
}

async function login(username: string, password: string) {
  const auth = await tryLogin(username, password);
  assert.ok(auth, `Login de ${username} debe responder 200`);
  return auth;
}

async function main(): Promise<void> {
  console.log(`[test:collab] Levantando servidor en ${BASE_URL}...`);
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

  const cleanupTaskIds: string[] = [];
  const sockets: Socket[] = [];
  let leaderToken = '';

  try {
    await waitForHealth(35000);

    // 1. Iniciar sesión con las 6 cuentas usando la credencial compartida de entorno
    const teamCredential = getTestUserPassword();
    const activeAccounts = await Promise.all([
      login('lider', teamCredential),
      login('integrante1', teamCredential),
      login('integrante2', teamCredential),
      login('integrante3', teamCredential),
      login('integrante4', teamCredential),
      login('integrante5', teamCredential),
    ]);
    const [leader, , member2, , , subleader] = activeAccounts;
    leaderToken = leader.token;
    console.log(`[test:collab] OK ${activeAccounts.length} cuentas autenticadas con contraseña unificada`);

    // 2. Líder crea tarea asignada a TODO el equipo (assignedToAll = true)
    const createRes = await jsonReq<{
      id: string;
      assignedToAll: boolean;
      assigneeId: string | null;
      subtasks: Array<{ id: string; done: boolean }>;
    }>('POST', '/api/tasks', leader.token, {
      title: 'Prueba colaborativa Todo el equipo',
      description: 'Tarea compartida por los 6 miembros',
      priority: 'HIGH',
      dueDate: '2026-11-25T18:00:00.000Z',
      assignedToAll: true,
      assigneeId: null,
      status: 'TODO',
      subtasks: ['Revisar arquitectura en conjunto'],
    });
    assert.equal(createRes.status, 201, 'Líder debe poder crear tarea assignedToAll=true');
    assert.equal(createRes.data.assignedToAll, true);
    assert.equal(createRes.data.assigneeId, null);
    const sharedTaskId = createRes.data.id;
    const subtaskId = createRes.data.subtasks[0]?.id;
    assert.ok(subtaskId, 'Debe existir la subtarea inicial');
    cleanupTaskIds.push(sharedTaskId);
    console.log('[test:collab] OK tarea asignada a Todo el equipo creada');

    // 3. Filtro ?assigneeId=<kuriId> también incluye tareas assignedToAll
    const filteredRes = await jsonReq<Array<{ id: string; assignedToAll: boolean }>>(
      'GET',
      `/api/tasks?assigneeId=${encodeURIComponent(member2.user.id)}`,
      member2.token,
    );
    assert.equal(filteredRes.status, 200);
    assert.ok(
      filteredRes.data.some((t) => t.id === sharedTaskId && t.assignedToAll),
      'El filtro por integrante debe incluir tareas asignadas a todo el equipo',
    );
    console.log('[test:collab] OK filtro ?assigneeId incluye tareas assignedToAll');

    // 4. Kuri (MEMBER) puede mover la tarea compartida a IN_PROGRESS y DONE, pero NO a APPROVED
    const moveRes1 = await jsonReq<{ task: { status: string } }>(
      'PATCH',
      `/api/tasks/${sharedTaskId}/move`,
      member2.token,
      { status: 'IN_PROGRESS' },
    );
    assert.equal(moveRes1.status, 200, 'Miembro debe poder mover tarea assignedToAll a IN_PROGRESS');

    const moveRes2 = await jsonReq<{ task: { status: string } }>(
      'PATCH',
      `/api/tasks/${sharedTaskId}/move`,
      member2.token,
      { status: 'DONE' },
    );
    assert.equal(moveRes2.status, 200, 'Miembro debe poder mover tarea assignedToAll a DONE');

    const approveFail = await jsonReq<{ error?: string }>(
      'PATCH',
      `/api/tasks/${sharedTaskId}/move`,
      member2.token,
      { status: 'APPROVED' },
    );
    assert.equal(approveFail.status, 403, 'Miembro NO puede aprobar tarea assignedToAll');
    console.log('[test:collab] OK permisos de movimiento en tarea assignedToAll verificados');

    // 5. Sublíder marca subtarea en tarea assignedToAll (aunque no sea asignado individual)
    const subRes = await jsonReq<{ subtasks: Array<{ id: string; done: boolean }> }>(
      'PATCH',
      `/api/subtasks/${subtaskId}`,
      subleader.token,
      { done: true },
    );
    assert.equal(subRes.status, 200, 'Integrante/Sublíder debe poder completar subtarea de tarea assignedToAll');
    assert.equal(subRes.data.subtasks.find((s) => s.id === subtaskId)?.done, true);
    console.log('[test:collab] OK subtarea completada en tarea compartida');

    // 6. Socket.IO + 6 comentarios simultáneos
    const leaderSocket = createSocketClient(BASE_URL, {
      auth: { token: leader.token },
      transports: ['websocket'],
    });
    const peerSocket = createSocketClient(BASE_URL, {
      auth: { token: member2.token },
      transports: ['websocket'],
    });
    sockets.push(leaderSocket, peerSocket);

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        leaderSocket.once('connect', resolve);
        leaderSocket.once('connect_error', reject);
      }),
      new Promise<void>((resolve, reject) => {
        peerSocket.once('connect', resolve);
        peerSocket.once('connect_error', reject);
      }),
    ]);

    const typingReceivedPromise = new Promise<{
      taskId: string;
      userId: string;
      displayName: string;
      isTyping: boolean;
    }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout esperando comment:typing')), 5000);
      leaderSocket.once('comment:typing', (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    peerSocket.emit('comment:typing', { taskId: sharedTaskId, isTyping: true });
    const typingPayload = await typingReceivedPromise;
    assert.equal(typingPayload.taskId, sharedTaskId);
    assert.equal(typingPayload.userId, member2.user.id);
    assert.equal(typingPayload.isTyping, true);
    console.log('[test:collab] OK evento comment:typing propagado en tiempo real');

    const receivedCommentIds = new Set<string>();
    const allCommentsViaSocketPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Solo llegaron ${receivedCommentIds.size}/6 comment:created`)),
        8000,
      );
      leaderSocket.on('comment:created', (evt: { taskId: string; comment: { id: string } }) => {
        if (evt.taskId === sharedTaskId) {
          receivedCommentIds.add(evt.comment.id);
          if (receivedCommentIds.size === 6) {
            clearTimeout(timer);
            resolve();
          }
        }
      });
    });

    // Disparar 6 comentarios exactamente en paralelo desde las cuentas conectadas
    const concurrentSlots = Array.from(
      { length: 6 },
      (_, idx) => activeAccounts[idx % activeAccounts.length],
    );
    const concurrentResults = await Promise.all(
      concurrentSlots.map((acc, idx) =>
        jsonReq<{ id: string; content: string }>(
          'POST',
          `/api/tasks/${sharedTaskId}/comments`,
          acc.token,
          { content: `Comentario simultáneo #${idx + 1} de ${acc.user.displayName}` },
        ),
      ),
    );

    for (const [idx, res] of concurrentResults.entries()) {
      assert.equal(res.status, 201, `Comentario paralelo #${idx + 1} debe responder 201`);
    }

    await allCommentsViaSocketPromise;
    assert.equal(receivedCommentIds.size, 6, 'Socket.IO debe entregar los 6 comentarios');

    const detailRes = await jsonReq<{
      commentCount: number;
      comments: Array<{ id: string; content: string }>;
    }>('GET', `/api/tasks/${sharedTaskId}`, leader.token);
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.data.commentCount, 6);
    assert.equal(detailRes.data.comments.length, 6);
    console.log('[test:collab] OK 6 comentarios simultáneos guardados y sincronizados sin colisiones');

    console.log('[test:collab] TODAS LAS PRUEBAS COLABORATIVAS PASARON');
  } finally {
    for (const s of sockets) {
      s.disconnect();
    }
    if (leaderToken && cleanupTaskIds.length > 0) {
      for (const id of cleanupTaskIds) {
        await jsonReq('DELETE', `/api/tasks/${id}`, leaderToken).catch(() => undefined);
      }
    }
    killProcessTree(serverChild);
  }
}

main().catch((err) => {
  console.error('[test:collab] FALLÓ:', err);
  process.exit(1);
});
