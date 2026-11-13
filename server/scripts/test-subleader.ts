import assert from 'node:assert/strict';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import { generateEphemeralSecret, getTestUserPassword } from './lib/testCredentials';

const PORT = Number(process.env.SUBLEADER_TEST_PORT || 3102);
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

async function login(username: string, password: string) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200, `Login de ${username} debe responder 200`);
  return (await res.json()) as {
    token: string;
    user: { id: string; username: string; displayName: string; role: string; slot: number };
  };
}

async function main(): Promise<void> {
  console.log(`[test:subleader] Levantando servidor en ${BASE_URL}...`);
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
  let subSocket: Socket | null = null;
  let leaderToken = '';

  try {
    await waitForHealth(35000);

    // 1. Login Líder y Sublíder
    const teamCredential = getTestUserPassword();
    const leaderAuth = await login('lider', teamCredential);
    leaderToken = leaderAuth.token;
    assert.equal(leaderAuth.user.role, 'LEADER');

    const subAuth = await login('integrante5', teamCredential);
    assert.equal(subAuth.user.role, 'SUBLEADER', 'integrante5 debe tener rol SUBLEADER');
    assert.equal(subAuth.user.slot, 6);
    console.log('[test:subleader] 1. Login David Alejandro (SUBLEADER) OK:', subAuth.user.displayName);

    // 2. El Líder crea una tarea de prueba asignada a sí mismo con subtarea y comentario
    const leaderTaskRes = await jsonReq<{
      id: string;
      subtasks: Array<{ id: string }>;
    }>('POST', '/api/tasks', leaderToken, {
      title: '[TEST SUBLEADER] Tarea del Líder',
      description: 'Tarea temporal para probar restricciones del sublíder',
      status: 'TODO',
      priority: 'MEDIUM',
      dueDate: '2026-11-20T12:00:00.000Z',
      assigneeId: leaderAuth.user.id,
      color: null,
      subtasks: ['Subtarea del líder'],
    });
    assert.equal(leaderTaskRes.status, 201);
    cleanupTaskIds.push(leaderTaskRes.data.id);
    const leaderTaskId = leaderTaskRes.data.id;
    const leaderSubtaskId = leaderTaskRes.data.subtasks[0].id;

    const leaderCommentRes = await jsonReq<{ id: string }>(
      'POST',
      `/api/tasks/${leaderTaskId}/comments`,
      leaderToken,
      { content: 'Comentario de prueba del líder' },
    );
    assert.equal(leaderCommentRes.status, 201);
    const leaderCommentId = leaderCommentRes.data.id;

    // 3. SUBLEADER PUEDE agregar tareas en TODO / IN_PROGRESS / DONE (pero NO en APPROVED)
    const subCreateRes = await jsonReq<{ id: string; color: string | null; status: string }>(
      'POST',
      '/api/tasks',
      subAuth.token,
      {
        title: '[TEST SUBLEADER] Tarea creada por sublíder',
        description: 'Debe permitirse crear tareas',
        status: 'TODO',
        priority: 'HIGH',
        dueDate: '2026-11-22T12:00:00.000Z',
        assigneeId: subAuth.user.id,
        color: null,
        subtasks: ['Paso inicial'],
      },
    );
    assert.equal(subCreateRes.status, 201, 'SUBLEADER debe poder crear tareas en TODO');
    assert.equal(subCreateRes.data.color, null);
    cleanupTaskIds.push(subCreateRes.data.id);
    const subTaskId = subCreateRes.data.id;
    console.log('[test:subleader] 2. SUBLEADER POST /api/tasks (TODO) -> 201 OK');

    const subCreateApprovedRes = await jsonReq<{ error?: string }>(
      'POST',
      '/api/tasks',
      subAuth.token,
      {
        title: '[TEST SUBLEADER] Intento directo en APROBADO',
        description: 'Intento de crear actividad directamente aprobada',
        priority: 'MEDIUM',
        dueDate: '2026-11-22T12:00:00.000Z',
        assignedToAll: true,
        status: 'APPROVED',
        subtasks: ['Subtarea de control'],
      },
    );
    assert.equal(subCreateApprovedRes.status, 403, 'SUBLEADER NO puede crear directo en APPROVED');
    console.log('[test:subleader] 3. SUBLEADER POST /api/tasks (APPROVED) -> 403 OK');

    // 4. SUBLEADER NO puede editar ni eliminar tareas (ni siquiera la que él mismo creó)
    const editOwnRes = await jsonReq('PATCH', `/api/tasks/${subTaskId}`, subAuth.token, {
      title: 'Título editado por sublíder',
    });
    assert.equal(editOwnRes.status, 403, 'SUBLEADER NO puede editar tareas');

    const deleteOwnRes = await jsonReq('DELETE', `/api/tasks/${subTaskId}`, subAuth.token);
    assert.equal(deleteOwnRes.status, 403, 'SUBLEADER NO puede eliminar tareas');
    console.log('[test:subleader] 4. SUBLEADER PATCH/DELETE /api/tasks/:id -> 403 OK');

    // 5. SUBLEADER PUEDE mover SU propia tarea hasta DONE, pero NO a APPROVED ni mover tareas ajenas
    const moveOwnDoneRes = await jsonReq('PATCH', `/api/tasks/${subTaskId}/move`, subAuth.token, {
      status: 'DONE',
      position: 1000,
    });
    assert.equal(moveOwnDoneRes.status, 200, 'SUBLEADER puede mover su tarea asignada a DONE');

    const moveOwnApprovedRes = await jsonReq('PATCH', `/api/tasks/${subTaskId}/move`, subAuth.token, {
      status: 'APPROVED',
      position: 1000,
    });
    assert.equal(moveOwnApprovedRes.status, 403, 'SUBLEADER NO puede aprobar vía REST');

    const moveOtherRes = await jsonReq('PATCH', `/api/tasks/${leaderTaskId}/move`, subAuth.token, {
      status: 'IN_PROGRESS',
      position: 1000,
    });
    assert.equal(moveOtherRes.status, 403, 'SUBLEADER NO puede mover tareas de otros usuarios');

    // Verificar bloqueo de aprobación también vía Socket.IO
    subSocket = createSocketClient(BASE_URL, {
      auth: { token: subAuth.token },
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 5000,
    });
    await new Promise<void>((resolve, reject) => {
      subSocket!.on('connect', () => resolve());
      subSocket!.on('connect_error', (err) => reject(err));
    });
    const socketAck = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      subSocket!.emit(
        'task:move',
        { taskId: subTaskId, status: 'APPROVED', position: 1000 },
        (ack: { ok: boolean; error?: string }) => resolve(ack),
      );
    });
    assert.equal(socketAck.ok, false, 'SUBLEADER NO puede aprobar vía Socket.IO');
    console.log('[test:subleader] 5. SUBLEADER movimiento propio/ajeno/APPROVED (REST + Socket) -> OK');

    // 6. SUBLEADER NO puede crear, renombrar ni eliminar subtareas; ni marcar subtareas ajenas
    const addSubtaskRes = await jsonReq(
      'POST',
      `/api/tasks/${subTaskId}/subtasks`,
      subAuth.token,
      { title: 'Subtarea extra no permitida' },
    );
    assert.equal(addSubtaskRes.status, 403);

    const renameSubtaskRes = await jsonReq(
      'PATCH',
      `/api/subtasks/${leaderSubtaskId}`,
      subAuth.token,
      { title: 'Renombrada' },
    );
    assert.equal(renameSubtaskRes.status, 403);

    const toggleOtherSubtaskRes = await jsonReq(
      'PATCH',
      `/api/subtasks/${leaderSubtaskId}`,
      subAuth.token,
      { done: true },
    );
    assert.equal(toggleOtherSubtaskRes.status, 403);

    const deleteSubtaskRes = await jsonReq(
      'DELETE',
      `/api/subtasks/${leaderSubtaskId}`,
      subAuth.token,
    );
    assert.equal(deleteSubtaskRes.status, 403);
    console.log('[test:subleader] 6. SUBLEADER gestión de subtareas -> 403 OK');

    // 7. SUBLEADER NO puede borrar comentarios ajenos ni gestionar Equipo (6/6)
    const delCommentRes = await jsonReq(
      'DELETE',
      `/api/comments/${leaderCommentId}`,
      subAuth.token,
    );
    assert.equal(delCommentRes.status, 403);

    const createUserRes = await jsonReq('POST', '/api/users', subAuth.token, {
      username: 'x',
      displayName: 'X',
      password: generateEphemeralSecret('SubleaderDenied'),
    });
    assert.equal(createUserRes.status, 403);

    const patchUserRes = await jsonReq('PATCH', `/api/users/${subAuth.user.id}`, subAuth.token, {
      displayName: 'Hack',
    });
    assert.equal(patchUserRes.status, 403);

    const delUserRes = await jsonReq('DELETE', `/api/users/${subAuth.user.id}`, subAuth.token);
    assert.equal(delUserRes.status, 403);
    console.log('[test:subleader] 7. SUBLEADER borrado comentarios ajenos + Equipo (6/6) -> 403 OK');

    console.log('[test:subleader] TODAS LAS VERIFICACIONES DE SUBLÍDER PASARON.');
  } finally {
    if (leaderToken && cleanupTaskIds.length > 0) {
      for (const id of cleanupTaskIds) {
        try {
          await jsonReq('DELETE', `/api/tasks/${id}`, leaderToken);
        } catch {
          // Ignorar error de limpieza
        }
      }
      console.log(`[test:subleader] Limpieza completada (${cleanupTaskIds.length} tareas de prueba eliminadas).`);
    }
    subSocket?.disconnect();
    killProcessTree(serverChild);
  }
}

main().catch((err: unknown) => {
  console.error('[test:subleader] FALLÓ:', err);
  process.exit(1);
});
