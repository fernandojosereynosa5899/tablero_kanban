import { expect, test } from '@playwright/test';
import {
  connectSocket,
  emitSocketAck,
  getRuntimeState,
} from '../../harness/api-client';
import {
  cleanupExtraTasks,
  createTestTask,
  ensureMaintenanceDisabled,
  getRoleSession,
  isStrictM2M3,
  seedBrowserAuth,
} from '../../harness/fixtures';
import { apiRequest } from '../../harness/api-client';

test.describe('Tier 2 — E2E-F8: Socket.IO Auth, Rate Limits & Disconnection Negative Cases', () => {
  test.afterEach(async () => {
    await ensureMaintenanceDisabled();
    await cleanupExtraTasks();
  });

  test('8.1 Socket.IO without token or with invalid JWT is rejected with unauthorized', async () => {
    await expect(connectSocket(undefined)).rejects.toThrow(/unauthorized/i);
    await expect(connectSocket('invalid.jwt.token')).rejects.toThrow(/unauthorized/i);
  });

  test('8.2 Socket.IO rejects MEMBER with maintenance error during maintenance while LEADER connects', async () => {
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante1');

    await apiRequest('/api/maintenance', {
      method: 'PATCH',
      token: leader.token,
      body: { enabled: true },
    });

    await expect(connectSocket(member.token)).rejects.toThrow(/maintenance/i);

    const sLeader = await connectSocket(leader.token);
    expect(sLeader.connected).toBe(true);
    sLeader.disconnect();
  });

  test('8.3 Socket.IO task:move with invalid status or nonexistent taskId returns { ok: false }', async () => {
    const leader = getRoleSession('lider');
    const task = await createTestTask(leader.token);
    const sLeader = await connectSocket(leader.token);

    try {
      const badStatus = await emitSocketAck<{ ok: boolean; error?: string }>(sLeader, 'task:move', {
        taskId: task.id,
        status: 'INVALID_COL',
      });
      expect(badStatus.ok).toBe(false);

      const missingTask = await emitSocketAck<{ ok: boolean; error?: string }>(sLeader, 'task:move', {
        taskId: 'nonexistent_task_1234',
        status: 'DONE',
      });
      expect(missingTask.ok).toBe(false);
    } finally {
      sLeader.disconnect();
    }
  });

  test('8.4 Socket.IO task:move exceeding 25 events / 10s hits per-socket rate limit cleanly', async () => {
    const leader = getRoleSession('lider');
    const task = await createTestTask(leader.token, { status: 'TODO' });
    const sLeader = await connectSocket(leader.token);

    try {
      const results: Array<{ ok: boolean }> = [];
      for (let i = 0; i < 28; i++) {
        const res = await emitSocketAck<{ ok: boolean }>(sLeader, 'task:move', {
          taskId: task.id,
          status: i % 2 === 0 ? 'IN_PROGRESS' : 'TODO',
        });
        results.push(res);
      }
      expect(results.slice(0, 25).every((r) => r.ok)).toBe(true);
      expect(results.slice(25).some((r) => !r.ok)).toBe(true);
    } finally {
      sLeader.disconnect();
    }
  });

  test('8.5 Blocking Socket.IO transport in browser updates connection state without crashing UI', async ({ page }) => {
    const state = getRuntimeState();
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.route(`${state.apiUrl}/socket.io/**`, (route) => route.abort());
    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    await expect(page.getByRole('heading', { name: 'Tablero Kanban' })).toBeVisible();
    if (isStrictM2M3()) {
      await expect(page.getByText(/Sin conexión|Reconectando|Desconectado/i).first()).toBeVisible();
    }
    expect(pageErrors).toHaveLength(0);
  });
});
