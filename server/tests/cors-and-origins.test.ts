import './setup-env';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { compileOriginWildcard, createOriginMatcher, normalizeOrigin } from '../src/config';
import { createServer } from '../src/app';
import { prisma } from '../src/prisma';
import { resetMaintenanceCacheForTests, setMaintenanceEnvOverrideForTests } from '../src/services/maintenanceService';

describe('CORS & origin matching', () => {
  it('normalizeOrigin strips trailing slashes and path while keeping wildcards', () => {
    assert.equal(normalizeOrigin('https://mi-tablero.vercel.app/'), 'https://mi-tablero.vercel.app');
    assert.equal(normalizeOrigin('https://mi-tablero.vercel.app/board?x=1'), 'https://mi-tablero.vercel.app');
    assert.equal(normalizeOrigin('https://mi-tablero-*.vercel.app/'), 'https://mi-tablero-*.vercel.app');
  });

  it('compileOriginWildcard enforces single-label wildcard and rejects overly broad patterns', () => {
    assert.equal(compileOriginWildcard('https://*.com'), null);
    const re = compileOriginWildcard('https://mi-tablero-git-*.vercel.app');
    assert.ok(re !== null);
    assert.equal(re.test('https://mi-tablero-git-feat-ui-123.vercel.app'), true);
    assert.equal(re.test('https://evil.mi-tablero-git-main.vercel.app'), false);
  });

  it('createOriginMatcher validates production Vercel, preview, Render, localhost, and rejects spoofed origins', () => {
    const isAllowed = createOriginMatcher({
      isProd: true,
      clientOrigin: 'https://mi-tablero.vercel.app/',
      allowedOrigins: 'https://mi-tablero-git-*.vercel.app/, https://custom.example.com/',
    });

    assert.equal(isAllowed('https://mi-tablero.vercel.app'), true);
    assert.equal(isAllowed('https://mi-tablero-git-feat-ui-123.vercel.app'), true);
    assert.equal(isAllowed('https://tablero-kanban.onrender.com'), true);
    assert.equal(isAllowed('https://tablero-kanban-th2h.onrender.com'), true);
    assert.equal(isAllowed('https://custom.example.com'), true);
    assert.equal(isAllowed(undefined), true);
    assert.equal(isAllowed('http://localhost:5173'), true);

    assert.equal(isAllowed('https://evil-attacker.vercel.app'), false);
    assert.equal(isAllowed('https://evil.mi-tablero-git-main.vercel.app'), false);
    assert.equal(isAllowed('http://mi-tablero.vercel.app'), false);
    assert.equal(isAllowed('https://evil.com'), false);
  });

  describe('Express CORS HTTP status & CORP headers', () => {
    let baseUrl = '';
    let closeServer: () => Promise<void>;
    let restoreFindUnique: (() => void) | null = null;

    before(async () => {
      setMaintenanceEnvOverrideForTests({ enabled: false });
      resetMaintenanceCacheForTests();
      const origFindUnique = prisma.systemConfig.findUnique;
      (prisma.systemConfig as { findUnique: unknown }).findUnique = async () => null;
      restoreFindUnique = () => {
        (prisma.systemConfig as { findUnique: unknown }).findUnique = origFindUnique;
      };

      const { httpServer, io } = createServer();
      await new Promise<void>((resolve) => {
        httpServer.listen(0, '127.0.0.1', () => resolve());
      });
      const addr = httpServer.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;

      closeServer = async () => {
        await new Promise<void>((resolve) => io.close(() => resolve()));
        if (httpServer.listening) {
          httpServer.closeIdleConnections?.();
          await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        }
      };
    });

    after(async () => {
      restoreFindUnique?.();
      setMaintenanceEnvOverrideForTests(null);
      resetMaintenanceCacheForTests();
      await closeServer?.();
    });

    it('rejects disallowed Origin with HTTP 403 (not 500) and same-origin CORP', async () => {
      const res = await fetch(`${baseUrl}/api/maintenance/status`, {
        headers: { Origin: 'https://evil-attacker.example' },
      });
      assert.equal(res.status, 403);
      const body = (await res.json()) as { error: string };
      assert.equal(body.error, 'Origen no permitido por CORS');
      assert.equal(res.headers.get('access-control-allow-origin'), null);
      assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin');
      assert.ok(res.headers.get('x-request-id'));
    });

    it('rejects disallowed preflight OPTIONS with HTTP 403', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil-attacker.example',
          'Access-Control-Request-Method': 'POST',
        },
      });
      assert.equal(res.status, 403);
    });

    it('allows localhost Origin with ACAO and cross-origin CORP', async () => {
      const res = await fetch(`${baseUrl}/api/maintenance/status`, {
        headers: { Origin: 'http://localhost:5173' },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
      assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
    });
  });
});
