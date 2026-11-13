import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import { createServer } from '../src/app';
import { prisma } from '../src/prisma';
import type { Activity, Comment, Task, TaskDetail } from '../src/types/domain';
import { getTestUserPassword } from './lib/testCredentials';

interface JsonResponse<T = unknown> {
  status: number;
  data: T;
}

async function requestJson<T = unknown>(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {},
): Promise<JsonResponse<T>> {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  const data = (text ? JSON.parse(text) : null) as T;
  return { status: res.status, data };
}

async function login(baseUrl: string, username: string, password: string): Promise<{ token: string; userId: string }> {
  const res = await requestJson<{ token: string; user: { id: string } }>(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  assert.equal(res.status, 200, `Login falló para ${username}`);
  return { token: res.data.token, userId: res.data.user.id };
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

function emitTaskMove(
  socket: Socket,
  payload: { taskId: string; status: string; position?: number },
): Promise<{ ok: true; task: Task } | { ok: false; error: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timeout esperando ack de task:move'));
    }, 5000);

    socket.emit('task:move', payload, (res: { ok: true; task: Task } | { ok: false; error: string }) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const initialTaskCount = await prisma.task.count();
  const { httpServer, io } = createServer();

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });

  const address = httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`[test:realtime] Servidor temporal escuchando en ${baseUrl}`);

  const sockets: Socket[] = [];
  let tempTaskId: string | null = null;
  let liderAuth: { token: string; userId: string } | null = null;

  let passed = 0;
  const check = (label: string, fn: () => void) => {
    fn();
    passed += 1;
    console.log(`  [OK] ${label}`);
  };

  try {
    const teamCredential = getTestUserPassword();
    // 0. Autenticar 3 usuarios
    liderAuth = await login(baseUrl, 'lider', teamCredential);
    const member1Auth = await login(baseUrl, 'integrante1', teamCredential);
    const member2Auth = await login(baseUrl, 'integrante2', teamCredential);

    // 1. Handshake rechazado sin token y con token inválido
    await assert.rejects(
      () => connectSocket(baseUrl),
      (err: Error) => err.message === 'unauthorized',
    );
    await assert.rejects(
      () => connectSocket(baseUrl, 'token.invalido.123'),
      (err: Error) => err.message === 'unauthorized',
    );
    check('Handshake Socket.IO sin token o con token inválido rechazado ("unauthorized")', () => {});

    // 2. Conectar 3 clientes simultáneos y verificar presencia en vivo
    const liderSocket = await connectSocket(baseUrl, liderAuth.token);
    sockets.push(liderSocket);

    const member1Socket = await connectSocket(baseUrl, member1Auth.token);
    sockets.push(member1Socket);

    const presenceAllPromise = waitForEvent<{ onlineUserIds: string[] }>(
      liderSocket,
      'presence:update',
      (p) =>
        p.onlineUserIds.includes(liderAuth!.userId) &&
        p.onlineUserIds.includes(member1Auth.userId) &&
        p.onlineUserIds.includes(member2Auth.userId),
    );
    const member2Socket = await connectSocket(baseUrl, member2Auth.token);
    sockets.push(member2Socket);

    const presence = await presenceAllPromise;
    check('Presencia en vivo incluye los 3 usuarios conectados', () => {
      assert.ok(presence.onlineUserIds.includes(liderAuth!.userId));
      assert.ok(presence.onlineUserIds.includes(member1Auth.userId));
      assert.ok(presence.onlineUserIds.includes(member2Auth.userId));
    });

    // 3. Validar rechazo HTTP 400 si falta cualquiera de los 7 campos obligatorios al crear actividad
    const tempTitle = `[TEST REALTIME] Tarea temporal ${Date.now()}`;
    const validBasePayload = {
      title: tempTitle,
      description: 'Descripción de prueba realtime',
      priority: 'HIGH',
      dueDate: '2026-11-28T12:00:00.000Z',
      assigneeId: member1Auth.userId,
      color: '#FFF59D',
      status: 'TODO',
      subtasks: ['Subtarea inicial'],
    };

    const invalidCreateCases: Array<[string, Record<string, unknown>]> = [
      ['sin título', { ...validBasePayload, title: '   ' }],
      ['sin descripción', { ...validBasePayload, description: '  ' }],
      ['sin prioridad', (({ priority: _p, ...rest }) => rest)(validBasePayload)],
      ['sin fecha límite', (({ dueDate: _d, ...rest }) => rest)(validBasePayload)],
      ['sin responsable', (({ assigneeId: _a, ...rest }) => rest)(validBasePayload)],
      ['sin columna inicial', (({ status: _s, ...rest }) => rest)(validBasePayload)],
      ['sin subtareas', { ...validBasePayload, subtasks: [] }],
    ];

    for (const [label, payload] of invalidCreateCases) {
      const invalidRes: JsonResponse<{ error: string }> = await requestJson<{ error: string }>(
        baseUrl,
        '/api/tasks',
        {
          method: 'POST',
          token: liderAuth.token,
          body: payload,
        },
      );
      assert.equal(
        invalidRes.status,
        400,
        `POST /api/tasks ${label} debe rechazarse con 400 (recibido ${invalidRes.status})`,
      );
    }
    check('POST /api/tasks rechaza con 400 si falta cualquiera de los 7 campos obligatorios', () => {
      assert.ok(true);
    });

    // 4. Líder crea tarea temporal asignada a integrante1 vía REST -> task:created en <1s tras persistencia
    let m1ReceivedAt = 0;
    let m2ReceivedAt = 0;
    const createdEventM1 = waitForEvent<Task>(member1Socket, 'task:created', (t) => t.title === tempTitle, 5000).then(
      (task) => {
        m1ReceivedAt = Date.now();
        return task;
      },
    );
    const createdEventM2 = waitForEvent<Task>(member2Socket, 'task:created', (t) => t.title === tempTitle, 5000).then(
      (task) => {
        m2ReceivedAt = Date.now();
        return task;
      },
    );
    const activityCreatedPromise = waitForEvent<Activity>(
      liderSocket,
      'activity:new',
      (a) => a.action === 'task.created' && a.details.title === tempTitle,
      5000,
    );

    const createRes = await requestJson<Task>(baseUrl, '/api/tasks', {
      method: 'POST',
      token: liderAuth.token,
      body: validBasePayload,
    });
    const restCompletedAt = Date.now();
    assert.equal(createRes.status, 201);
    tempTaskId = createRes.data.id;

    const [evTaskM1, evTaskM2, evActivity] = await Promise.all([
      createdEventM1,
      createdEventM2,
      activityCreatedPromise,
    ]);
    check('POST /api/tasks crea tarea y emite task:created + activity:new en <1s', () => {
      assert.equal(evTaskM1.id, tempTaskId);
      assert.equal(evTaskM2.id, tempTaskId);
      assert.equal(evTaskM1.status, 'TODO');
      assert.equal(evTaskM1.subtasks.length, 1);
      assert.equal(evActivity.taskId, tempTaskId);
      assert.ok(m1ReceivedAt - restCompletedAt < 1000);
      assert.ok(m2ReceivedAt - restCompletedAt < 1000);
    });

    // Verificar GET /api/tasks y GET /api/tasks/:id y PATCH /api/tasks/:id
    const listRes = await requestJson<Task[]>(baseUrl, `/api/tasks?assigneeId=${member1Auth.userId}`, {
      token: member2Auth.token,
    });
    const detailRes = await requestJson<TaskDetail>(baseUrl, `/api/tasks/${tempTaskId}`, {
      token: member1Auth.token,
    });
    const updatedEventPromise = waitForEvent<Task>(
      member1Socket,
      'task:updated',
      (t) => t.id === tempTaskId && t.priority === 'URGENT',
      5000,
    );
    const patchTaskRes = await requestJson<Task>(baseUrl, `/api/tasks/${tempTaskId}`, {
      method: 'PATCH',
      token: liderAuth.token,
      body: { priority: 'URGENT' },
    });
    const updatedEvent = await updatedEventPromise;
    check('GET /api/tasks, GET /api/tasks/:id y PATCH /api/tasks/:id funcionan y emiten task:updated', () => {
      assert.equal(listRes.status, 200);
      assert.ok(listRes.data.some((t) => t.id === tempTaskId));
      assert.equal(detailRes.status, 200);
      assert.ok(Array.isArray(detailRes.data.comments));
      assert.equal(patchTaskRes.status, 200);
      assert.equal(updatedEvent.priority, 'URGENT');
    });

    // 4. integrante1 mueve su tarea TODO -> IN_PROGRESS -> DONE vía socket task:move
    const movedInProgressLider = waitForEvent<{ task: Task; fromStatus: string; toStatus: string }>(
      liderSocket,
      'task:moved',
      (e) => e.task.id === tempTaskId && e.toStatus === 'IN_PROGRESS',
      5000,
    );
    const movedInProgressM2 = waitForEvent<{ task: Task; fromStatus: string; toStatus: string }>(
      member2Socket,
      'task:moved',
      (e) => e.task.id === tempTaskId && e.toStatus === 'IN_PROGRESS',
      5000,
    );
    const ack1 = await emitTaskMove(member1Socket, { taskId: tempTaskId, status: 'IN_PROGRESS' });
    const [m1Lider, m1M2] = await Promise.all([movedInProgressLider, movedInProgressM2]);

    const movedDoneLider = waitForEvent<{ task: Task; fromStatus: string; toStatus: string }>(
      liderSocket,
      'task:moved',
      (e) => e.task.id === tempTaskId && e.toStatus === 'DONE',
      5000,
    );
    const ack2 = await emitTaskMove(member1Socket, { taskId: tempTaskId, status: 'DONE' });
    const doneEv = await movedDoneLider;

    check('integrante1 mueve su tarea TODO -> IN_PROGRESS -> DONE por socket con broadcast', () => {
      assert.equal(ack1.ok, true);
      assert.equal(ack2.ok, true);
      assert.equal(m1Lider.fromStatus, 'TODO');
      assert.equal(m1M2.toStatus, 'IN_PROGRESS');
      assert.equal(doneEv.toStatus, 'DONE');
    });

    // 5. integrante2 intenta mover tarea de integrante1 -> rechazado (socket y REST 403)
    const unauthorizedSocketMove = await emitTaskMove(member2Socket, {
      taskId: tempTaskId,
      status: 'TODO',
    });
    const unauthorizedRestMove = await requestJson<{ error: string }>(
      baseUrl,
      `/api/tasks/${tempTaskId}/move`,
      {
        method: 'PATCH',
        token: member2Auth.token,
        body: { status: 'TODO' },
      },
    );
    check('integrante2 no puede mover tarea de integrante1 (socket ok:false y REST 403)', () => {
      assert.equal(unauthorizedSocketMove.ok, false);
      if (!unauthorizedSocketMove.ok) {
        assert.match(unauthorizedSocketMove.error, /asignadas/i);
      }
      assert.equal(unauthorizedRestMove.status, 403);
    });

    // 6. integrante1 intenta aprobar su tarea -> rechazado (socket y REST 403)
    const memberApproveSocket = await emitTaskMove(member1Socket, {
      taskId: tempTaskId,
      status: 'APPROVED',
    });
    const memberApproveRest = await requestJson<{ error: string }>(
      baseUrl,
      `/api/tasks/${tempTaskId}/move`,
      {
        method: 'PATCH',
        token: member1Auth.token,
        body: { status: 'APPROVED' },
      },
    );
    check('integrante1 no puede mover tarea a APPROVED (socket ok:false y REST 403)', () => {
      assert.equal(memberApproveSocket.ok, false);
      if (!memberApproveSocket.ok) {
        assert.equal(memberApproveSocket.error, 'Solo el líder puede aprobar tareas');
      }
      assert.equal(memberApproveRest.status, 403);
      assert.equal(memberApproveRest.data.error, 'Solo el líder puede aprobar tareas');
    });

    // 7. Líder aprueba la tarea -> ack.ok, approvedAt !== null, task:moved y task:approved
    const movedApprovedM1 = waitForEvent<{ task: Task; toStatus: string }>(
      member1Socket,
      'task:moved',
      (e) => e.task.id === tempTaskId && e.toStatus === 'APPROVED',
      5000,
    );
    const approvedEvM1 = waitForEvent<{ task: Task; by: { id: string } }>(
      member1Socket,
      'task:approved',
      (e) => e.task.id === tempTaskId,
      5000,
    );
    const approveAck = await emitTaskMove(liderSocket, { taskId: tempTaskId, status: 'APPROVED' });
    const [approvedMoved, approvedEv] = await Promise.all([movedApprovedM1, approvedEvM1]);
    check('Líder aprueba tarea -> approvedAt != null, emite task:moved y task:approved', () => {
      assert.equal(approveAck.ok, true);
      if (approveAck.ok) {
        assert.equal(approveAck.task.status, 'APPROVED');
        assert.ok(approveAck.task.approvedAt !== null);
      }
      assert.equal(approvedMoved.task.status, 'APPROVED');
      assert.equal(approvedEv.task.id, tempTaskId);
      assert.equal(approvedEv.by.id, liderAuth!.userId);
    });

    // 8. integrante1 intenta mover tarea ya APPROVED -> rechazado (socket y REST 403)
    const moveOutOfApprovedSocket = await emitTaskMove(member1Socket, {
      taskId: tempTaskId,
      status: 'IN_PROGRESS',
    });
    const moveOutOfApprovedRest = await requestJson<{ error: string }>(
      baseUrl,
      `/api/tasks/${tempTaskId}/move`,
      {
        method: 'PATCH',
        token: member1Auth.token,
        body: { status: 'IN_PROGRESS' },
      },
    );
    check('integrante1 no puede sacar tarea de APPROVED (socket ok:false y REST 403)', () => {
      assert.equal(moveOutOfApprovedSocket.ok, false);
      assert.equal(moveOutOfApprovedRest.status, 403);
    });

    // 9. Subtareas y comentarios
    const subCreatedPromise = waitForEvent<Task>(
      member1Socket,
      'task:updated',
      (t) => t.id === tempTaskId && t.subtasks.length === 2,
      5000,
    );
    const createSubRes = await requestJson<Task>(baseUrl, `/api/tasks/${tempTaskId}/subtasks`, {
      method: 'POST',
      token: liderAuth.token,
      body: { title: 'Subtarea de verificación' },
    });
    const subCreatedTask = await subCreatedPromise;
    assert.equal(createSubRes.status, 201);
    const secondSubtask = subCreatedTask.subtasks[1];

    const subToggledPromise = waitForEvent<Task>(
      liderSocket,
      'task:updated',
      (t) => t.id === tempTaskId && t.subtasks.some((s) => s.id === secondSubtask.id && s.done === true),
      5000,
    );
    const toggleSubM1 = await requestJson<Task>(baseUrl, `/api/subtasks/${secondSubtask.id}`, {
      method: 'PATCH',
      token: member1Auth.token,
      body: { done: true },
    });
    await subToggledPromise;

    const editTitleAsM1 = await requestJson<{ error: string }>(
      baseUrl,
      `/api/subtasks/${secondSubtask.id}`,
      {
        method: 'PATCH',
        token: member1Auth.token,
        body: { title: 'Intento no autorizado' },
      },
    );
    const toggleSubAsM2 = await requestJson<{ error: string }>(
      baseUrl,
      `/api/subtasks/${secondSubtask.id}`,
      {
        method: 'PATCH',
        token: member2Auth.token,
        body: { done: false },
      },
    );

    check('Subtareas: líder crea, integrante1 marca done, integrante1 no edita title (403), integrante2 no marca done (403)', () => {
      assert.equal(toggleSubM1.status, 200);
      assert.equal(editTitleAsM1.status, 403);
      assert.equal(toggleSubAsM2.status, 403);
    });

    // Comentarios
    const commentCreatedPromise = waitForEvent<{ taskId: string; comment: Comment }>(
      liderSocket,
      'comment:created',
      (e) => e.taskId === tempTaskId && e.comment.content === 'Comentario en tiempo real',
      5000,
    );
    const createCommentRes = await requestJson<Comment>(baseUrl, `/api/tasks/${tempTaskId}/comments`, {
      method: 'POST',
      token: member2Auth.token,
      body: { content: 'Comentario en tiempo real' },
    });
    const commentEv = await commentCreatedPromise;

    const deleteCommentM1 = await requestJson<{ error: string }>(
      baseUrl,
      `/api/comments/${createCommentRes.data.id}`,
      {
        method: 'DELETE',
        token: member1Auth.token,
      },
    );

    const commentDeletedPromise = waitForEvent<{ taskId: string; id: string }>(
      liderSocket,
      'comment:deleted',
      (e) => e.taskId === tempTaskId && e.id === createCommentRes.data.id,
      5000,
    );
    const deleteCommentM2 = await requestJson<{ ok: boolean; id: string }>(
      baseUrl,
      `/api/comments/${createCommentRes.data.id}`,
      {
        method: 'DELETE',
        token: member2Auth.token,
      },
    );
    await commentDeletedPromise;

    check('Comentarios: integrante2 crea (comment:created), integrante1 no borra ajeno (403), autor borra (comment:deleted)', () => {
      assert.equal(createCommentRes.status, 201);
      assert.equal(commentEv.comment.author.username, 'integrante2');
      assert.equal(deleteCommentM1.status, 403);
      assert.equal(deleteCommentM2.status, 200);
      assert.equal(deleteCommentM2.data.ok, true);
    });

    // Actividad reciente
    const activityRes = await requestJson<Activity[]>(baseUrl, '/api/activity?limit=20', {
      token: member1Auth.token,
    });
    check('GET /api/activity devuelve historial reciente', () => {
      assert.equal(activityRes.status, 200);
      assert.ok(activityRes.data.length > 0);
      assert.ok(activityRes.data.some((a) => a.taskId === tempTaskId));
    });

    // Eliminación de tarea temporal por el líder y broadcast task:deleted
    const taskDeletedPromise = waitForEvent<{ id: string }>(
      member1Socket,
      'task:deleted',
      (e) => e.id === tempTaskId,
      5000,
    );
    const deleteTaskRes = await requestJson<{ ok: boolean; id: string }>(
      baseUrl,
      `/api/tasks/${tempTaskId}`,
      {
        method: 'DELETE',
        token: liderAuth.token,
      },
    );
    const deletedEv = await taskDeletedPromise;
    tempTaskId = null;

    check('DELETE /api/tasks/:id elimina tarea temporal y emite task:deleted', () => {
      assert.equal(deleteTaskRes.status, 200);
      assert.equal(deleteTaskRes.data.ok, true);
      assert.equal(deletedEv.id, deleteTaskRes.data.id);
    });

    console.log(`\n[test:realtime] TODOS LOS CHECKS PASARON (${passed}/${passed}).`);
  } finally {
    if (tempTaskId && liderAuth) {
      await requestJson(baseUrl, `/api/tasks/${tempTaskId}`, {
        method: 'DELETE',
        token: liderAuth.token,
      }).catch(() => undefined);
    }

    // Limpiar logs generados únicamente durante esta ejecución de prueba para dejar la BD intacta
    await prisma.activityLog.deleteMany({
      where: { createdAt: { gte: startedAt } },
    });

    const finalTaskCount = await prisma.task.count();
    if (finalTaskCount !== initialTaskCount) {
      console.warn(`[test:realtime] Advertencia: conteo de tareas inicial=${initialTaskCount}, final=${finalTaskCount}`);
    }

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
  console.error('[test:realtime] ERROR:', err);
  process.exitCode = 1;
});
