import { expect, test } from '@playwright/test';
import { apiRequest, getRuntimeState } from '../../harness/api-client';
import {
  getRoleSession,
  isStrictM2M3,
  seedBrowserAuth,
} from '../../harness/fixtures';

test.describe('Tier 1 — E2E-F10: Activity Drawer, Onboarding Tutorial, Theme & A11y', () => {
  test('10.1 ActivityDrawer opens, refreshes feed, and hides security.alert from Member', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante1');

    // Record a security alert
    await apiRequest('/api/security/report', {
      method: 'POST',
      token: member.token,
      body: { eventType: 'devtools_opened', detail: 'E2E Tier1 F10 check' },
    });

    const memberAct = await apiRequest<Array<{ action: string }>>('/api/activity?limit=50', {
      token: member.token,
    });
    expect(memberAct.status).toBe(200);
    expect(memberAct.data.some((a) => a.action === 'security.alert')).toBe(false);

    const leaderAct = await apiRequest<Array<{ action: string }>>('/api/activity?limit=50', {
      token: leader.token,
    });
    expect(leaderAct.status).toBe(200);
    expect(leaderAct.data.some((a) => a.action === 'security.alert')).toBe(true);

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);
    await page.getByRole('button', { name: 'Actividad', exact: true }).click();

    const drawer = page.locator('aside[role="dialog"][aria-labelledby="activity-drawer-title"]');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: 'Actualizar historial' }).click();
    await expect(drawer).toBeVisible();
  });

  test('10.2 OnboardingTutorialModal auto-opens on first visit, navigates 4 steps, and persists dismissal', async ({ page }) => {
    const state = getRuntimeState();
    const member = getRoleSession('integrante1');
    await seedBrowserAuth(page, member, { dismissTutorial: false });
    await page.goto(state.baseUrl);

    const tutorial = page.locator('div[role="dialog"][aria-label="Tutorial guiado del Tablero Kanban"]');
    await expect(tutorial).toBeVisible();
    await expect(tutorial.getByText('Paso 1 de 4')).toBeVisible();

    await tutorial.getByRole('button', { name: 'Siguiente' }).click();
    await expect(tutorial.getByText('Paso 2 de 4')).toBeVisible();
    await tutorial.getByRole('button', { name: 'Anterior' }).click();
    await expect(tutorial.getByText('Paso 1 de 4')).toBeVisible();

    await tutorial.getByRole('button', { name: 'Siguiente' }).click();
    await tutorial.getByRole('button', { name: 'Siguiente' }).click();
    await tutorial.getByRole('button', { name: 'Siguiente' }).click();
    await expect(tutorial.getByText('Paso 4 de 4')).toBeVisible();
    await tutorial.getByRole('button', { name: '¡Comenzar a trabajar!' }).click();

    await expect(tutorial).toBeHidden();
    const persisted = await page.evaluate(
      (id) => window.localStorage.getItem(`kanban_tutorial_v1_${id}`),
      member.user.id,
    );
    expect(['1', 'true']).toContain(persisted);
  });

  test('10.3 Theme toggle updates html.dark class and persists kanban_theme in localStorage', async ({ page }) => {
    const state = getRuntimeState();
    await seedBrowserAuth(page, 'lider', { theme: 'light' });
    await page.goto(state.baseUrl);

    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.getByRole('button', { name: 'Cambiar a modo oscuro' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    const saved = await page.evaluate(() => window.localStorage.getItem('kanban_theme'));
    expect(saved).toBe('dark');

    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('10.4 Mobile viewport (375x812) displays 4-column tablist switcher and Ver todas (4) toggle', async ({ page }) => {
    const state = getRuntimeState();
    await page.setViewportSize({ width: 375, height: 812 });
    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    const tablist = page.locator('div[role="tablist"][aria-label="Cambiar columna en móvil"]');
    await expect(tablist).toBeVisible();
    await expect(tablist.locator('button[role="tab"]')).toHaveCount(4);

    await page.getByRole('button', { name: 'Ver todas (4)' }).click();
    await expect(page.getByRole('button', { name: 'Ver 1 columna' })).toBeVisible();
  });

  test('10.5 Keyboard Escape closes dialogs and accessible label bindings work', async ({ page }) => {
    const state = getRuntimeState();
    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    await page.getByRole('button', { name: 'Actividad', exact: true }).click();
    const drawer = page.locator('aside[role="dialog"][aria-labelledby="activity-drawer-title"]');
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    await page.getByRole('button', { name: 'Nueva Actividad' }).click();
    const formDialog = page.locator('div[role="dialog"][aria-labelledby="task-form-title"]');
    await expect(formDialog.getByLabel(/Título/i)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(formDialog).toBeHidden();

    if (isStrictM2M3()) {
      await page.getByRole('button', { name: 'Equipo (6/6)' }).click();
      const teamModal = page.locator('div[role="dialog"][aria-labelledby="team-modal-title"]');
      const liberaBtn = teamModal.getByRole('button', { name: 'Liberar' }).first();
      if (await liberaBtn.isVisible()) {
        await page.keyboard.press('Escape');
        await expect(teamModal).toBeHidden();
      }
    }
  });
});
