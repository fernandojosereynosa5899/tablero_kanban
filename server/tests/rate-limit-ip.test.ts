import './setup-env';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express, { type Request } from 'express';
import { createRateLimiter, getClientIp } from '../src/middleware/rateLimit';

describe('getClientIp & rate limit anti-spoofing', () => {
  it('uses Express proxy-verified req.ip instead of spoofable leftmost X-Forwarded-For', () => {
    const req = {
      ip: '198.51.100.10',
      headers: { 'x-forwarded-for': '203.0.113.99, 198.51.100.10' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    assert.equal(getClientIp(req), '198.51.100.10');
  });

  it('strips IPv6-mapped IPv4 ::ffff: prefix and falls back safely', () => {
    const reqMappedIp = {
      ip: '::ffff:198.51.100.25',
      headers: {},
      socket: {},
    } as unknown as Request;
    assert.equal(getClientIp(reqMappedIp), '198.51.100.25');

    const reqSocketFallback = {
      ip: '',
      headers: { 'x-forwarded-for': '203.0.113.55' },
      socket: { remoteAddress: '::ffff:192.0.2.44' },
    } as unknown as Request;
    assert.equal(getClientIp(reqSocketFallback), '192.0.2.44');

    const reqUnknown = {
      headers: {},
      socket: {},
    } as unknown as Request;
    assert.equal(getClientIp(reqUnknown), 'unknown');
  });

  describe('Express trust proxy: 1 rate limiter integration', () => {
    let baseUrl = '';
    let server: http.Server;

    before(async () => {
      const app = express();
      app.set('trust proxy', 1);
      app.use(
        '/test-limit',
        createRateLimiter({
          keyPrefix: `unit-anti-spoof-${Date.now()}`,
          windowMs: 60_000,
          max: 2,
          message: 'Rate limit reached',
        }),
      );
      app.get('/test-limit', (req, res) => {
        res.json({ ip: getClientIp(req) });
      });

      server = http.createServer(app);
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('cannot bypass rate limit by rotating spoofed leftmost X-Forwarded-For entries', async () => {
      const r1 = await fetch(`${baseUrl}/test-limit`, {
        headers: { 'X-Forwarded-For': '10.0.0.1, 198.51.100.5' },
      });
      assert.equal(r1.status, 200);
      assert.deepEqual(await r1.json(), { ip: '198.51.100.5' });

      const r2 = await fetch(`${baseUrl}/test-limit`, {
        headers: { 'X-Forwarded-For': '10.0.0.2, 198.51.100.5' },
      });
      assert.equal(r2.status, 200);

      const r3 = await fetch(`${baseUrl}/test-limit`, {
        headers: { 'X-Forwarded-For': '10.0.0.3, 198.51.100.5' },
      });
      assert.equal(r3.status, 429);
      assert.ok(Number(r3.headers.get('retry-after')) >= 1);
    });
  });
});
