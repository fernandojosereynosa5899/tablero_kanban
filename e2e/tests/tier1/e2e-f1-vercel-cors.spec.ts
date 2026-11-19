import { expect, test } from '@playwright/test';
import { apiRequest, getRuntimeState } from '../../harness/api-client';
import { getRoleSession, seedBrowserAuth } from '../../harness/fixtures';

test.describe('Tier 1 — E2E-F1: Vercel VITE_API_URL, SPA Routing & CORS', () => {
  test('1.1 Browser loads Vite SPA and communicates cross-origin with backend /api/health', async ({ page }) => {
    const state = getRuntimeState();
    await seedBrowserAuth(page, 'lider');

    const healthPromise = page.waitForResponse(
      (res) => res.url().startsWith(state.apiUrl) && res.url().includes('/api/tasks') && res.status() === 200,
    );
    await page.goto(state.baseUrl);
    await healthPromise;

    await expect(page.getByRole('heading', { name: 'Tablero Kanban' })).toBeVisible();

    const health = await apiRequest<{ status: string; db: boolean; maintenance: boolean }>('/api/health', {
      headers: { Origin: state.baseUrl },
    });
    expect(health.status).toBe(200);
    expect(health.data.status).toBe('ok');
    expect(health.data.db).toBe(true);
    expect(health.data.maintenance).toBe(false);
  });

  test('1.2 Direct navigation to deep SPA path returns 200 HTML shell and renders app', async ({ page }) => {
    const state = getRuntimeState();
    const response = await page.goto(`${state.baseUrl}/tablero/deep-link-check`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Tablero Kanban/);
    await expect(page.locator('#login-username')).toBeVisible();
  });

  test('1.3 Backend responses include Helmet and custom security headers', async () => {
    const state = getRuntimeState();
    const res = await apiRequest('/api/health', {
      headers: { Origin: state.baseUrl },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-permitted-cross-domain-policies')).toBe('none');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  test('1.4 CORS preflight OPTIONS from CLIENT_ORIGIN returns allowed origin header', async () => {
    const state = getRuntimeState();
    const res = await fetch(`${state.apiUrl}/api/tasks`, {
      method: 'OPTIONS',
      headers: {
        Origin: state.baseUrl,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization,Content-Type',
      },
    });
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get('access-control-allow-origin')).toBe(state.baseUrl);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  test('1.5 Runtime storage endpoint confirms isolated DB fallback (no production Google Drive leak)', async () => {
    const leader = getRoleSession('lider');
    const res = await apiRequest<{
      storageMode: string;
      driveAttachments: number;
      quotaBytes: number;
      driveQuotaBytes: number | null;
    }>('/api/attachments/storage', { token: leader.token });

    expect(res.status).toBe(200);
    expect(res.data.storageMode).toBe('db');
    expect(res.data.driveAttachments).toBe(0);
    expect(res.data.driveQuotaBytes).toBeNull();
    expect(res.data.quotaBytes).toBeGreaterThan(0);
  });
});
