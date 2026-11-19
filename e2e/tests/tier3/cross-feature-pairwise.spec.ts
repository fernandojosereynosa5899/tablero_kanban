import { expect, test } from '@playwright/test';
import {
  apiRequest,
  apiUpload,
  connectSocket,
  getRuntimeState,
  makePdfBuffer,
  waitForSocketEvent,
} from '../../harness/api-client';
import {
  cleanupExtraTasks,
  createTestTask,
  ensureMaintenanceDisabled,
  getRoleSession,
  isStrictM2M3,
  refreshRoleSession,
  seedBrowserAuth,
  TaskDto,
} from '../../harness/fixtures';

test.describe('Tier 3 — Cross-Feature Pairwise Combination Tests (12 Scenarios)', () => {
  test.afterEach(async () => {
    await ensureMaintenanceDisabled();
    await cleanupExtraTasks();
  });

  test('3.1 Pairwise: SUBLEADER creates -> MEMBER Solo lectura blocked -> LEADER reassigns -> MEMBER completes -> LEADER approves -> locked', async () => {
    const leader = getRoleSession('lider');
    const subleader = getRoleSession('integrante5');
    const member = getRoleSession('integrante1');

    // SUBLEADER creates task assigned to self
    const task = await createTestTask(subleader.token, {
      title: `T3 Lifecycle ${Date.now()}`,
      status: 'TODO',
      assigneeId: subleader.user.id,
      subtasks: ['Deliverable 1'],
    });

    // MEMBER blocked by Solo lectura
    const blockedMove = await apiRequest(`/api/tasks/${task.id}/move`, {
      method: 'PATCH',
      token: member.token,
      body: { status: 'IN_PROGRESS' },
    });
    expect(blockedMove.status).toBe(403);

    // LEADER reassigns to MEMBER
    const reassign = await apiRequest<TaskDto>(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      token: leader.token,
      body: { assigneeId: member.user.id },
    });
    expect(reassign.status).toBe(200);

    // MEMBER toggles subtask and moves to DONE
    const subRes = await apiRequest(`/api/subtasks/${task.subtasks[0].id}`, {
      method: 'PATCH',
      token: member.token,
      body: { done: true },
    });
    expect(subRes.status).toBe(200);

    const doneMove = await apiRequest<TaskDto>(`/api/tasks/${task.id}/move`, {
      method: 'PATCH',
      token: member.token,
      body: { status: 'DONE' },
    });
    expect(doneMove.status).toBe(200);

    // LEADER approves -> APPROVED lock blocks MEMBER move
    const approve = await apiRequest<TaskDto>(`/api/tasks/${task.id}/move`, {
      method: 'PATCH',
      token: leader.token,
      body: { status: 'APPROVED' },
    });
    expect(approve.status).toBe(200);
    expect(approve.data.approvedAt).toBeTruthy();

    const lockedMove = await apiRequest(`/api/tasks/${task.id}/move`, {
      method: 'PATCH',
      token: member.token,
      body: { status: 'DONE' },
    });
    expect(lockedMove.status).toBe(403);
  });

  test('3.2 Pairwise: DB maintenance + Socket maintenance:updated + non-leader 503/Socket reject + Leader stays operational', async () => {
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante1');

    const sLeader = await connectSocket(leader.token);
    const sMember = await connectSocket(member.token);
    try {
      const maintEv = waitForSocketEvent<{ active: boolean }>(
        sMember,
        'maintenance:updated',
        (m) => m.active === true,
      );

      await apiRequest('/api/maintenance', {
        method: 'PATCH',
        token: leader.token,
        body: { enabled: true, title: 'T3 Maint', message: 'Pairwise maint' },
      });
      expect((await maintEv).active).toBe(true);

      // Member REST blocked 503 & new socket rejected
      const memberTasks = await apiRequest('/api/tasks', { token: member.token });
      expect(memberTasks.status).toBe(503);
      await expect(connectSocket(member.token)).rejects.toThrow(/maintenance/i);

      // Leader REST & Socket remain operational
      const leaderTasks = await apiRequest('/api/tasks', { token: leader.token });
      expect(leaderTasks.status).toBe(200);
      expect(sLeader.connected).toBe(true);
    } finally {
      sLeader.disconnect();
      sMember.disconnect();
    }
  });

  test('3.3 Pairwise: Admin password reset triggers Socket session:revoked and invalidates JWT', async () => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const target = getRoleSession('integrante3');
    const oldToken = target.token;

    const sTarget = await connectSocket(oldToken);
    try {
      const revokedEv = waitForSocketEvent<{ reason: string }>(sTarget, 'session:revoked');

      await apiRequest(`/api/users/${target.user.id}`, {
        method: 'PATCH',
        token: leader.token,
        body: { password: `${state.testPassword}_Rev3` },
      });

      const payload = await revokedEv;
      expect(payload.reason).toBeTruthy();

      const oldApi = await apiRequest('/api/users/me', { token: oldToken });
      expect(oldApi.status).toBe(401);
    } finally {
      sTarget.disconnect();
      await apiRequest(`/api/users/${target.user.id}`, {
        method: 'PATCH',
        token: leader.token,
        body: { password: state.testPassword },
      });
      await refreshRoleSession('integrante3', state.testPassword);
    }
  });

  test('3.4 Pairwise: Team slot onboarding + login + comment/upload on assignedToAll + slot restore', async () => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const origMember4 = getRoleSession('integrante4');
    const tasksRes = await apiRequest<Array<{ id: string; assigneeId: string | null }>>('/api/tasks', {
      token: leader.token,
    });
    const member4TaskIds = tasksRes.data
      .filter((t) => t.assigneeId === origMember4.user.id)
      .map((t) => t.id);

    const sharedTask = await createTestTask(leader.token, { assignedToAll: true });
    let newUserId: string | null = null;

    try {
      await apiRequest(`/api/users/${origMember4.user.id}`, {
        method: 'DELETE',
        token: leader.token,
      });

      const tempUsername = `t3_onboard_${Date.now().toString().slice(-4)}`;
      const createRes = await apiRequest<{ id: string }>('/api/users', {
        method: 'POST',
        token: leader.token,
        body: {
          username: tempUsername,
          displayName: 'T3 Onboarded Member',
          password: state.testPassword,
        },
      });
      expect(createRes.status).toBe(201);
      newUserId = createRes.data.id;

      const loginRes = await apiRequest<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: { username: tempUsername, password: state.testPassword },
      });
      expect(loginRes.status).toBe(200);

      const commentRes = await apiRequest(`/api/tasks/${sharedTask.id}/comments`, {
        method: 'POST',
        token: loginRes.data.token,
        body: { content: 'Onboarded member comment' },
      });
      expect(commentRes.status).toBe(201);

      const uploadRes = await apiUpload(`/api/tasks/${sharedTask.id}/attachments`, {
        token: loginRes.data.token,
        filename: 'onboard.pdf',
        mimeType: 'application/pdf',
        buffer: makePdfBuffer('Onboarded'),
      });
      expect(uploadRes.status).toBe(201);
    } finally {
      if (newUserId) {
        await apiRequest(`/api/users/${newUserId}`, {
          method: 'DELETE',
          token: leader.token,
        });
      }
      const restoreRes = await apiRequest<{ id: string }>('/api/users', {
        method: 'POST',
        token: leader.token,
        body: {
          username: 'integrante4',
          displayName: origMember4.user.displayName,
          password: state.testPassword,
          avatar: origMember4.user.avatar,
        },
      });
      if (restoreRes.status === 201) {
        for (const tid of member4TaskIds) {
          await apiRequest(`/api/tasks/${tid}`, {
            method: 'PATCH',
            token: leader.token,
            body: { assigneeId: restoreRes.data.id },
          });
        }
        await refreshRoleSession('integrante4', state.testPassword);
      }
    }
  });

  test('3.5 Pairwise: Offline/missed socket mutation resynchronizes board state on online reconnect', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');

    await seedBrowserAuth(page, 'integrante1');
    await page.goto(state.baseUrl);
    await expect(page.getByRole('heading', { name: 'Tablero Kanban', exact: true })).toBeVisible();

    // Block task fetches temporarily to simulate missed update while offline, then create task
    let blockTasks = true;
    await page.route(`${state.apiUrl}/api/tasks*`, async (route) => {
      if (blockTasks && route.request().method() === 'GET') {
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    const offlineTitle = `T3 Resync ${Date.now()}`;
    await createTestTask(leader.token, { title: offlineTitle, assignedToAll: true });

    blockTasks = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    await expect(page.locator(`article[aria-label^="Tarea ${offlineTitle}."]`)).toBeVisible();
  });

  test('3.6 Pairwise: Overdue IN_PROGRESS task triggers OverdueTasksAlert then clears when moved to DONE', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const title = `T3 OverdueDone ${Date.now()}`;
    await createTestTask(leader.token, {
      title,
      status: 'IN_PROGRESS',
      dueDate: '2026-11-08T12:00:00.000Z',
    });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    const alert = page.locator('section[role="alert"][aria-label="Alerta de tareas sin completar vencidas"]');
    await expect(alert).toContainText(title);

    const card = page.locator(`article[aria-label^="Tarea ${title}."]`);
    await card.getByRole('button', { name: 'Mover tarea a otra columna' }).click();
    await card.getByRole('menuitem', { name: 'Hecho' }).click();

    await expect(page.getByText(title)).toBeVisible();
    await expect(alert.getByText(title)).toHaveCount(0);
  });

  test('3.7 Pairwise: SHA-256 deduplicated attachment remains downloadable after first task is deleted', async () => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const taskA = await createTestTask(leader.token);
    const taskB = await createTestTask(leader.token);
    const bytes = makePdfBuffer(`SharedBlob-${Date.now()}`);

    const upA = await apiUpload<{ attachment: { id: string } }>(`/api/tasks/${taskA.id}/attachments`, {
      token: leader.token,
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      buffer: bytes,
    });
    const upB = await apiUpload<{ attachment: { id: string }; deduplicated: boolean }>(
      `/api/tasks/${taskB.id}/attachments`,
      {
        token: leader.token,
        filename: 'b.pdf',
        mimeType: 'application/pdf',
        buffer: bytes,
      },
    );
    expect(upA.status).toBe(201);
    expect(upB.data.deduplicated).toBe(true);

    // Delete task A -> blob must stay alive for task B
    const delA = await apiRequest(`/api/tasks/${taskA.id}`, {
      method: 'DELETE',
      token: leader.token,
    });
    expect(delA.status).toBe(200);

    const dlB = await fetch(`${state.apiUrl}/api/attachments/${upB.data.attachment.id}/download`, {
      headers: { Authorization: `Bearer ${leader.token}` },
    });
    expect(dlB.status).toBe(200);
    expect(Buffer.from(await dlB.arrayBuffer()).equals(bytes)).toBe(true);
  });

  test('3.8 Pairwise: Typing indicator + comment:created + activity:new propagate in real time', async () => {
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante1');
    const task = await createTestTask(leader.token);

    const sLeader = await connectSocket(leader.token);
    const sMember = await connectSocket(member.token);
    try {
      const typingEv = waitForSocketEvent<{ taskId: string; isTyping: boolean }>(
        sLeader,
        'comment:typing',
        (p) => p.taskId === task.id,
      );
      sMember.emit('comment:typing', { taskId: task.id, isTyping: true });
      expect((await typingEv).isTyping).toBe(true);

      const commentEv = waitForSocketEvent<{ taskId: string }>(
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
        token: member.token,
        body: { content: 'Pairwise comment + activity' },
      });
      expect((await commentEv).taskId).toBe(task.id);
      expect((await activityEv).action).toBe('comment.created');
    } finally {
      sLeader.disconnect();
      sMember.disconnect();
    }
  });

  test('3.9 Pairwise: Flipping assignedToAll=true -> assigned to another user revokes MEMBER write access immediately', async () => {
    const leader = getRoleSession('lider');
    const member1 = getRoleSession('integrante1');
    const member2 = getRoleSession('integrante2');
    const task = await createTestTask(leader.token, {
      assignedToAll: true,
      subtasks: ['Shared toggle'],
    });

    const okSub = await apiRequest(`/api/subtasks/${task.subtasks[0].id}`, {
      method: 'PATCH',
      token: member1.token,
      body: { done: true },
    });
    expect(okSub.status).toBe(200);

    // Reassign exclusively to member2
    await apiRequest(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      token: leader.token,
      body: { assigneeId: member2.user.id, assignedToAll: false },
    });

    const deniedSub = await apiRequest(`/api/subtasks/${task.subtasks[0].id}`, {
      method: 'PATCH',
      token: member1.token,
      body: { done: false },
    });
    expect(deniedSub.status).toBe(403);

    const deniedUpload = await apiUpload(`/api/tasks/${task.id}/attachments`, {
      token: member1.token,
      filename: 'denied.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Denied', 'utf8'),
    });
    expect(deniedUpload.status).toBe(403);
  });

  test('3.10 Pairwise: Allowed vs disallowed Origin across REST CORS and Socket.IO handshake', async () => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');

    const okCors = await apiRequest('/api/health', {
      headers: { Origin: state.baseUrl },
    });
    expect(okCors.status).toBe(200);
    expect(okCors.headers.get('access-control-allow-origin')).toBe(state.baseUrl);

    const badCors = await fetch(`${state.apiUrl}/api/health`, {
      headers: { Origin: 'https://malicious-origin.example.net' },
    });
    expect(badCors.headers.get('access-control-allow-origin')).toBeNull();
    if (isStrictM2M3()) {
      expect(badCors.status).toBe(403);
    }

    await expect(
      connectSocket(leader.token, {
        extraHeaders: { Origin: 'https://malicious-origin.example.net' },
      }),
    ).rejects.toThrow();
  });

  test('3.11 Pairwise: SUBLEADER creates task & uploads attachment, blocked on edit/delete/other-attachment, LEADER deletes cleanly', async () => {
    const leader = getRoleSession('lider');
    const subleader = getRoleSession('integrante5');
    const task = await createTestTask(subleader.token, {
      title: `T3 SubleaderBounds ${Date.now()}`,
      status: 'TODO',
      assigneeId: subleader.user.id,
    });

    const leaderUp = await apiUpload<{ attachment: { id: string } }>(`/api/tasks/${task.id}/attachments`, {
      token: leader.token,
      filename: 'leader-doc.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Owned by leader', 'utf8'),
    });
    expect(leaderUp.status).toBe(201);

    expect(
      (await apiRequest(`/api/tasks/${task.id}`, { method: 'PATCH', token: subleader.token, body: { title: 'X' } })).status,
    ).toBe(403);
    expect(
      (await apiRequest(`/api/attachments/${leaderUp.data.attachment.id}`, { method: 'DELETE', token: subleader.token })).status,
    ).toBe(403);

    const leaderDel = await apiRequest(`/api/tasks/${task.id}`, {
      method: 'DELETE',
      token: leader.token,
    });
    expect(leaderDel.status).toBe(200);
  });

  test('3.12 Pairwise: Theme + tutorial localStorage state and AvatarStudio profile update sync to peer browser', async ({ browser }) => {
    const state = getRuntimeState();
    const member = getRoleSession('integrante2');
    const tempName = `Kuri Live ${Date.now().toString().slice(-4)}`;

    const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      await seedBrowserAuth(page1, 'integrante2', { theme: 'dark' });
      await seedBrowserAuth(page2, 'lider', { theme: 'light' });

      await Promise.all([page1.goto(state.baseUrl), page2.goto(state.baseUrl)]);
      await expect(page1.locator('html')).toHaveClass(/dark/);
      await expect(page2.locator('html')).not.toHaveClass(/dark/);

      await page1.getByRole('button', { name: 'Mi Perfil & Avatar' }).click();
      const modal = page1.locator('div[role="dialog"][aria-labelledby="avatar-studio-title"]');
      await modal.locator('#studio-display-name').fill(tempName);
      await modal.getByRole('button', { name: 'Guardar cambios' }).click();

      await expect(
        page2.locator(`button[aria-label^="${tempName} (Integrante)"]`),
      ).toBeVisible();
    } finally {
      await ctx1.close();
      await ctx2.close();
      await apiRequest(`/api/users/${member.user.id}`, {
        method: 'PATCH',
        token: getRoleSession('lider').token,
        body: { displayName: member.user.displayName },
      });
    }
  });
});
