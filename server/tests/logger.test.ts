import './setup-env';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import express from 'express';
import { errorHandler } from '../src/middleware/errorHandler';
import { HttpError } from '../src/utils/errors';
import {
  createRequestLoggerMiddleware,
  redactSensitiveText,
  sanitizeLogMeta,
  setLoggerSinkForTests,
} from '../src/utils/logger';

describe('Structured logger & secret redaction', () => {
  afterEach(() => {
    setLoggerSinkForTests(null);
  });

  it('redacts Bearer tokens, JWTs, query params, and sensitive keys', () => {
    const raw =
      'Auth failed for Bearer secret_token_123 and ?access_token=abc&password=xyz eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig1234';
    const redacted = redactSensitiveText(raw);
    assert.equal(redacted.includes('secret_token_123'), false);
    assert.equal(redacted.includes('abc'), false);
    assert.equal(redacted.includes('xyz'), false);
    assert.equal(redacted.includes('eyJhbGciOiJIUzI1NiJ9'), false);

    const meta = sanitizeLogMeta({
      authorization: 'Bearer top-secret',
      cookie: 'session=secret',
      password: 'my-password',
      body: { secret: '123' },
      safeField: 'ok',
    });
    assert.equal(meta.authorization, '[REDACTED]');
    assert.equal(meta.cookie, '[REDACTED]');
    assert.equal(meta.password, '[REDACTED]');
    assert.equal(meta.body, '[REDACTED]');
    assert.equal(meta.safeField, 'ok');
  });

  it('logs HTTP requests without query strings, auth headers, cookies, or body secrets, and skips 200 /api/health in prod', async () => {
    const logs: Array<{ level: string; line: string; entry: Record<string, unknown> }> = [];
    setLoggerSinkForTests((level, line, entry) => {
      logs.push({ level, line, entry });
    });

    const app = express();
    app.use(express.json());
    app.use(createRequestLoggerMiddleware({ isProd: true }));
    app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
    app.post('/api/auth/login', (_req, res) => res.status(200).json({ ok: true }));
    app.get('/api/boom', () => {
      throw new Error('Failed with Bearer leak_token_999');
    });
    app.get('/api/cors-fail', () => {
      throw new HttpError(403, 'Origen no permitido por CORS');
    });
    app.use(errorHandler);

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // 1. /api/health 200 in prod -> skipped
      const healthRes = await fetch(`${baseUrl}/api/health`);
      assert.equal(healthRes.status, 200);
      assert.equal(logs.length, 0);

      // 2. POST with Authorization, Cookie, query string, and password body -> zero leaks
      const loginRes = await fetch(`${baseUrl}/api/auth/login?token=query_secret_value`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer super_secret_jwt_value',
          Cookie: 'sid=super_secret_cookie',
        },
        body: JSON.stringify({ username: 'lider', password: 'SuperSecretPassword123!' }),
      });
      assert.equal(loginRes.status, 200);
      assert.ok(loginRes.headers.get('x-request-id'));

      const loginLog = logs.find((l) => l.entry.event === 'http.request' && l.entry.path === '/api/auth/login');
      assert.ok(loginLog);
      assert.equal(loginLog.entry.method, 'POST');
      assert.equal(loginLog.entry.statusCode, 200);
      assert.equal(typeof loginLog.entry.durationMs, 'number');
      assert.equal(loginLog.line.includes('query_secret_value'), false);
      assert.equal(loginLog.line.includes('super_secret_jwt_value'), false);
      assert.equal(loginLog.line.includes('super_secret_cookie'), false);
      assert.equal(loginLog.line.includes('SuperSecretPassword123!'), false);

      // 3. Unhandled error redacts message
      const boomRes = await fetch(`${baseUrl}/api/boom`, {
        headers: { Authorization: 'Bearer another_secret_token' },
      });
      assert.equal(boomRes.status, 500);
      const errLog = logs.find((l) => l.entry.event === 'http.unhandled_error');
      assert.ok(errLog);
      assert.equal(errLog.line.includes('leak_token_999'), false);
      assert.equal(errLog.line.includes('another_secret_token'), false);

      // 4. CORS 403 logs warn without headers
      const corsRes = await fetch(`${baseUrl}/api/cors-fail`, {
        headers: { Cookie: 'secret_cookie_cors' },
      });
      assert.equal(corsRes.status, 403);
      const corsLog = logs.find((l) => l.entry.event === 'http.cors_rejected');
      assert.ok(corsLog);
      assert.equal(corsLog.level, 'warn');
      assert.equal(corsLog.line.includes('secret_cookie_cors'), false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
