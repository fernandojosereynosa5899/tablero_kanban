import { expect, test } from '@playwright/test';
import {
  apiRequest,
  connectSocket,
} from '../../harness/api-client';
import {
  cleanupExtraTasks,
  createTestTask,
  getRoleSession,
} from '../../harness/fixtures';

test.describe('Tier 2 — E2E-F6: Comments & Typing Negative / Boundary Cases', () => {
  test.afterEach(async () => {
    await cleanupExtraTasks();
  });

  test('6.1 Empty/whitespace or oversized comment (>2000 chars) is rejected with 400', async () => {
    const leader = getRoleSession('lider');
    const task = await createTestTask(leader.token);

    const empty = await apiRequest(`/api/tasks/${task.id}/comments`, {
      method: 'POST',
      token: leader.token,
      body: { content: '   ' },
    });
    expect(empty.status).toBe(400);

    const tooLong = await apiRequest(`/api/tasks/${task.id}/comments`, {
      method: 'POST',
      token: leader.token,
      body: { content: 'A'.repeat(2100) },
    });
    expect(tooLong.status).toBe(400);
  });

  test('6.2 Posting comment to nonexistent task returns 404', async () => {
    const leader = getRoleSession('lider');
    const res = await apiRequest('/api/tasks/task_missing_9999/comments', {
      method: 'POST',
      token: leader.token,
      body: { content: 'Hello missing task' },
    });
    expect(res.status).toBe(404);
  });

  test('6.3 MEMBER attempting to delete another user comment receives 403', async () => {
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante1');
    const task = await createTestTask(leader.token, { assigneeId: member.user.id });

    const leaderComment = await apiRequest<{ id: string }>(`/api/tasks/${task.id}/comments`, {
      method: 'POST',
      token: leader.token,
      body: { content: 'Leader protected comment' },
    });
    expect(leaderComment.status).toBe(201);

    const delAttempt = await apiRequest(`/api/comments/${leaderComment.data.id}`, {
      method: 'DELETE',
      token: member.token,
    });
    expect(delAttempt.status).toBe(403);
  });

  test('6.4 Malformed comment:typing Socket.IO payloads are ignored safely without broadcast', async () => {
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante1');
    const sLeader = await connectSocket(leader.token);
    const sMember = await connectSocket(member.token);

    let received = false;
    sLeader.on('comment:typing', () => {
      received = true;
    });

    try {
      sMember.emit('comment:typing', { taskId: '', isTyping: true });
      sMember.emit('comment:typing', { taskId: 'x'.repeat(80), isTyping: true });
      sMember.emit('comment:typing', { isTyping: 'yes' });
      await new Promise((r) => setTimeout(r, 350));
      expect(received).toBe(false);
    } finally {
      sLeader.disconnect();
      sMember.disconnect();
    }
  });

  test('6.5 Rapid burst (>25) of comment:typing events is throttled cleanly without disconnecting socket', async () => {
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante1');
    const task = await createTestTask(leader.token);
    const sLeader = await connectSocket(leader.token);
    const sMember = await connectSocket(member.token);

    let count = 0;
    sLeader.on('comment:typing', (p: { taskId: string }) => {
      if (p.taskId === task.id) count++;
    });

    try {
      for (let i = 0; i < 35; i++) {
        sMember.emit('comment:typing', { taskId: task.id, isTyping: true });
      }
      await new Promise((r) => setTimeout(r, 500));
      expect(sMember.connected).toBe(true);
      expect(count).toBeLessThanOrEqual(25);
    } finally {
      sLeader.disconnect();
      sMember.disconnect();
    }
  });
});
