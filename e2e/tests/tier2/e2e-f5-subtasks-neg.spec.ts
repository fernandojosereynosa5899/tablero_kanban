import { expect, test } from '@playwright/test';
import { apiRequest } from '../../harness/api-client';
import {
  cleanupExtraTasks,
  createTestTask,
  getRoleSession,
  isStrictM2M3,
} from '../../harness/fixtures';

test.describe('Tier 2 — E2E-F5: Subtask RBAC & APPROVED Lock Negative Cases', () => {
  test.afterEach(async () => {
    await cleanupExtraTasks();
  });

  test('5.1 SUBLEADER and MEMBER cannot create subtasks via POST /api/tasks/:id/subtasks (403)', async () => {
    const leader = getRoleSession('lider');
    const subleader = getRoleSession('integrante5');
    const member = getRoleSession('integrante1');
    const task = await createTestTask(leader.token, { assignedToAll: true });

    for (const actor of [subleader, member]) {
      const res = await apiRequest(`/api/tasks/${task.id}/subtasks`, {
        method: 'POST',
        token: actor.token,
        body: { title: 'Unauthorized subtask' },
      });
      expect(res.status).toBe(403);
    }
  });

  test('5.2 SUBLEADER and MEMBER cannot delete subtasks via DELETE /api/subtasks/:id (403)', async () => {
    const leader = getRoleSession('lider');
    const subleader = getRoleSession('integrante5');
    const member = getRoleSession('integrante1');
    const task = await createTestTask(leader.token, { assignedToAll: true });
    const subId = task.subtasks[0].id;

    for (const actor of [subleader, member]) {
      const res = await apiRequest(`/api/subtasks/${subId}`, {
        method: 'DELETE',
        token: actor.token,
      });
      expect(res.status).toBe(403);
    }
  });

  test('5.3 MEMBER cannot toggle subtask on another member task (Solo lectura -> 403)', async () => {
    const leader = getRoleSession('lider');
    const member1 = getRoleSession('integrante1');
    const member2 = getRoleSession('integrante2');
    const task = await createTestTask(leader.token, { assigneeId: member2.user.id });
    const subId = task.subtasks[0].id;

    const res = await apiRequest(`/api/subtasks/${subId}`, {
      method: 'PATCH',
      token: member1.token,
      body: { done: true },
    });
    expect(res.status).toBe(403);
  });

  test('5.4 Non-leader cannot rename subtask title via PATCH /api/subtasks/:id (403)', async () => {
    const leader = getRoleSession('lider');
    const subleader = getRoleSession('integrante5');
    const member = getRoleSession('integrante1');
    const task = await createTestTask(leader.token, { assignedToAll: true });
    const subId = task.subtasks[0].id;

    for (const actor of [subleader, member]) {
      const res = await apiRequest(`/api/subtasks/${subId}`, {
        method: 'PATCH',
        token: actor.token,
        body: { title: 'Renamed by non-leader' },
      });
      expect(res.status).toBe(403);
    }
  });

  test('5.5 Non-leader toggling subtask on APPROVED task (enforces 403 under E2E_STRICT_M2_M3)', async () => {
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante1');
    const task = await createTestTask(leader.token, {
      status: 'APPROVED',
      assigneeId: member.user.id,
      subtasks: ['Approved step'],
    });
    const subId = task.subtasks[0].id;

    const res = await apiRequest(`/api/subtasks/${subId}`, {
      method: 'PATCH',
      token: member.token,
      body: { done: true },
    });

    if (isStrictM2M3()) {
      expect(res.status).toBe(403);
    } else {
      // Pre-M2 updateSubtask lacked parent status === APPROVED check; allow 200 or 403 until M2 lands
      expect([200, 403]).toContain(res.status);
    }
  });
});
