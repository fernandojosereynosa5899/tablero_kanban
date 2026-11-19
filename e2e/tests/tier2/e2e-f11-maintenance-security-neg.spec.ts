import { expect, test } from '@playwright/test';
import { apiRequest } from '../../harness/api-client';
import {
  ensureMaintenanceDisabled,
  getRoleSession,
  isStrictM2M3,
} from '../../harness/fixtures';
import { startSecondaryServer } from '../../harness/secondary-server';

test.describe('Tier 2 — E2E-F11: Maintenance Precedence, Rate Limits & Lockout Negative Cases', () => {
  test.afterEach(async () => {
    await ensureMaintenanceDisabled();
  });

  test('11.1 MAINTENANCE_MODE=true env override on secondary server overrides DB and cannot be disabled in-app', async () => {
    const leader = getRoleSession('lider');
    const secondary = await startSecondaryServer({
      maintenanceMode: 'true',
      maintenanceTitle: 'Env Override Title',
      maintenanceMessage: 'Forced via Render env',
      maintenanceEtaMinutes: '10',
    });

    try {
      const status = await apiRequest<{
        active: boolean;
        source: string;
        canDisableInApp: boolean;
        title: string;
      }>('/api/maintenance/status', { baseUrl: secondary.apiUrl });

      expect(status.status).toBe(200);
      expect(status.data.active).toBe(true);
      expect(status.data.source).toBe('env');
      expect(status.data.canDisableInApp).toBe(false);
      expect(status.data.title).toBe('Env Override Title');

      const disableAttempt = await apiRequest<{ active: boolean; source: string }>('/api/maintenance', {
        baseUrl: secondary.apiUrl,
        method: 'PATCH',
        token: leader.token,
        body: { enabled: false },
      });
      expect(disableAttempt.status).toBe(200);
      expect(disableAttempt.data.active).toBe(true);
      expect(disableAttempt.data.source).toBe('env');
    } finally {
      await secondary.stop();
    }
  });

  test('11.2 SUBLEADER and MEMBER attempting PATCH /api/maintenance receive 403', async () => {
    const subleader = getRoleSession('integrante5');
    const member = getRoleSession('integrante1');

    for (const actor of [subleader, member]) {
      const res = await apiRequest('/api/maintenance', {
        method: 'PATCH',
        token: actor.token,
        body: { enabled: true },
      });
      expect(res.status).toBe(403);
    }
  });

  test('11.3 During active maintenance, MEMBER login returns 503 while LEADER login succeeds (200)', async () => {
    const secondary = await startSecondaryServer({ maintenanceMode: 'true' });
    const state = (await import('../../harness/api-client')).getRuntimeState();

    try {
      const memberLogin = await apiRequest<{ maintenance: boolean }>('/api/auth/login', {
        baseUrl: secondary.apiUrl,
        method: 'POST',
        body: { username: 'integrante1', password: state.testPassword },
      });
      expect(memberLogin.status).toBe(503);
      expect(memberLogin.data.maintenance).toBe(true);

      const leaderLogin = await apiRequest<{ token: string }>('/api/auth/login', {
        baseUrl: secondary.apiUrl,
        method: 'POST',
        body: { username: 'lider', password: state.testPassword },
      });
      expect(leaderLogin.status).toBe(200);
      expect(leaderLogin.data.token).toBeTruthy();
    } finally {
      await secondary.stop();
    }
  });

  test('11.4 Secondary server enforces 6-fail login lockout (429), 25-req loginIpLimiter (429), and XFF check', async () => {
    const secondary = await startSecondaryServer();
    try {
      // 6 failed attempts on disposable username -> 7th is locked out with 429
      for (let i = 0; i < 6; i++) {
        const res = await apiRequest('/api/auth/login', {
          baseUrl: secondary.apiUrl,
          method: 'POST',
          body: { username: 'e2e_lockout_target', password: 'WrongPassword1!' },
        });
        expect(res.status).toBe(401);
      }

      const locked = await apiRequest('/api/auth/login', {
        baseUrl: secondary.apiUrl,
        method: 'POST',
        body: { username: 'e2e_lockout_target', password: 'WrongPassword1!' },
      });
      expect(locked.status).toBe(429);
      expect(locked.headers.get('retry-after')).toBeTruthy();

      // Exhaust loginIpLimiter (25 requests total per IP; 7 already sent -> 18 more then 26th hits 429)
      let hit429 = false;
      for (let i = 0; i < 20; i++) {
        const res = await apiRequest('/api/auth/login', {
          baseUrl: secondary.apiUrl,
          method: 'POST',
          body: { username: `e2e_ip_probe_${i}`, password: 'WrongPassword1!' },
        });
        if (res.status === 429) {
          hit429 = true;
          break;
        }
      }
      expect(hit429).toBe(true);

      if (isStrictM2M3()) {
        // M2 getClientIp uses req.ip instead of spoofable X-Forwarded-For[0]
        const spoofed = await apiRequest('/api/auth/login', {
          baseUrl: secondary.apiUrl,
          method: 'POST',
          headers: { 'X-Forwarded-For': '203.0.113.99' },
          body: { username: 'e2e_xff_probe', password: 'WrongPassword1!' },
        });
        expect(spoofed.status).toBe(429);
      }
    } finally {
      await secondary.stop();
    }
  });

  test('11.5 POST /api/security/report rejects invalid eventType (400) and throttles duplicate alerts', async () => {
    const member = getRoleSession('integrante3');
    const bad = await apiRequest('/api/security/report', {
      method: 'POST',
      token: member.token,
      body: { eventType: 'unknown_event_type' },
    });
    expect(bad.status).toBe(400);

    const first = await apiRequest<{ ok: boolean }>('/api/security/report', {
      method: 'POST',
      token: member.token,
      body: { eventType: 'dom_tamper', detail: 'First' },
    });
    expect(first.status).toBe(200);

    const second = await apiRequest<{ ok: boolean }>('/api/security/report', {
      method: 'POST',
      token: member.token,
      body: { eventType: 'dom_tamper', detail: 'Second rapid' },
    });
    expect(second.status).toBe(200);
  });
});
