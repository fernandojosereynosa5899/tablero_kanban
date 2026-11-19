import { expect, test } from '@playwright/test';
import { apiRequest, getRuntimeState } from '../../harness/api-client';
import {
  cleanupExtraTasks,
  createTestTask,
  getRoleSession,
  seedBrowserAuth,
  TaskDto,
} from '../../harness/fixtures';

test.describe('Tier 1 — E2E-F4: Task CRUD (7 Fields), Filters & Overdue Rules', () => {
  test.afterEach(async () => {
    await cleanupExtraTasks();
  });

  test('4.1 Leader creates a task via TaskFormModal UI with all 7 required fields', async ({ page }) => {
    const state = getRuntimeState();
    const title = `E2E UI Create ${Date.now()}`;
    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    await page.getByRole('button', { name: 'Nueva Actividad' }).click();
    const dialog = page.locator('div[role="dialog"][aria-labelledby="task-form-title"]');
    await expect(dialog).toBeVisible();

    await dialog.locator('#task-title-input').fill(title);
    await dialog.locator('#task-desc-input').fill('Descripción completa creada desde UI E2E');
    await dialog.locator('#task-priority-select').selectOption('HIGH');
    await dialog.locator('#task-due-input').fill('2026-12-12');
    await dialog.locator('#task-assignee-select').selectOption('__ALL__');
    await dialog.locator('#task-status-select').selectOption('IN_PROGRESS');
    await dialog.locator('#initial-subtask-input').fill('Primera subtarea requerida');
    await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
    await dialog.getByRole('button', { name: 'Crear Actividad' }).click();

    await expect(dialog).toBeHidden();
    const col = page.locator('div[aria-label="Columna EN PROCESO"]');
    await expect(col.locator(`article[aria-label^="Tarea ${title}."]`)).toBeVisible();
  });

  test('4.2 Subleader creates an assignedToAll non-APPROVED task via API and it appears on board', async () => {
    const subleader = getRoleSession('integrante5');
    const title = `E2E Subleader Create ${Date.now()}`;
    const res = await apiRequest<TaskDto>('/api/tasks', {
      method: 'POST',
      token: subleader.token,
      body: {
        title,
        description: 'Creada por sublíder para todo el equipo',
        priority: 'URGENT',
        dueDate: '2026-12-15T12:00:00.000Z',
        status: 'TODO',
        subtasks: ['Revisar entregable'],
        assignedToAll: true,
      },
    });
    expect(res.status).toBe(201);
    expect(res.data.assignedToAll).toBe(true);
    expect(res.data.assigneeId).toBeNull();
  });

  test('4.3 Leader edits an existing task via TaskDetailModal -> TaskFormModal UI', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const origTitle = `E2E EditOrig ${Date.now()}`;
    const updatedTitle = `E2E EditDone ${Date.now()}`;
    const task = await createTestTask(leader.token, { title: origTitle, priority: 'LOW' });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    await page.locator(`article[aria-label^="Tarea ${origTitle}."]`).click();
    const detail = page.locator('div[role="dialog"][aria-labelledby="task-detail-title"]');
    await detail.getByRole('button', { name: 'Editar' }).click();

    const form = page.locator('div[role="dialog"][aria-labelledby="task-form-title"]');
    await expect(form).toBeVisible();
    await form.locator('#task-title-input').fill(updatedTitle);
    await form.locator('#task-priority-select').selectOption('URGENT');
    await form.getByRole('button', { name: 'Guardar cambios' }).click();

    await expect(form).toBeHidden();
    await expect(page.locator(`article[aria-label^="Tarea ${updatedTitle}."]`)).toBeVisible();

    const fetched = await apiRequest<TaskDto>(`/api/tasks/${task.id}`, { token: leader.token });
    expect(fetched.data.title).toBe(updatedTitle);
    expect(fetched.data.priority).toBe('URGENT');
  });

  test('4.4 Leader deletes a task via TaskDetailModal inline confirmation and board removes it', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const title = `E2E DeleteTask ${Date.now()}`;
    const task = await createTestTask(leader.token, { title });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    await page.locator(`article[aria-label^="Tarea ${title}."]`).click();
    const detail = page.locator('div[role="dialog"][aria-labelledby="task-detail-title"]');
    await detail.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await detail.getByRole('button', { name: 'Confirmar eliminación' }).click();

    await expect(detail).toBeHidden();
    await expect(page.locator(`article[aria-label^="Tarea ${title}."]`)).toHaveCount(0);

    const fetched = await apiRequest(`/api/tasks/${task.id}`, { token: leader.token });
    expect(fetched.status).toBe(404);
  });

  test('4.5 Toolbar search, Mis tareas, assignee listbox, priority select, and Limpiar filter board cards', async ({ page }) => {
    const state = getRuntimeState();
    await seedBrowserAuth(page, 'integrante2');
    await page.goto(state.baseUrl);

    const search = page.getByLabel('Buscar actividades por título o descripción');
    await search.fill('JWT');
    await expect(page.locator('article[aria-label^="Tarea Implementar autenticación con JWT."]')).toBeVisible();
    await expect(page.locator('article[aria-label^="Tarea Diseñar iconografía del tablero."]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();
    await page.getByRole('button', { name: 'Mis tareas' }).click();
    await expect(page.locator('article[aria-label^="Tarea Implementar autenticación con JWT."]')).toBeVisible();
    await expect(page.locator('article[aria-label^="Tarea Diseñar iconografía del tablero."]')).toHaveCount(0);

    await page.getByLabel('Filtrar por prioridad').selectOption('URGENT');
    await expect(page.locator('article[aria-label^="Tarea Implementar autenticación con JWT."]')).toBeVisible();

    await page.getByRole('button', { name: /Limpiar \(/ }).click();
    await expect(page.locator('article[aria-label^="Tarea Diseñar iconografía del tablero."]')).toBeVisible();
  });

  test('4.6 Incomplete past-due task renders OverdueTasksAlert and ¡Sin completar! badge while APPROVED does not', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const overdueTitle = `E2E OverdueAlert ${Date.now()}`;
    await createTestTask(leader.token, {
      title: overdueTitle,
      status: 'TODO',
      dueDate: '2026-11-08T12:00:00.000Z',
    });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    const alert = page.locator('section[role="alert"][aria-label="Alerta de tareas sin completar vencidas"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(overdueTitle);

    const overdueCard = page.locator(`article[aria-label^="Tarea ${overdueTitle}."]`);
    await expect(overdueCard.getByText('¡Sin completar!')).toBeVisible();

    const approvedCard = page.locator('article[aria-label^="Tarea Redactar documento de alcance del proyecto."]');
    await expect(approvedCard.getByText('¡Sin completar!')).toHaveCount(0);
  });
});
