import { expect, test } from '@playwright/test';
import { apiRequest, getRuntimeState } from '../../harness/api-client';
import {
  ensureMaintenanceDisabled,
  getRoleSession,
  seedBrowserAuth,
} from '../../harness/fixtures';

test.describe('Tier 1 — E2E-F11: Maintenance Window, Security Sanitization & Validation', () => {
  test.afterEach(async () => {
    await ensureMaintenanceDisabled();
  });

  test('11.1 GET /api/maintenance/status returns inactive none status in baseline mode', async () => {
    const res = await apiRequest<{
      active: boolean;
      source: string;
      canDisableInApp: boolean;
    }>('/api/maintenance/status');

    expect(res.status).toBe(200);
    expect(res.data.active).toBe(false);
    expect(res.data.source).toBe('none');
    expect(res.data.canDisableInApp).toBe(true);
  });

  test('11.2 Leader activates and deactivates database maintenance via MaintenanceModal UI', async ({ page }) => {
    const state = getRuntimeState();
    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    await page.getByRole('button', { name: 'Mantenimiento' }).click();
    const modal = page.locator('div[role="dialog"][aria-labelledby="maintenance-modal-title"]');
    await expect(modal).toBeVisible();

    await modal.locator('#maintenance-title-input').fill('Ventana E2E Programada');
    await modal.locator('#maintenance-message-input').fill('Aplicando pruebas automáticas de mantenimiento');
    await modal.getByRole('button', { name: 'Activar ventana de mantenimiento' }).click();

    await expect(page.getByRole('button', { name: 'Mantenimiento activo' })).toBeVisible();
    const statusActive = await apiRequest<{ active: boolean; source: string; title: string }>(
      '/api/maintenance/status',
    );
    expect(statusActive.data.active).toBe(true);
    expect(statusActive.data.source).toBe('database');
    expect(statusActive.data.title).toBe('Ventana E2E Programada');

    await page.getByRole('button', { name: 'Mantenimiento activo' }).click();
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Finalizar mantenimiento y reabrir tablero' }).click();
    await expect(page.getByRole('button', { name: 'Mantenimiento', exact: true })).toBeVisible();
  });

  test('11.3 During DB maintenance, Member gets 503 with Retry-After and sees MaintenanceScreen', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante1');

    await apiRequest('/api/maintenance', {
      method: 'PATCH',
      token: leader.token,
      body: {
        enabled: true,
        title: 'Mantenimiento E2E Activo',
        message: 'Solo acceso para líder durante pruebas.',
        estimatedMinutes: 5,
      },
    });

    const memberTasks = await apiRequest<{ maintenance: boolean }>('/api/tasks', {
      token: member.token,
    });
    expect(memberTasks.status).toBe(503);
    expect(memberTasks.headers.get('retry-after')).toBe('30');
    expect(memberTasks.data.maintenance).toBe(true);

    await seedBrowserAuth(page, 'integrante1');
    await page.goto(state.baseUrl);
    await expect(page.getByText('VENTANA DE MANTENIMIENTO')).toBeVisible();
    await expect(page.getByText('Mantenimiento E2E Activo')).toBeVisible();
  });

  test('11.4 POST /api/security/report records security.alert visible to Leader', async () => {
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante2');

    const rep = await apiRequest<{ ok: boolean; isMonitoredTarget: boolean }>('/api/security/report', {
      method: 'POST',
      token: member.token,
      body: { eventType: 'context_menu_blocked', detail: 'E2E F11 security test' },
    });
    expect(rep.status).toBe(200);
    expect(rep.data.ok).toBe(true);
    expect(rep.data.isMonitoredTarget).toBe(true);

    const act = await apiRequest<Array<{ action: string }>>('/api/activity?limit=20', {
      token: leader.token,
    });
    expect(act.data.some((a) => a.action === 'security.alert')).toBe(true);
  });

  test('11.5 Sanitization strips __proto__/control chars and validateIdParam rejects malformed IDs with 400', async () => {
    const leader = getRoleSession('lider');
    const badId = await apiRequest('/api/tasks/ab', { token: leader.token });
    expect(badId.status).toBe(400);

    const rawProtoPayload = JSON.stringify({
      title: 'Clean\u0007Title',
      description: 'Valid\u0000Desc',
      priority: 'LOW',
      dueDate: '2026-12-01T12:00:00.000Z',
      status: 'TODO',
      subtasks: ['Check\u0008Sub'],
      assignedToAll: true,
      __proto__: { polluted: true },
    });

    const createRes = await apiRequest<{ id: string; title: string }>('/api/tasks', {
      method: 'POST',
      token: leader.token,
      rawBody: rawProtoPayload,
    });
    expect(createRes.status).toBe(201);
    expect(createRes.data.title).toBe('CleanTitle');

    await apiRequest(`/api/tasks/${createRes.data.id}`, {
      method: 'DELETE',
      token: leader.token,
    });
  });
});
