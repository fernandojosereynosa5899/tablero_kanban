import { expect, test } from '@playwright/test';
import { apiRequest, getRuntimeState } from '../../harness/api-client';
import { getRoleSession, isStrictM2M3, refreshRoleSession } from '../../harness/fixtures';
import { startSecondaryServer } from '../../harness/secondary-server';

test.describe('Tier 2 — E2E-F2: Authentication & Session Negative / Boundary Cases', () => {
  test('2.1 Invalid username or wrong password returns 401 and renders UI alert', async ({ page }) => {
    const state = getRuntimeState();
    const secondary = await startSecondaryServer();
    try {
      const badUser = await apiRequest<{ error: string }>('/api/auth/login', {
        baseUrl: secondary.apiUrl,
        method: 'POST',
        body: { username: 'no_existe_e2e', password: 'WrongPassword1!' },
      });
      expect(badUser.status).toBe(401);
      expect(badUser.data.error).toBe('Credenciales inválidas');

      const badPass = await apiRequest<{ error: string }>('/api/auth/login', {
        baseUrl: secondary.apiUrl,
        method: 'POST',
        body: { username: 'lider', password: 'WrongPassword1!' },
      });
      expect(badPass.status).toBe(401);
    } finally {
      await secondary.stop();
    }

    await page.goto(state.baseUrl);
    await page.locator('#login-username').fill('no_existe_e2e_ui');
    await page.locator('#login-password').fill('WrongPass123!');
    await page.getByRole('button', { name: 'Entrar al tablero' }).click();
    await expect(page.getByRole('alert')).toContainText('Credenciales inválidas');
  });

  test('2.2 Missing, tampered, or oversized (>2048 chars) JWT is rejected with 401', async () => {
    const noAuth = await apiRequest('/api/users/me');
    expect(noAuth.status).toBe(401);

    const tampered = await apiRequest('/api/users/me', {
      token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.invalidSignature',
    });
    expect(tampered.status).toBe(401);

    const oversized = await apiRequest('/api/users/me', {
      token: 'a'.repeat(2050),
    });
    expect(oversized.status).toBe(401);
  });

  test('2.3 Admin password reset increments tokenVersion and immediately invalidates old JWT (401)', async () => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const target = getRoleSession('integrante3');
    const oldToken = target.token;

    try {
      const resetRes = await apiRequest(`/api/users/${target.user.id}`, {
        method: 'PATCH',
        token: leader.token,
        body: { password: `${state.testPassword}_Reset2` },
      });
      expect(resetRes.status).toBe(200);

      const oldAttempt = await apiRequest('/api/tasks', { token: oldToken });
      expect(oldAttempt.status).toBe(401);
    } finally {
      await apiRequest(`/api/users/${target.user.id}`, {
        method: 'PATCH',
        token: leader.token,
        body: { password: state.testPassword },
      });
      await refreshRoleSession('integrante3', state.testPassword);
    }
  });

  test('2.4 Deleted user JWT is rejected with 401 on subsequent API calls', async () => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const origMember4 = getRoleSession('integrante4');
    const tasksRes = await apiRequest<Array<{ id: string; assigneeId: string | null }>>('/api/tasks', {
      token: leader.token,
    });
    const member4TaskIds = tasksRes.data
      .filter((t) => t.assigneeId === origMember4.user.id)
      .map((t) => t.id);

    const victimToken = origMember4.token;

    try {
      const delRes = await apiRequest(`/api/users/${origMember4.user.id}`, {
        method: 'DELETE',
        token: leader.token,
      });
      expect(delRes.status).toBe(200);

      const afterDelete = await apiRequest('/api/users/me', { token: victimToken });
      expect(afterDelete.status).toBe(401);
    } finally {
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

  test('2.5 Transient 502/503 cold-start during bootstrap handles kanban_token safely', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');

    await page.addInitScript((token: string) => {
      window.localStorage.setItem('kanban_token', token);
    }, leader.token);

    if (isStrictM2M3()) {
      await page.route(`${state.apiUrl}/api/users/me`, async (route) => {
        await route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Bad Gateway cold start' }),
        });
      });
      await page.goto(state.baseUrl);
      await expect(page.getByRole('button', { name: /Reintentar/i })).toBeVisible();
      const kept = await page.evaluate(() => window.localStorage.getItem('kanban_token'));
      expect(kept).toBe(leader.token);
    } else {
      // Current AuthContext preserves kanban_token on 503 maintenance payload
      await page.route(`${state.apiUrl}/api/users/me`, async (route) => {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Cold start maintenance',
            maintenance: true,
            status: {
              active: true,
              source: 'env',
              title: 'Iniciando servidor',
              message: 'Esperando arranque',
              estimatedMinutes: 1,
              updatedAt: new Date().toISOString(),
              canDisableInApp: false,
            },
          }),
        });
      });
      await page.goto(state.baseUrl);
      await expect(page.getByText('VENTANA DE MANTENIMIENTO')).toBeVisible();
      const kept = await page.evaluate(() => window.localStorage.getItem('kanban_token'));
      expect(kept).toBe(leader.token);
    }
  });
});
