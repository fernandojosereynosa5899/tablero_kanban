import { expect, test } from '@playwright/test';
import { apiRequest, getRuntimeState } from '../../harness/api-client';
import {
  cleanupExtraTasks,
  createTestTask,
  getRoleSession,
  isStrictM2M3,
  seedBrowserAuth,
  TaskDto,
} from '../../harness/fixtures';

test.describe('Tier 2 — E2E-F4: Task Validation, Date Boundaries & Overdue Boundary Cases', () => {
  test.afterEach(async () => {
    await cleanupExtraTasks();
  });

  test('4.1 POST /api/tasks missing required fields (empty subtasks, missing assignee, blank title) returns 400', async () => {
    const leader = getRoleSession('lider');
    const base = {
      title: 'Valid Title',
      description: 'Valid Desc',
      priority: 'MEDIUM',
      dueDate: '2026-12-01T12:00:00.000Z',
      status: 'TODO',
      subtasks: ['Step 1'],
      assigneeId: leader.user.id,
    };

    const emptySub = await apiRequest('/api/tasks', {
      method: 'POST',
      token: leader.token,
      body: { ...base, subtasks: [] },
    });
    expect(emptySub.status).toBe(400);

    const noAssignee = await apiRequest('/api/tasks', {
      method: 'POST',
      token: leader.token,
      body: { ...base, assigneeId: undefined, assignedToAll: false },
    });
    expect(noAssignee.status).toBe(400);

    const blankTitle = await apiRequest('/api/tasks', {
      method: 'POST',
      token: leader.token,
      body: { ...base, title: '   ' },
    });
    expect(blankTitle.status).toBe(400);
  });

  test('4.2 POST /api/tasks with dueDate before 2026-11-07T00:00:00.000Z returns 400', async () => {
    const leader = getRoleSession('lider');
    const res = await apiRequest('/api/tasks', {
      method: 'POST',
      token: leader.token,
      body: {
        title: 'Early date',
        description: 'Too early',
        priority: 'LOW',
        dueDate: '2026-11-06T23:59:59.999Z',
        status: 'TODO',
        subtasks: ['S1'],
        assignedToAll: true,
      },
    });
    expect(res.status).toBe(400);
  });

  test('4.3 POST /api/tasks with dueDate after 2026-12-19T23:59:59.999Z returns 400', async () => {
    const leader = getRoleSession('lider');
    const res = await apiRequest('/api/tasks', {
      method: 'POST',
      token: leader.token,
      body: {
        title: 'Late date',
        description: 'Too late',
        priority: 'LOW',
        dueDate: '2026-12-20T00:00:00.000Z',
        status: 'TODO',
        subtasks: ['S1'],
        assignedToAll: true,
      },
    });
    expect(res.status).toBe(400);
  });

  test('4.4 Exact boundary dates 2026-11-07 and 2026-12-19 succeed (201) and non-existent assignee returns 404', async () => {
    const leader = getRoleSession('lider');
    const minRes = await apiRequest<TaskDto>('/api/tasks', {
      method: 'POST',
      token: leader.token,
      body: {
        title: 'Min Boundary',
        description: 'Min valid date',
        priority: 'LOW',
        dueDate: '2026-11-07T00:00:00.000Z',
        status: 'TODO',
        subtasks: ['S1'],
        assignedToAll: true,
      },
    });
    expect(minRes.status).toBe(201);

    const maxRes = await apiRequest<TaskDto>('/api/tasks', {
      method: 'POST',
      token: leader.token,
      body: {
        title: 'Max Boundary',
        description: 'Max valid date',
        priority: 'LOW',
        dueDate: '2026-12-19T23:59:59.999Z',
        status: 'TODO',
        subtasks: ['S1'],
        assignedToAll: true,
      },
    });
    expect(maxRes.status).toBe(201);

    const missingUser = await apiRequest('/api/tasks', {
      method: 'POST',
      token: leader.token,
      body: {
        title: 'Missing Assignee',
        description: 'Nonexistent user',
        priority: 'LOW',
        dueDate: '2026-12-01T12:00:00.000Z',
        status: 'TODO',
        subtasks: ['S1'],
        assigneeId: 'user_does_not_exist_999',
      },
    });
    expect(missingUser.status).toBe(404);
  });

  test('4.5 PATCH /api/tasks/:id with empty update payload returns 400', async () => {
    const leader = getRoleSession('lider');
    const task = await createTestTask(leader.token);
    const res = await apiRequest(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      token: leader.token,
      body: {},
    });
    expect(res.status).toBe(400);
  });

  test('4.6 DONE task with past dueDate is excluded from OverdueTasksAlert (and M3 card/detail overdue)', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const doneTitle = `E2E DonePastDue ${Date.now()}`;
    await createTestTask(leader.token, {
      title: doneTitle,
      status: 'DONE',
      dueDate: '2026-11-08T12:00:00.000Z',
    });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    const alert = page.locator('section[role="alert"][aria-label="Alerta de tareas sin completar vencidas"]');
    if (await alert.isVisible()) {
      await expect(alert).not.toContainText(doneTitle);
    }

    const doneCard = page.locator(`article[aria-label^="Tarea ${doneTitle}."]`);
    await expect(doneCard).toBeVisible();
    await expect(doneCard.getByText('¡Sin completar!')).toHaveCount(0);

    if (isStrictM2M3()) {
      // M3 F6 excludes DONE from "(Vencida)" date text on TaskCard and TaskDetailModal
      await expect(doneCard.getByText(/Vencida/i)).toHaveCount(0);
    }
  });
});
