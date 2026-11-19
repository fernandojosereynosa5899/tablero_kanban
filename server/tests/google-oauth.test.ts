import './setup-env';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  assertGoogleOAuthScopes,
  fetchWithGoogleAuth,
  getGoogleAccessToken,
  getGoogleGrantedScopes,
  getMissingGoogleOAuthEnvVars,
  GOOGLE_OAUTH_SCOPES,
  isGoogleOAuthConfigured,
  resetGoogleAuthStateForTests,
  setGoogleOAuthConfigForTests,
  verifyGoogleOAuthScopes,
} from '../src/services/googleAuthService';
import { verifyDriveAboutAccess } from '../src/services/googleDriveService';
import { verifyMailConnection } from '../src/services/mailService';
import { HttpError } from '../src/utils/errors';

const originalFetch = globalThis.fetch;
const originalMailDisabled = process.env.MAIL_DISABLED;

describe('Google OAuth scope verification, Drive about & Mail verification', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.MAIL_DISABLED = originalMailDisabled;
    resetGoogleAuthStateForTests();
  });

  it('accurately reports configured vs missing Google OAuth env vars', () => {
    setGoogleOAuthConfigForTests(null);
    assert.equal(isGoogleOAuthConfigured(), false);
    assert.deepEqual(getMissingGoogleOAuthEnvVars(), [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REFRESH_TOKEN',
    ]);

    setGoogleOAuthConfigForTests({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      refreshToken: 'test-refresh-token',
    });
    assert.equal(isGoogleOAuthConfigured(), true);
    assert.deepEqual(getMissingGoogleOAuthEnvVars(), []);
  });

  it('captures scope from /token, deduplicates concurrent token refreshes, and validates both scopes', async () => {
    setGoogleOAuthConfigForTests({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      refreshToken: 'test-refresh-token',
    });

    let tokenFetchCalls = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      assert.equal(url, 'https://oauth2.googleapis.com/token');
      tokenFetchCalls += 1;
      return new Response(
        JSON.stringify({
          access_token: 'mock-access-token-1',
          expires_in: 3600,
          scope: `${GOOGLE_OAUTH_SCOPES[0]} ${GOOGLE_OAUTH_SCOPES[1]}`,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const [t1, t2] = await Promise.all([getGoogleAccessToken(), getGoogleAccessToken()]);
    assert.equal(t1, 'mock-access-token-1');
    assert.equal(t2, 'mock-access-token-1');
    assert.equal(tokenFetchCalls, 1);

    const scopeResult = await verifyGoogleOAuthScopes();
    assert.equal(scopeResult.hasAllScopes, true);
    assert.deepEqual(scopeResult.missingScopes, []);
    assert.equal(tokenFetchCalls, 1); // No unnecessary /tokeninfo call
  });

  it('calls /oauth2/v3/tokeninfo with Authorization Bearer header (never query param) when /token omits scope or forceTokenInfo=true', async () => {
    setGoogleOAuthConfigForTests({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      refreshToken: 'test-refresh-token',
    });

    const seenUrls: string[] = [];
    let seenAuthHeader: string | null = null;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      seenUrls.push(url);
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(
          JSON.stringify({ access_token: 'mock-access-token-2', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === 'https://www.googleapis.com/oauth2/v3/tokeninfo') {
        seenAuthHeader = new Headers(init?.headers).get('authorization');
        return new Response(
          JSON.stringify({ scope: `${GOOGLE_OAUTH_SCOPES[0]} ${GOOGLE_OAUTH_SCOPES[1]}` }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const scopes = await getGoogleGrantedScopes();
    assert.deepEqual(scopes, [...GOOGLE_OAUTH_SCOPES]);
    assert.equal(seenAuthHeader, 'Bearer mock-access-token-2');
    for (const u of seenUrls) {
      assert.equal(u.includes('access_token='), false);
    }
  });

  it('detects missing scope and throws HttpError(502) without leaking secrets', async () => {
    setGoogleOAuthConfigForTests({
      clientId: 'test-client-id',
      clientSecret: 'super-secret-value-123',
      refreshToken: 'super-refresh-token-456',
    });

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          access_token: 'mock-access-token-partial',
          expires_in: 3600,
          scope: GOOGLE_OAUTH_SCOPES[0], // Missing gmail.send
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;

    const res = await verifyGoogleOAuthScopes();
    assert.equal(res.hasAllScopes, false);
    assert.deepEqual(res.missingScopes, [GOOGLE_OAUTH_SCOPES[1]]);

    await assert.rejects(
      () => assertGoogleOAuthScopes(),
      (err: unknown) =>
        err instanceof HttpError &&
        err.statusCode === 502 &&
        err.message.includes(GOOGLE_OAUTH_SCOPES[1]) &&
        !err.message.includes('super-secret-value-123') &&
        !err.message.includes('super-refresh-token-456'),
    );
  });

  it('retries once on HTTP 401 and wraps invalid_grant without leaking client_secret or refresh_token', async () => {
    setGoogleOAuthConfigForTests({
      clientId: 'test-client-id',
      clientSecret: 'super-secret-value-123',
      refreshToken: 'super-refresh-token-456',
    });

    let tokenCount = 0;
    let apiCount = 0;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        tokenCount += 1;
        return new Response(
          JSON.stringify({ access_token: `tok-${tokenCount}`, expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      apiCount += 1;
      const auth = new Headers(init?.headers).get('authorization');
      if (apiCount === 1) {
        assert.equal(auth, 'Bearer tok-1');
        return new Response('Unauthorized', { status: 401 });
      }
      assert.equal(auth, 'Bearer tok-2');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const apiRes = await fetchWithGoogleAuth('https://www.googleapis.com/drive/v3/about');
    assert.equal(apiRes.status, 200);
    assert.equal(tokenCount, 2);
    assert.equal(apiCount, 2);

    // invalid_grant test
    resetGoogleAuthStateForTests();
    setGoogleOAuthConfigForTests({
      clientId: 'test-client-id',
      clientSecret: 'super-secret-value-123',
      refreshToken: 'super-refresh-token-456',
    });
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    await assert.rejects(
      () => getGoogleAccessToken(),
      (err: unknown) =>
        err instanceof HttpError &&
        err.statusCode === 502 &&
        err.message.includes('invalid_grant') &&
        !err.message.includes('super-secret-value-123') &&
        !err.message.includes('super-refresh-token-456'),
    );
  });

  it('verifyDriveAboutAccess parses user & quota on 200 and throws HttpError(502) on error', async () => {
    setGoogleOAuthConfigForTests({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      refreshToken: 'test-refresh-token',
    });

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'tok-drive', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          user: { emailAddress: 'owner@example.com', displayName: 'Owner' },
          storageQuota: { limit: '16106127360', usage: '1048576', usageInDrive: '524288' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const about = await verifyDriveAboutAccess();
    assert.equal(about.userEmail, 'owner@example.com');
    assert.equal(about.displayName, 'Owner');
    assert.equal(about.limitBytes, 16106127360);
    assert.equal(about.usageBytes, 1048576);

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'tok-drive', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: { message: 'Drive API disabled' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await assert.rejects(
      () => verifyDriveAboutAccess(),
      (err: unknown) => err instanceof HttpError && err.statusCode === 502 && err.message.includes('Drive API disabled'),
    );
  });

  it('mailService.verifyMailConnection enforces MAIL_DISABLED, full scopes, and fails when gmail.send is missing', async () => {
    setGoogleOAuthConfigForTests({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      refreshToken: 'test-refresh-token',
    });

    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          access_token: 'tok-mail',
          expires_in: 3600,
          scope: `${GOOGLE_OAUTH_SCOPES[0]} ${GOOGLE_OAUTH_SCOPES[1]}`,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    // 1. MAIL_DISABLED=1 -> false with 0 fetch calls
    process.env.MAIL_DISABLED = '1';
    assert.equal(await verifyMailConnection(), false);
    assert.equal(fetchCalls, 0);

    // 2. Both scopes granted -> true
    process.env.MAIL_DISABLED = '0';
    assert.equal(await verifyMailConnection(), true);
    assert.equal(fetchCalls, 1);

    // 3. Missing gmail.send -> rejects with HttpError(502)
    resetGoogleAuthStateForTests();
    setGoogleOAuthConfigForTests({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      refreshToken: 'test-refresh-token',
    });
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          access_token: 'tok-drive-only',
          expires_in: 3600,
          scope: GOOGLE_OAUTH_SCOPES[0],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;

    await assert.rejects(
      () => verifyMailConnection(),
      (err: unknown) => err instanceof HttpError && err.statusCode === 502 && err.message.includes('gmail.send'),
    );
  });
});
