import { expect, test } from '@playwright/test';
import { apiRequest, getRuntimeState } from '../../harness/api-client';
import { getRoleSession, refreshRoleSession, seedBrowserAuth } from '../../harness/fixtures';

test.describe('Tier 1 — E2E-F2: Authentication & Session Management', () => {
  test('2.1 Browser LoginScreen authenticates leader, stores kanban_token, and loads board', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    await page.addInitScript((userId: string) => {
      window.localStorage.setItem(`kanban_tutorial_v1_${userId}`, '1');
    }, leader.user.id);

    await page.goto(state.baseUrl);
    await page.locator('#login-username').fill('lider');
    await page.locator('#login-password').fill(state.testPassword);
    await page.getByRole('button', { name: 'Entrar al tablero' }).click();

    await expect(page.getByRole('button', { name: 'Salir' })).toBeVisible();
    const storedToken = await page.evaluate(() => window.localStorage.getItem('kanban_token'));
    expect(storedToken).toBeTruthy();
    expect(storedToken?.split('.')).toHaveLength(3);
  });

  test('2.2 LoginScreen password visibility toggle switches input type between password and text', async ({ page }) => {
    const state = getRuntimeState();
    await page.goto(state.baseUrl);

    const pwdInput = page.locator('#login-password');
    await expect(pwdInput).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Mostrar contraseña' }).click();
    await expect(pwdInput).toHaveAttribute('type', 'text');

    await page.getByRole('button', { name: 'Ocultar contraseña' }).click();
    await expect(pwdInput).toHaveAttribute('type', 'password');
  });

  test('2.3 GET /api/users/me returns sanitized UserPublic without passwordHash or tokenVersion', async () => {
    const member = getRoleSession('integrante1');
    const res = await apiRequest<Record<string, unknown>>('/api/users/me', { token: member.token });

    expect(res.status).toBe(200);
    expect(res.data.username).toBe('integrante1');
    expect(res.data.role).toBe('MEMBER');
    expect(res.data.slot).toBe(2);
    expect(res.data).not.toHaveProperty('passwordHash');
    expect(res.data).not.toHaveProperty('tokenVersion');
  });

  test('2.4 PATCH /api/users/me/password returns new JWT and invalidates prior JWT via tokenVersion', async () => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante3');
    const oldToken = member.token;
    const tempPassword = `${state.testPassword}_New9`;

    try {
      const changeRes = await apiRequest<{ ok: boolean; token: string }>('/api/users/me/password', {
        method: 'PATCH',
        token: oldToken,
        body: {
          currentPassword: state.testPassword,
          newPassword: tempPassword,
        },
      });
      expect(changeRes.status).toBe(200);
      expect(changeRes.data.ok).toBe(true);
      expect(changeRes.data.token).toBeTruthy();
      expect(changeRes.data.token).not.toBe(oldToken);

      const oldMe = await apiRequest('/api/users/me', { token: oldToken });
      expect(oldMe.status).toBe(401);

      const newMe = await apiRequest('/api/users/me', { token: changeRes.data.token });
      expect(newMe.status).toBe(200);
    } finally {
      await apiRequest(`/api/users/${member.user.id}`, {
        method: 'PATCH',
        token: leader.token,
        body: { password: state.testPassword },
      });
      await refreshRoleSession('integrante3', state.testPassword);
    }
  });

  test('2.5 Clicking Salir clears kanban_token and returns user to LoginScreen', async ({ page }) => {
    const state = getRuntimeState();
    await seedBrowserAuth(page, 'integrante1');
    await page.goto(state.baseUrl);

    await expect(page.getByRole('heading', { name: 'Tablero Kanban' })).toBeVisible();
    await page.getByRole('button', { name: 'Salir' }).click();

    await expect(page.locator('#login-username')).toBeVisible();
    const token = await page.evaluate(() => window.localStorage.getItem('kanban_token'));
    expect(token).toBeNull();
  });
});
