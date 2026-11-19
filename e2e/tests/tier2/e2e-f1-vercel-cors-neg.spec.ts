import { expect, test } from '@playwright/test';
import { apiRequest, getRuntimeState } from '../../harness/api-client';
import { getRoleSession, isStrictM2M3, seedBrowserAuth } from '../../harness/fixtures';
import { startSecondaryServer } from '../../harness/secondary-server';

test.describe('Tier 2 — E2E-F1: Vercel Config, HTML-200 & CORS Negative Cases', () => {
  test('1.1 Disallowed Origin is rejected by CORS without Access-Control-Allow-Origin', async () => {
    const state = getRuntimeState();
    const res = await fetch(`${state.apiUrl}/api/health`, {
      headers: { Origin: 'https://evil-attacker.example.com' },
    });

    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    if (isStrictM2M3()) {
      expect(res.status).toBe(403);
    } else {
      expect([403, 500]).toContain(res.status);
    }
  });

  test('1.2 ALLOWED_ORIGINS rejects invalid single-label wildcard (*.com) while allowing valid subdomain wildcard', async () => {
    const secondary = await startSecondaryServer({
      allowedOrigins: 'https://*.com,https://*.vercel.app',
    });
    try {
      const badWildcard = await fetch(`${secondary.apiUrl}/api/health`, {
        headers: { Origin: 'https://attacker.com' },
      });
      expect(badWildcard.headers.get('access-control-allow-origin')).toBeNull();

      const goodWildcard = await fetch(`${secondary.apiUrl}/api/health`, {
        headers: { Origin: 'https://tablero-kanban-preview.vercel.app' },
      });
      expect(goodWildcard.status).toBe(200);
      expect(goodWildcard.headers.get('access-control-allow-origin')).toBe(
        'https://tablero-kanban-preview.vercel.app',
      );
    } finally {
      await secondary.stop();
    }
  });

  test('1.3 Simulated Vercel HTML-200 rewrite on /api/* does not crash page uncontrollably', async ({ page }) => {
    const state = getRuntimeState();
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.route(`${state.apiUrl}/api/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html><body>SPA Fallback HTML</body></html>',
      });
    });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);

    if (isStrictM2M3()) {
      // M3 api.ts detects text/html 200 and surfaces a clear configuration/server error
      await expect(page.getByText(/VITE_API_URL|HTML|servidor|configuración|Reintentar/i).first()).toBeVisible();
      expect(pageErrors).toHaveLength(0);
    } else {
      // Verify page remains mounted (either ErrorBoundary or LoginScreen) without blank crash
      await expect(page.locator('#root')).not.toBeEmpty();
    }
  });

  test('1.4 JSON payload exceeding 100kb limit is rejected with 413', async () => {
    const leader = getRoleSession('lider');
    const oversized = JSON.stringify({
      title: 'Too Big',
      description: 'X'.repeat(120 * 1024),
      priority: 'LOW',
      dueDate: '2026-12-01T12:00:00.000Z',
      status: 'TODO',
      subtasks: ['One'],
      assignedToAll: true,
    });

    const res = await apiRequest('/api/tasks', {
      method: 'POST',
      token: leader.token,
      rawBody: oversized,
    });
    expect(res.status).toBe(413);
  });

  test('1.5 Unknown /api/* route returns 404 JSON error rather than 200 HTML', async () => {
    const leader = getRoleSession('lider');
    const res = await apiRequest<{ error: string }>('/api/does-not-exist-e2e', {
      token: leader.token,
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.data.error).toBeTruthy();
  });
});
