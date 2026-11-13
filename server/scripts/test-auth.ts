import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Prisma } from '@prisma/client';
import { createServer } from '../src/app';
import { prisma } from '../src/prisma';
import { generateEphemeralSecret, getTestUserPassword } from './lib/testCredentials';

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

async function main(): Promise<void> {
  const { httpServer } = createServer();

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });

  const address = httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`[test:auth] Servidor temporal escuchando en ${baseUrl}`);

  const originalIntegrante1 = await prisma.user.findUnique({ where: { username: 'integrante1' } });
  assert.ok(originalIntegrante1, 'Debe existir integrante1 en la BD');

  const originalIntegrante5 = await prisma.user.findUnique({ where: { username: 'integrante5' } });
  assert.ok(originalIntegrante5, 'Debe existir integrante5 en la BD');

  const [assignedTasks, createdTasks, authoredComments] = await Promise.all([
    prisma.task.findMany({ where: { assigneeId: originalIntegrante5.id }, select: { id: true } }),
    prisma.task.findMany({ where: { createdById: originalIntegrante5.id }, select: { id: true } }),
    prisma.comment.findMany({
      where: { authorId: originalIntegrante5.id },
      select: { id: true, taskId: true, content: true, createdAt: true },
    }),
  ]);

  let passed = 0;
  const check = (label: string, fn: () => void) => {
    fn();
    passed += 1;
    console.log(`  [OK] ${label}`);
  };

  try {
    // 1. Health check
    const health = await requestJson<{ status: string; db: boolean; time: string }>(baseUrl, '/api/health');
    check('GET /api/health -> 200 { status: "ok", db: true }', () => {
      assert.equal(health.status, 200);
      assert.equal(health.data.status, 'ok');
      assert.equal(health.data.db, true);
      assert.ok(typeof health.data.time === 'string');
    });

    // 404 en /api/*
    const notFound = await requestJson<{ error: string }>(baseUrl, '/api/ruta-inexistente');
    check('GET /api/ruta-inexistente -> 404 JSON', () => {
      assert.equal(notFound.status, 404);
      assert.ok(typeof notFound.data.error === 'string');
    });

    const teamCredential = getTestUserPassword();

    // 2. Login válido del Líder
    const leaderLogin = await requestJson<{
      token: string;
      user: Record<string, unknown>;
    }>(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'lider', password: teamCredential },
    });
    check('POST /api/auth/login (lider) -> 200 + token + role LEADER', () => {
      assert.equal(leaderLogin.status, 200);
      assert.ok(typeof leaderLogin.data.token === 'string' && leaderLogin.data.token.length > 20);
      assert.equal(leaderLogin.data.user.role, 'LEADER');
      assert.equal('passwordHash' in leaderLogin.data.user, false);
      assert.equal('tokenVersion' in leaderLogin.data.user, false);
    });
    const leaderToken = leaderLogin.data.token;
    const leaderId = String(leaderLogin.data.user.id);

    // 3. Login válido de un Integrante
    const memberLogin = await requestJson<{
      token: string;
      user: Record<string, unknown>;
    }>(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'integrante1', password: teamCredential },
    });
    check('POST /api/auth/login (integrante1) -> 200 + token + role MEMBER', () => {
      assert.equal(memberLogin.status, 200);
      assert.ok(typeof memberLogin.data.token === 'string' && memberLogin.data.token.length > 20);
      assert.equal(memberLogin.data.user.role, 'MEMBER');
    });
    const memberToken = memberLogin.data.token;

    // 4. Login inválido
    const invalidLoginSecret = generateEphemeralSecret('InvalidLogin');
    const badLogin = await requestJson<{ error: string }>(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'lider', password: invalidLoginSecret },
    });
    check('POST /api/auth/login inválido -> 401', () => {
      assert.equal(badLogin.status, 401);
      assert.equal(badLogin.data.error, 'Credenciales inválidas');
    });

    // 5. GET /api/users/me sin token y con token
    const meNoToken = await requestJson<{ error: string }>(baseUrl, '/api/users/me');
    const meWithToken = await requestJson<{ username: string; role: string }>(baseUrl, '/api/users/me', {
      token: memberToken,
    });
    check('GET /api/users/me sin token -> 401; con token -> 200', () => {
      assert.equal(meNoToken.status, 401);
      assert.equal(meWithToken.status, 200);
      assert.equal(meWithToken.data.username, 'integrante1');
    });

    // 6. PATCH /api/users/me con token de integrante1
    const patchMe = await requestJson<{ displayName: string }>(baseUrl, '/api/users/me', {
      method: 'PATCH',
      token: memberToken,
      body: { displayName: 'Ana López (Prueba)' },
    });
    check('PATCH /api/users/me actualiza displayName -> 200', () => {
      assert.equal(patchMe.status, 200);
      assert.equal(patchMe.data.displayName, 'Ana López (Prueba)');
    });

    // 7. GET /api/users -> maxUsers 6, users.length 6
    const listAll = await requestJson<{
      users: Array<{ id: string; slot: number; username: string }>;
      maxUsers: number;
    }>(baseUrl, '/api/users', { token: memberToken });
    check('GET /api/users -> maxUsers === 6 y users.length === 6', () => {
      assert.equal(listAll.status, 200);
      assert.equal(listAll.data.maxUsers, 6);
      assert.equal(listAll.data.users.length, 6);
    });

    // 8. POST /api/users como Integrante -> 403
    const syntheticUserSecret = generateEphemeralSecret('DummyUser');
    const createAsMember = await requestJson<{ error: string }>(baseUrl, '/api/users', {
      method: 'POST',
      token: memberToken,
      body: {
        username: 'intruso',
        displayName: 'Intruso',
        password: syntheticUserSecret,
      },
    });
    check('POST /api/users como MEMBER -> 403', () => {
      assert.equal(createAsMember.status, 403);
    });

    // 9. POST /api/users como Líder cuando hay 6/6 -> 409
    const createFull = await requestJson<{ error: string }>(baseUrl, '/api/users', {
      method: 'POST',
      token: leaderToken,
      body: {
        username: 'septimo_usuario',
        displayName: 'Séptimo Usuario',
        password: syntheticUserSecret,
      },
    });
    check('POST /api/users con cupo lleno (6/6) -> 409', () => {
      assert.equal(createFull.status, 409);
    });

    // Intentar eliminar al líder -> 403
    const deleteLeader = await requestJson<{ error: string }>(baseUrl, `/api/users/${leaderId}`, {
      method: 'DELETE',
      token: leaderToken,
    });
    check('DELETE /api/users/:id sobre líder -> 403', () => {
      assert.equal(deleteLeader.status, 403);
    });

    // 10. Prueba real de eliminación de cupo, creación, rotación de token y restauración
    const deleteSlot6 = await requestJson<{ ok: boolean; id: string }>(
      baseUrl,
      `/api/users/${originalIntegrante5.id}`,
      { method: 'DELETE', token: leaderToken },
    );
    check('DELETE /api/users/:id elimina integrante5 -> 200', () => {
      assert.equal(deleteSlot6.status, 200);
      assert.equal(deleteSlot6.data.ok, true);
    });

    const listAfterDelete = await requestJson<{ users: unknown[]; maxUsers: number }>(baseUrl, '/api/users', {
      token: leaderToken,
    });
    check('GET /api/users tras eliminar -> 5 usuarios', () => {
      assert.equal(listAfterDelete.status, 200);
      assert.equal(listAfterDelete.data.users.length, 5);
    });

    const tempInitSecret = generateEphemeralSecret('TempInit');
    const tempNextSecret = generateEphemeralSecret('TempNext');
    const tempWrongSecret = generateEphemeralSecret('TempWrong');
    const tempFinalSecret = generateEphemeralSecret('TempFinal');

    const createTemp = await requestJson<{ id: string; slot: number; username: string; role: string }>(
      baseUrl,
      '/api/users',
      {
        method: 'POST',
        token: leaderToken,
        body: {
          username: 'temp_tester',
          displayName: 'Tester Temporal',
          password: tempInitSecret,
        },
      },
    );
    check('POST /api/users crea usuario temporal en slot 6 -> 201', () => {
      assert.equal(createTemp.status, 201);
      assert.equal(createTemp.data.slot, 6);
      assert.equal(createTemp.data.username, 'temp_tester');
      assert.equal(createTemp.data.role, 'MEMBER');
    });
    const tempUserId = createTemp.data.id;

    const tempLogin1 = await requestJson<{ token: string }>(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'temp_tester', password: tempInitSecret },
    });
    check('Login usuario temporal -> 200', () => {
      assert.equal(tempLogin1.status, 200);
    });
    const tempToken1 = tempLogin1.data.token;

    // PATCH /api/users/me/password (contraseña actual incorrecta -> 400)
    const badChangePwd = await requestJson<{ error: string }>(baseUrl, '/api/users/me/password', {
      method: 'PATCH',
      token: tempToken1,
      body: { currentPassword: tempWrongSecret, newPassword: tempNextSecret },
    });
    check('PATCH /api/users/me/password con clave actual incorrecta -> 400', () => {
      assert.equal(badChangePwd.status, 400);
    });

    // PATCH /api/users/me/password válido -> rota tokenVersion y devuelve nuevo token
    const changePwd = await requestJson<{ ok: boolean; token: string }>(baseUrl, '/api/users/me/password', {
      method: 'PATCH',
      token: tempToken1,
      body: { currentPassword: tempInitSecret, newPassword: tempNextSecret },
    });
    check('PATCH /api/users/me/password válido -> 200 y nuevo token', () => {
      assert.equal(changePwd.status, 200);
      assert.equal(changePwd.data.ok, true);
      assert.ok(typeof changePwd.data.token === 'string' && changePwd.data.token !== tempToken1);
    });
    const tempToken2 = changePwd.data.token;

    const oldTokenRejected = await requestJson(baseUrl, '/api/users/me', { token: tempToken1 });
    const newTokenAccepted = await requestJson(baseUrl, '/api/users/me', { token: tempToken2 });
    check('Token previo a /me/password rechazado (401) y token nuevo aceptado (200)', () => {
      assert.equal(oldTokenRejected.status, 401);
      assert.equal(newTokenAccepted.status, 200);
    });

    // PATCH /api/users/:id por Líder restablece password e invalida tempToken2
    const resetByLeader = await requestJson<{ displayName: string }>(
      baseUrl,
      `/api/users/${tempUserId}`,
      {
        method: 'PATCH',
        token: leaderToken,
        body: { displayName: 'Tester Editado', password: tempFinalSecret },
      },
    );
    check('PATCH /api/users/:id por líder restablece contraseña -> 200', () => {
      assert.equal(resetByLeader.status, 200);
      assert.equal(resetByLeader.data.displayName, 'Tester Editado');
    });

    const tokenAfterLeaderReset = await requestJson(baseUrl, '/api/users/me', { token: tempToken2 });
    check('Token previo a restablecimiento del líder rechazado con 401 (tokenVersion)', () => {
      assert.equal(tokenAfterLeaderReset.status, 401);
    });

    const loginAfterLeaderReset = await requestJson<{ token: string }>(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'temp_tester', password: tempFinalSecret },
    });
    check('Login con contraseña restablecida por líder -> 200', () => {
      assert.equal(loginAfterLeaderReset.status, 200);
    });

    const deleteTemp = await requestJson<{ ok: boolean }>(baseUrl, `/api/users/${tempUserId}`, {
      method: 'DELETE',
      token: leaderToken,
    });
    check('DELETE /api/users/:id elimina usuario temporal -> 200', () => {
      assert.equal(deleteTemp.status, 200);
      assert.equal(deleteTemp.data.ok, true);
    });

    console.log(`\n[test:auth] TODOS LOS CHECKS PASARON (${passed}/${passed}).`);
  } finally {
    // Restaurar estado exacto de la base de datos
    await prisma.user.update({
      where: { id: originalIntegrante1.id },
      data: { displayName: originalIntegrante1.displayName },
    });

    await prisma.user.deleteMany({
      where: { username: 'temp_tester' },
    });

    const existingSlot6 = await prisma.user.findUnique({ where: { slot: originalIntegrante5.slot } });
    if (existingSlot6 && existingSlot6.id !== originalIntegrante5.id) {
      await prisma.user.delete({ where: { id: existingSlot6.id } });
    }

    const existsOriginal5 = await prisma.user.findUnique({ where: { id: originalIntegrante5.id } });
    if (!existsOriginal5) {
      await prisma.user.create({
        data: {
          id: originalIntegrante5.id,
          username: originalIntegrante5.username,
          passwordHash: originalIntegrante5.passwordHash,
          displayName: originalIntegrante5.displayName,
          role: originalIntegrante5.role,
          avatar: originalIntegrante5.avatar as Prisma.InputJsonValue,
          slot: originalIntegrante5.slot,
          tokenVersion: originalIntegrante5.tokenVersion,
          createdAt: originalIntegrante5.createdAt,
        },
      });
    }

    if (assignedTasks.length > 0) {
      await prisma.task.updateMany({
        where: { id: { in: assignedTasks.map((t) => t.id) } },
        data: { assigneeId: originalIntegrante5.id },
      });
    }
    if (createdTasks.length > 0) {
      await prisma.task.updateMany({
        where: { id: { in: createdTasks.map((t) => t.id) } },
        data: { createdById: originalIntegrante5.id },
      });
    }
    if (authoredComments.length > 0) {
      await prisma.comment.createMany({
        data: authoredComments.map((c) => ({
          id: c.id,
          taskId: c.taskId,
          authorId: originalIntegrante5.id,
          content: c.content,
          createdAt: c.createdAt,
        })),
        skipDuplicates: true,
      });
    }

    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[test:auth] ERROR:', err);
  process.exitCode = 1;
});
