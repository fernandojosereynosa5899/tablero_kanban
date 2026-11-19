import { expect, test } from '@playwright/test';
import {
  apiRequest,
  connectSocket,
  emitSocketAck,
} from '../../harness/api-client';
import {
  cleanupExtraTasks,
  createTestTask,
  getRoleSession,
} from '../../harness/fixtures';

test.describe('Tier 2 — E2E-F3: Board RBAC, Solo lectura & APPROVED Lock Negative Cases', () => {
  test.afterEach(async () => {
    await cleanupExtraTasks();
  });

  test('3.1 MEMBER attempting POST /api/tasks is rejected with 403', async () => {
    const member = getRoleSession('integrante1');
    const res = await apiRequest('/api/tasks', {
      method: 'POST',
      token: member.token,
      body: {
        title: 'Unauthorized member task',
        description: 'Should fail',
        priority: 'LOW',
        dueDate: '2026-12-01T12:00:00.000Z',
        status: 'TODO',
        subtasks: ['S1'],
        assignedToAll: true,
      },
    });
    expect(res.status).toBe(403);
  });

  test('3.2 SUBLEADER attempting POST /api/tasks directly into APPROVED is rejected with 403', async () => {
    const subleader = getRoleSession('integrante5');
    const res = await apiRequest('/api/tasks', {
      method: 'POST',
      token: subleader.token,
      body: {
        title: 'Subleader direct approve',
        description: 'Should fail',
        priority: 'MEDIUM',
        dueDate: '2026-12-01T12:00:00.000Z',
        status: 'APPROVED',
        subtasks: ['S1'],
        assignedToAll: true,
      },
    });
    expect(res.status).toBe(403);
  });

  test('3.3 SUBLEADER and MEMBER attempting PATCH or DELETE /api/tasks/:id receive 403', async () => {
    const leader = getRoleSession('lider');
    const subleader = getRoleSession('integrante5');
    const member = getRoleSession('integrante1');
    const task = await createTestTask(leader.token, { assigneeId: member.user.id });

    for (const actor of [subleader, member]) {
      const patchRes = await apiRequest(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        token: actor.token,
        body: { title: 'Tampered Title' },
      });
      expect(patchRes.status).toBe(403);

      const delRes = await apiRequest(`/api/tasks/${task.id}`, {
        method: 'DELETE',
        token: actor.token,
      });
      expect(delRes.status).toBe(403);
    }
  });

  test('3.4 MEMBER attempting to move another member task (Solo lectura) receives 403', async () => {
    const leader = getRoleSession('lider');
    const member1 = getRoleSession('integrante1');
    const member2 = getRoleSession('integrante2');
    const task = await createTestTask(leader.token, { assigneeId: member2.user.id });

    const moveRes = await apiRequest(`/api/tasks/${task.id}/move`, {
      method: 'PATCH',
      token: member1.token,
      body: { status: 'IN_PROGRESS' },
    });
    expect(moveRes.status).toBe(403);
  });

  test('3.5 SUBLEADER and MEMBER cannot move task INTO APPROVED or move OUT of APPROVED (403)', async () => {
    const leader = getRoleSession('lider');
    const subleader = getRoleSession('integrante5');
    const member = getRoleSession('integrante1');

    const doneTask = await createTestTask(leader.token, {
      status: 'DONE',
      assignedToAll: true,
    });
    const approvedTask = await createTestTask(leader.token, {
      status: 'APPROVED',
      assignedToAll: true,
    });

    for (const actor of [subleader, member]) {
      const intoApproved = await apiRequest(`/api/tasks/${doneTask.id}/move`, {
        method: 'PATCH',
        token: actor.token,
        body: { status: 'APPROVED' },
      });
      expect(intoApproved.status).toBe(403);

      const outOfApproved = await apiRequest(`/api/tasks/${approvedTask.id}/move`, {
        method: 'PATCH',
        token: actor.token,
        body: { status: 'DONE' },
      });
      expect(outOfApproved.status).toBe(403);
    }
  });

  test('3.6 Socket.IO task:move on Solo lectura or APPROVED task returns { ok: false } without mutating DB', async () => {
    const leader = getRoleSession('lider');
    const member1 = getRoleSession('integrante1');
    const member2 = getRoleSession('integrante2');

    const lockedTask = await createTestTask(leader.token, {
      status: 'TODO',
      assigneeId: member2.user.id,
    });
    const approvedTask = await createTestTask(leader.token, {
      status: 'APPROVED',
      assigneeId: member1.user.id,
    });

    const sMember = await connectSocket(member1.token);
    try {
      const ack1 = await emitSocketAck<{ ok: boolean; error?: string }>(sMember, 'task:move', {
        taskId: lockedTask.id,
        status: 'IN_PROGRESS',
      });
      expect(ack1.ok).toBe(false);
      expect(ack1.error).toBeTruthy();

      const ack2 = await emitSocketAck<{ ok: boolean; error?: string }>(sMember, 'task:move', {
        taskId: approvedTask.id,
        status: 'DONE',
      });
      expect(ack2.ok).toBe(false);
    } finally {
      sMember.disconnect();
    }
  });
});
