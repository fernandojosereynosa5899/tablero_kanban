import { expect, test } from '@playwright/test';
import {
  apiRequest,
  connectSocket,
  getRuntimeState,
  waitForSocketEvent,
} from '../../harness/api-client';
import {
  cleanupExtraTasks,
  createTestTask,
  getRoleSession,
  seedBrowserAuth,
} from '../../harness/fixtures';

test.describe('Tier 1 — E2E-F6: Comments & Real-Time Typing Indicator', () => {
  test.afterEach(async () => {
    await cleanupExtraTasks();
  });

  test('6.1 Authenticated user posts a comment in TaskDetailModal UI', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const title = `E2E CommentUI ${Date.now()}`;
    await createTestTask(leader.token, { title });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    await page.locator(`article[aria-label^="Tarea ${title}."]`).click();
    const dialog = page.locator('div[role="dialog"][aria-labelledby="task-detail-title"]');
    await dialog.getByLabel('Nuevo comentario').fill('Comentario publicado desde UI');
    await dialog.getByRole('button', { name: 'Enviar' }).click();

    await expect(dialog.getByText('Comentario publicado desde UI')).toBeVisible();
  });

  test('6.2 Member can comment on a Solo lectura task and delete their own comment', async () => {
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante1');
    const task = await createTestTask(leader.token, { assigneeId: leader.user.id });

    const postRes = await apiRequest<{ id: string; content: string }>(
      `/api/tasks/${task.id}/comments`,
      {
        method: 'POST',
        token: member.token,
        body: { content: 'Aporte de integrante en tarjeta ajena' },
      },
    );
    expect(postRes.status).toBe(201);
    expect(postRes.data.content).toBe('Aporte de integrante en tarjeta ajena');

    const delRes = await apiRequest<{ ok: boolean }>(`/api/comments/${postRes.data.id}`, {
      method: 'DELETE',
      token: member.token,
    });
    expect(delRes.status).toBe(200);
    expect(delRes.data.ok).toBe(true);
  });

  test('6.3 Leader can delete any user comment on any task', async () => {
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante2');
    const task = await createTestTask(leader.token, { assigneeId: member.user.id });

    const postRes = await apiRequest<{ id: string }>(`/api/tasks/${task.id}/comments`, {
      method: 'POST',
      token: member.token,
      body: { content: 'Comentario a moderar por líder' },
    });
    expect(postRes.status).toBe(201);

    const delRes = await apiRequest<{ ok: boolean }>(`/api/comments/${postRes.data.id}`, {
      method: 'DELETE',
      token: leader.token,
    });
    expect(delRes.status).toBe(200);
    expect(delRes.data.ok).toBe(true);
  });

  test('6.4 Socket.IO comment:typing broadcasts to peer clients with userId and displayName', async () => {
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante1');
    const task = await createTestTask(leader.token);

    const sLeader = await connectSocket(leader.token);
    const sMember = await connectSocket(member.token);
    try {
      const typingPromise = waitForSocketEvent<{
        taskId: string;
        userId: string;
        displayName: string;
        isTyping: boolean;
      }>(sLeader, 'comment:typing', (p) => p.taskId === task.id && p.userId === member.user.id);

      sMember.emit('comment:typing', { taskId: task.id, isTyping: true });
      const payload = await typingPromise;
      expect(payload.isTyping).toBe(true);
      expect(payload.displayName).toBe(member.user.displayName);
    } finally {
      sLeader.disconnect();
      sMember.disconnect();
    }
  });

  test('6.5 UI TaskDetailModal renders live typing indicator when peer emits comment:typing', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante1');
    const title = `E2E TypingUI ${Date.now()}`;
    const task = await createTestTask(leader.token, { title });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);
    await page.locator(`article[aria-label^="Tarea ${title}."]`).click();

    const dialog = page.locator('div[role="dialog"][aria-labelledby="task-detail-title"]');
    await expect(dialog).toBeVisible();

    const sMember = await connectSocket(member.token);
    try {
      sMember.emit('comment:typing', { taskId: task.id, isTyping: true });
      await expect(dialog.getByRole('status')).toContainText('está escribiendo un comentario');
    } finally {
      sMember.disconnect();
    }
  });
});
