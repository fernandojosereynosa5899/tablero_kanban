import { expect, test } from '@playwright/test';
import { apiRequest, getRuntimeState } from '../../harness/api-client';
import {
  cleanupExtraTasks,
  createTestTask,
  getRoleSession,
  seedBrowserAuth,
  TaskDto,
} from '../../harness/fixtures';

test.describe('Tier 1 — E2E-F3: Kanban Board, Drag/Quick Move & Solo lectura RBAC', () => {
  test.afterEach(async () => {
    await cleanupExtraTasks();
  });

  test('3.1 Board renders all four Kanban columns and approved progress counter', async ({ page }) => {
    const state = getRuntimeState();
    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    await expect(page.locator('section[aria-label="Tablero Kanban de cuatro columnas"]')).toBeVisible();
    for (const label of ['POR HACER', 'EN PROCESO', 'HECHO', 'APROBADO']) {
      await expect(page.locator(`div[aria-label="Columna ${label}"]`)).toBeVisible();
    }
    await expect(page.getByText('Progreso aprobado')).toBeVisible();
  });

  test('3.2 Leader moves a task via Quick Move menu in UI and backend persists new status', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const title = `E2E QuickMove ${Date.now()}`;
    const task = await createTestTask(leader.token, { title, status: 'TODO' });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    const card = page.locator(`article[aria-label^="Tarea ${title}."]`);
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Mover tarea a otra columna' }).click();
    await card.getByRole('menuitem', { name: 'En Proceso' }).click();

    const inProgressCol = page.locator('div[aria-label="Columna EN PROCESO"]');
    await expect(inProgressCol.locator(`article[aria-label^="Tarea ${title}."]`)).toBeVisible();

    const fetched = await apiRequest<TaskDto>(`/api/tasks/${task.id}`, { token: leader.token });
    expect(fetched.status).toBe(200);
    expect(fetched.data.status).toBe('IN_PROGRESS');
  });

  test('3.3 Leader drags a task card to another column using pointer events', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const title = `E2E DragTask ${Date.now()}`;
    const task = await createTestTask(leader.token, { title, status: 'TODO' });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    const card = page.locator(`article[aria-label^="Tarea ${title}."]`);
    const targetCol = page.locator('div[aria-label="Columna EN PROCESO"]');
    await expect(card).toBeVisible();
    await expect(targetCol).toBeVisible();

    const cardBox = await card.boundingBox();
    const targetBox = await targetCol.boundingBox();
    if (!cardBox || !targetBox) throw new Error('Bounding box unavailable for drag test');

    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 24);
    await page.mouse.down();
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 20, cardBox.y + 24, { steps: 5 });
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 120, { steps: 15 });
    await page.mouse.up();

    await expect(targetCol.locator(`article[aria-label^="Tarea ${title}."]`)).toBeVisible();
    const fetched = await apiRequest<TaskDto>(`/api/tasks/${task.id}`, { token: leader.token });
    expect(fetched.data.status).toBe('IN_PROGRESS');
  });

  test('3.4 Leader approves a DONE task via TaskDetailModal, setting approvedAt and showing celebration', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const title = `E2E ApproveTask ${Date.now()}`;
    const task = await createTestTask(leader.token, { title, status: 'DONE' });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    await page.locator(`article[aria-label^="Tarea ${title}."]`).click();
    const dialog = page.locator('div[role="dialog"][aria-labelledby="task-detail-title"]');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Aprobar tarea' }).click();
    await expect(page.getByText('¡Tarea Aprobada!')).toBeVisible();

    const fetched = await apiRequest<TaskDto>(`/api/tasks/${task.id}`, { token: leader.token });
    expect(fetched.data.status).toBe('APPROVED');
    expect(fetched.data.approvedAt).toBeTruthy();
  });

  test('3.5 Member sees Solo lectura badge on unassigned-to-self cards and Aprobada badge on APPROVED cards', async ({ page }) => {
    const state = getRuntimeState();
    await seedBrowserAuth(page, 'integrante1');
    await page.goto(state.baseUrl);

    // Seeded task assigned to integrante2 (IN_PROGRESS) -> Solo lectura for integrante1
    const otherCard = page.locator('article[aria-label^="Tarea Implementar autenticación con JWT."]');
    await expect(otherCard).toBeVisible();
    await expect(otherCard.getByText('Solo lectura')).toBeVisible();
    await expect(otherCard.getByRole('button', { name: 'Mover tarea a otra columna' })).toHaveCount(0);

    // Seeded APPROVED task assigned to integrante1 -> Aprobada lock badge, no move button
    const approvedCard = page.locator('article[aria-label^="Tarea Redactar documento de alcance del proyecto."]');
    await expect(approvedCard).toBeVisible();
    await expect(approvedCard.getByText('Aprobada')).toBeVisible();
    await expect(approvedCard.getByRole('button', { name: 'Mover tarea a otra columna' })).toHaveCount(0);
  });

  test('3.6 Subleader moves own assigned task and Leader can revert an APPROVED task back to DONE', async () => {
    const leader = getRoleSession('lider');
    const subleader = getRoleSession('integrante5');
    const task = await createTestTask(subleader.token, {
      title: `E2E SubleaderOwn ${Date.now()}`,
      status: 'TODO',
      assigneeId: subleader.user.id,
    });

    const moveRes = await apiRequest<TaskDto>(`/api/tasks/${task.id}/move`, {
      method: 'PATCH',
      token: subleader.token,
      body: { status: 'DONE' },
    });
    expect(moveRes.status).toBe(200);
    expect(moveRes.data.status).toBe('DONE');

    const approveRes = await apiRequest<TaskDto>(`/api/tasks/${task.id}/move`, {
      method: 'PATCH',
      token: leader.token,
      body: { status: 'APPROVED' },
    });
    expect(approveRes.status).toBe(200);
    expect(approveRes.data.approvedAt).toBeTruthy();

    const revertRes = await apiRequest<TaskDto>(`/api/tasks/${task.id}/move`, {
      method: 'PATCH',
      token: leader.token,
      body: { status: 'DONE' },
    });
    expect(revertRes.status).toBe(200);
    expect(revertRes.data.status).toBe('DONE');
    expect(revertRes.data.approvedAt).toBeNull();
  });
});
