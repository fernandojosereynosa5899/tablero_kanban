import { expect, test } from '@playwright/test';
import {
  apiRequest,
  apiUpload,
  connectSocket,
  emitSocketAck,
  getRuntimeState,
  makePdfBuffer,
  waitForSocketEvent,
} from '../../harness/api-client';
import {
  cleanupExtraTasks,
  createTestTask,
  getRoleSession,
  isStrictM2M3,
  seedBrowserAuth,
  TaskDto,
} from '../../harness/fixtures';

test.describe('Tier 1 — E2E-F8: Real-Time Socket.IO Collaboration & Presence', () => {
  test.afterEach(async () => {
    await cleanupExtraTasks();
  });

  test('8.1 Socket.IO presence updates onlineUserIds and TopHeader displays Conectados count', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante1');

    const sMember = await connectSocket(member.token);
    try {
      await seedBrowserAuth(page, 'lider');
      await page.goto(state.baseUrl);

      await expect(page.getByText(/Conectados \(\d+\/6\)/)).toBeVisible();
      await expect(
        page.locator(`button[aria-label="${leader.user.displayName} (Líder) — En línea"]`),
      ).toBeVisible();
      await expect(
        page.locator(`button[aria-label="${member.user.displayName} (Integrante) — En línea"]`),
      ).toBeVisible();
    } finally {
      sMember.disconnect();
    }
  });

  test('8.2 Socket.IO client->server task:move returns { ok: true, task } and broadcasts task:moved', async () => {
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante1');
    const task = await createTestTask(leader.token, { status: 'TODO', assigneeId: member.user.id });

    const sLeader = await connectSocket(leader.token);
    const sMember = await connectSocket(member.token);
    try {
      const movedPromise = waitForSocketEvent<{ task: TaskDto; fromStatus: string; toStatus: string }>(
        sLeader,
        'task:moved',
        (p) => p.task.id === task.id && p.toStatus === 'IN_PROGRESS',
      );

      const ack = await emitSocketAck<{ ok: boolean; task?: TaskDto }>(sMember, 'task:move', {
        taskId: task.id,
        status: 'IN_PROGRESS',
      });
      expect(ack.ok).toBe(true);
      expect(ack.task?.status).toBe('IN_PROGRESS');

      const movedEvent = await movedPromise;
      expect(movedEvent.fromStatus).toBe('TODO');
      expect(movedEvent.toStatus).toBe('IN_PROGRESS');
    } finally {
      sLeader.disconnect();
      sMember.disconnect();
    }
  });

  test('8.3 REST task create, update, and delete broadcast task:created, task:updated, and task:deleted', async () => {
    const leader = getRoleSession('lider');
    const sLeader = await connectSocket(leader.token);
    try {
      const createdPromise = waitForSocketEvent<TaskDto>(sLeader, 'task:created');
      const task = await createTestTask(leader.token, { title: `E2E SocketCRUD ${Date.now()}` });
      const created = await createdPromise;
      expect(created.id).toBe(task.id);

      const updatedPromise = waitForSocketEvent<TaskDto>(
        sLeader,
        'task:updated',
        (t) => t.id === task.id,
      );
      await apiRequest(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        token: leader.token,
        body: { priority: 'URGENT' },
      });
      const updated = await updatedPromise;
      expect(updated.priority).toBe('URGENT');

      const deletedPromise = waitForSocketEvent<{ id: string }>(
        sLeader,
        'task:deleted',
        (d) => d.id === task.id,
      );
      await apiRequest(`/api/tasks/${task.id}`, {
        method: 'DELETE',
        token: leader.token,
      });
      const deleted = await deletedPromise;
      expect(deleted.id).toBe(task.id);
    } finally {
      sLeader.disconnect();
    }
  });

  test('8.4 REST comment and attachment mutations broadcast comment:created, attachment:created, and activity:new', async () => {
    const leader = getRoleSession('lider');
    const task = await createTestTask(leader.token);
    const sLeader = await connectSocket(leader.token);

    try {
      const commentEv = waitForSocketEvent<{ taskId: string; comment: { content: string } }>(
        sLeader,
        'comment:created',
        (p) => p.taskId === task.id,
      );
      const activityEv = waitForSocketEvent<{ action: string }>(
        sLeader,
        'activity:new',
        (a) => a.action === 'comment.created',
      );

      await apiRequest(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        token: leader.token,
        body: { content: 'Socket event check' },
      });
      expect((await commentEv).comment.content).toBe('Socket event check');
      expect((await activityEv).action).toBe('comment.created');

      const attachEv = waitForSocketEvent<{ taskId: string; attachment: { originalName: string } }>(
        sLeader,
        'attachment:created',
        (p) => p.taskId === task.id,
      );
      await apiUpload(`/api/tasks/${task.id}/attachments`, {
        token: leader.token,
        filename: 'socket-file.pdf',
        mimeType: 'application/pdf',
        buffer: makePdfBuffer('Socket'),
      });
      expect((await attachEv).attachment.originalName).toBe('socket-file.pdf');
    } finally {
      sLeader.disconnect();
    }
  });

  test('8.5 Browser online resync (and M3 TopHeader isConnected badge under E2E_STRICT_M2_M3)', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);
    await expect(page.getByRole('heading', { name: 'Tablero Kanban' })).toBeVisible();

    if (isStrictM2M3()) {
      // M3 TopHeader renders explicit real-time connection badge (e.g. "En vivo" / "Conectado")
      await expect(page.getByText(/En vivo|Tiempo real activo|Conectado/i).first()).toBeVisible();
    }

    const resyncTitle = `E2E OnlineResync ${Date.now()}`;
    await createTestTask(leader.token, { title: resyncTitle });
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    await expect(page.locator(`article[aria-label^="Tarea ${resyncTitle}."]`)).toBeVisible();
  });
});
