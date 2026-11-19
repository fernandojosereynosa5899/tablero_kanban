import { expect, test } from '@playwright/test';
import { apiRequest, getRuntimeState } from '../../harness/api-client';
import {
  cleanupExtraTasks,
  createTestTask,
  getRoleSession,
  seedBrowserAuth,
} from '../../harness/fixtures';

test.describe('Tier 2 — E2E-F10: Activity, Form Validation & A11y Negative Cases', () => {
  test.afterEach(async () => {
    await cleanupExtraTasks();
  });

  test('10.1 GET /api/activity?limit=500 clamps safely to <= 100 and handles edge limits', async () => {
    const leader = getRoleSession('lider');
    const bigLimit = await apiRequest<unknown[]>('/api/activity?limit=500', { token: leader.token });
    expect(bigLimit.status).toBe(200);
    expect(Array.isArray(bigLimit.data)).toBe(true);
    expect(bigLimit.data.length).toBeLessThanOrEqual(100);

    const zeroLimit = await apiRequest<unknown[]>('/api/activity?limit=0', { token: leader.token });
    expect([200, 400]).toContain(zeroLimit.status);
  });

  test('10.2 MEMBER never sees security.alert logs in GET /api/activity even right after alert emission', async () => {
    const member = getRoleSession('integrante1');
    const leader = getRoleSession('lider');

    await apiRequest('/api/security/report', {
      method: 'POST',
      token: member.token,
      body: { eventType: 'inspect_shortcut', detail: 'F12 blocked E2E' },
    });

    const memberAct = await apiRequest<Array<{ action: string }>>('/api/activity?limit=100', {
      token: member.token,
    });
    expect(memberAct.status).toBe(200);
    expect(memberAct.data.some((entry) => entry.action === 'security.alert')).toBe(false);

    const leaderAct = await apiRequest<Array<{ action: string }>>('/api/activity?limit=100', {
      token: leader.token,
    });
    expect(leaderAct.data.some((entry) => entry.action === 'security.alert')).toBe(true);
  });

  test('10.3 Deleting a task keeps ActivityLog history intact and ActivityDrawer renders without errors', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const title = `E2E DeletedActivity ${Date.now()}`;
    const task = await createTestTask(leader.token, { title });

    await apiRequest(`/api/tasks/${task.id}`, {
      method: 'DELETE',
      token: leader.token,
    });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);
    await page.getByRole('button', { name: 'Actividad', exact: true }).click();

    const drawer = page.locator('aside[role="dialog"][aria-labelledby="activity-drawer-title"]');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(title);
  });

  test('10.4 AvatarStudioModal password form blocks mismatched confirmPassword client-side', async ({ page }) => {
    const state = getRuntimeState();
    await seedBrowserAuth(page, 'integrante1');
    await page.goto(state.baseUrl);

    let patchCalled = false;
    await page.route(`${state.apiUrl}/api/users/me/password`, async (route) => {
      patchCalled = true;
      await route.continue();
    });

    await page.getByRole('button', { name: 'Mi Perfil & Avatar' }).click();
    const modal = page.locator('div[role="dialog"][aria-labelledby="avatar-studio-title"]');
    await modal.getByRole('button', { name: 'Cambiar Contraseña' }).click();

    await modal.locator('#studio-current-password').fill(state.testPassword);
    await modal.locator('#studio-new-password').fill('ValidPass123');
    await modal.locator('#studio-confirm-password').fill('DifferentPass123');
    await modal.getByRole('button', { name: 'Actualizar contraseña' }).click();

    await expect(modal.getByText(/no coincide/i)).toBeVisible();
    expect(patchCalled).toBe(false);
  });

  test('10.5 TaskFormModal blocks submit when required fields/subtasks are missing or date out of bounds', async ({ page }) => {
    const state = getRuntimeState();
    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    let postCalled = false;
    await page.route(`${state.apiUrl}/api/tasks`, async (route) => {
      if (route.request().method() === 'POST') postCalled = true;
      await route.continue();
    });

    await page.getByRole('button', { name: 'Nueva Actividad' }).click();
    const modal = page.locator('div[role="dialog"][aria-labelledby="task-form-title"]');

    // Attempt empty submit
    await modal.getByRole('button', { name: 'Crear Actividad' }).click();
    expect(postCalled).toBe(false);

    // Fill title/desc but invalid date outside 2026-11-07..2026-12-19 and no subtasks
    await modal.locator('#task-title-input').fill('Invalid Form Test');
    await modal.locator('#task-desc-input').fill('Description');
    await modal.locator('#task-due-input').fill('2026-10-01');
    await modal.getByRole('button', { name: 'Crear Actividad' }).click();
    expect(postCalled).toBe(false);
    await expect(modal).toBeVisible();
  });
});
