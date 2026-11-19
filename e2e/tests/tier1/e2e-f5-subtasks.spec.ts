import { expect, test } from '@playwright/test';
import { apiRequest, getRuntimeState } from '../../harness/api-client';
import {
  cleanupExtraTasks,
  createTestTask,
  getRoleSession,
  seedBrowserAuth,
  TaskDto,
} from '../../harness/fixtures';

test.describe('Tier 1 — E2E-F5: Subtasks Creation, Deletion & Role-Scoped Toggles', () => {
  test.afterEach(async () => {
    await cleanupExtraTasks();
  });

  test('5.1 Leader adds a new subtask inside TaskDetailModal UI', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const title = `E2E AddSubtask ${Date.now()}`;
    const task = await createTestTask(leader.token, { title, subtasks: ['Initial step'] });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    await page.locator(`article[aria-label^="Tarea ${title}."]`).click();
    const dialog = page.locator('div[role="dialog"][aria-labelledby="task-detail-title"]');
    await dialog.getByLabel('Nueva subtarea').fill('Added UI subtask');
    await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();

    await expect(dialog.getByText('Added UI subtask')).toBeVisible();
    const fetched = await apiRequest<TaskDto>(`/api/tasks/${task.id}`, { token: leader.token });
    expect(fetched.data.subtasks).toHaveLength(2);
  });

  test('5.2 Leader deletes a subtask in TaskDetailModal UI', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const title = `E2E DelSubtask ${Date.now()}`;
    const task = await createTestTask(leader.token, { title, subtasks: ['Keep me', 'Remove me'] });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    await page.locator(`article[aria-label^="Tarea ${title}."]`).click();
    const dialog = page.locator('div[role="dialog"][aria-labelledby="task-detail-title"]');
    await dialog.getByRole('button', { name: 'Eliminar subtarea Remove me' }).click();

    await expect(dialog.getByText('Remove me')).toHaveCount(0);
    await expect(dialog.getByText('Keep me')).toBeVisible();

    const fetched = await apiRequest<TaskDto>(`/api/tasks/${task.id}`, { token: leader.token });
    expect(fetched.data.subtasks).toHaveLength(1);
    expect(fetched.data.subtasks[0].title).toBe('Keep me');
  });

  test('5.3 Leader toggles subtask done via API and updates completion', async () => {
    const leader = getRoleSession('lider');
    const task = await createTestTask(leader.token, { subtasks: ['Step 1', 'Step 2'] });
    const subId = task.subtasks[0].id;

    const patchRes = await apiRequest<TaskDto>(`/api/subtasks/${subId}`, {
      method: 'PATCH',
      token: leader.token,
      body: { done: true },
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.data.subtasks.find((s) => s.id === subId)?.done).toBe(true);
  });

  test('5.4 Member toggles subtask on own assigned non-APPROVED task in UI', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante1');
    const title = `E2E MemberSubtask ${Date.now()}`;
    const task = await createTestTask(leader.token, {
      title,
      assigneeId: member.user.id,
      subtasks: ['Check item'],
    });

    await seedBrowserAuth(page, 'integrante1');
    await page.goto(state.baseUrl);

    await page.locator(`article[aria-label^="Tarea ${title}."]`).click();
    const dialog = page.locator('div[role="dialog"][aria-labelledby="task-detail-title"]');
    await dialog.getByText('Check item').click();

    await expect(async () => {
      const fetched = await apiRequest<TaskDto>(`/api/tasks/${task.id}`, { token: member.token });
      expect(fetched.data.subtasks[0].done).toBe(true);
    }).toPass({ timeout: 5000 });
  });

  test('5.5 Both Member and Subleader can toggle subtasks on an assignedToAll non-APPROVED task', async () => {
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante2');
    const subleader = getRoleSession('integrante5');
    const task = await createTestTask(leader.token, {
      assignedToAll: true,
      subtasks: ['Shared step'],
    });
    const subId = task.subtasks[0].id;

    const mRes = await apiRequest<TaskDto>(`/api/subtasks/${subId}`, {
      method: 'PATCH',
      token: member.token,
      body: { done: true },
    });
    expect(mRes.status).toBe(200);
    expect(mRes.data.subtasks.find((s) => s.id === subId)?.done).toBe(true);

    const sRes = await apiRequest<TaskDto>(`/api/subtasks/${subId}`, {
      method: 'PATCH',
      token: subleader.token,
      body: { done: false },
    });
    expect(sRes.status).toBe(200);
    expect(sRes.data.subtasks.find((s) => s.id === subId)?.done).toBe(false);
  });
});
