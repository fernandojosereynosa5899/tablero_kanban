import { config } from '../config';
import { HttpError } from '../utils/errors';

export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.send',
] as const;

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_TOKENINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/tokeninfo';
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const TOKEN_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_API_TIMEOUT_MS = 30_000;

interface CachedAccessToken {
  token: string;
  expiresAtMs: number;
  grantedScopes: string[];
  scopeVerifiedViaTokenInfo: boolean;
}

interface GoogleTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
}

interface GoogleTokenInfoResponse {
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

export interface GoogleOAuthTestConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GoogleScopeVerificationResult {
  grantedScopes: string[];
  missingScopes: string[];
  hasAllScopes: boolean;
}

let cachedAccessToken: CachedAccessToken | null = null;
let inFlightRefreshPromise: Promise<string> | null = null;
let inFlightTokenInfoPromise: Promise<string[]> | null = null;
let customTestOAuthConfig: GoogleOAuthTestConfig | null = null;

function resolveOAuthConfig(): GoogleOAuthTestConfig {
  if (customTestOAuthConfig) {
    return {
      clientId: customTestOAuthConfig.clientId.trim(),
      clientSecret: customTestOAuthConfig.clientSecret.trim(),
      refreshToken: customTestOAuthConfig.refreshToken.trim(),
    };
  }
  return {
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    refreshToken: config.googleRefreshToken,
  };
}

/** Configura credenciales OAuth mockeadas en memoria (solo pruebas). */
export function setGoogleOAuthConfigForTests(cfg: GoogleOAuthTestConfig | null): void {
  customTestOAuthConfig = cfg;
  invalidateGoogleAccessToken();
}

/** Devuelve los nombres de variables Google OAuth faltantes en la configuración activa. */
export function getMissingGoogleOAuthEnvVars(): string[] {
  const oauth = resolveOAuthConfig();
  const missing: string[] = [];
  if (!oauth.clientId) missing.push('GOOGLE_CLIENT_ID');
  if (!oauth.clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (!oauth.refreshToken) missing.push('GOOGLE_REFRESH_TOKEN');
  return missing;
}

/** Indica si las credenciales OAuth 2.0 de Google están configuradas. */
export function isGoogleOAuthConfigured(): boolean {
  return getMissingGoogleOAuthEnvVars().length === 0;
}

/** Invalida el access token almacenado en memoria para forzar su renovación. */
export function invalidateGoogleAccessToken(): void {
  cachedAccessToken = null;
  inFlightTokenInfoPromise = null;
}

/** Reinicia por completo el estado en memoria de autenticación Google (solo pruebas). */
export function resetGoogleAuthStateForTests(): void {
  cachedAccessToken = null;
  inFlightRefreshPromise = null;
  inFlightTokenInfoPromise = null;
  customTestOAuthConfig = null;
}

function parseGoogleScopes(rawScope: unknown): string[] {
  if (typeof rawScope !== 'string') return [];
  const trimmed = rawScope.trim();
  if (!trimmed) return [];
  return [...new Set(trimmed.split(/\s+/).map((item) => item.trim()).filter(Boolean))];
}

function buildTimeoutSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal | null
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!externalSignal) {
    return timeoutSignal;
  }
  return AbortSignal.any([externalSignal, timeoutSignal]);
}

async function refreshAccessTokenFromGoogle(): Promise<string> {
  const oauth = resolveOAuthConfig();
  if (!oauth.clientId || !oauth.clientSecret || !oauth.refreshToken) {
    throw new HttpError(
      502,
      'Google OAuth 2.0 no está configurado en el servidor'
    );
  }

  const body = new URLSearchParams({
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
    refresh_token: oauth.refreshToken,
    grant_type: 'refresh_token',
  });

  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason =
      err instanceof Error && err.name === 'TimeoutError'
        ? 'tiempo de espera agotado'
        : 'error de red al contactar con Google OAuth';
    throw new HttpError(502, `No se pudo renovar el acceso de Google (${reason})`);
  }

  const payload = (await response.json().catch(() => null)) as GoogleTokenResponse | null;

  if (!response.ok) {
    const errorCode =
      payload && typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : `HTTP ${response.status}`;
    throw new HttpError(
      502,
      `Google OAuth rechazó la renovación del token (${errorCode})`
    );
  }

  const accessToken =
    payload && typeof payload.access_token === 'string'
      ? payload.access_token.trim()
      : '';

  if (!accessToken) {
    throw new HttpError(
      502,
      'Respuesta inválida de Google OAuth: falta access_token'
    );
  }

  const rawExpiresIn =
    payload && typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
  const expiresInSec =
    Number.isFinite(rawExpiresIn) && rawExpiresIn > 0 ? rawExpiresIn : 3600;
  const grantedScopes = parseGoogleScopes(payload?.scope);

  cachedAccessToken = {
    token: accessToken,
    expiresAtMs: Date.now() + expiresInSec * 1000,
    grantedScopes,
    scopeVerifiedViaTokenInfo: false,
  };

  return accessToken;
}

/**
 * Obtiene un access token válido de Google OAuth 2.0 usando caché en memoria
 * y deduplicación singleflight para peticiones concurrentes.
 */
export async function getGoogleAccessToken(forceRefresh = false): Promise<string> {
  if (!isGoogleOAuthConfigured()) {
    throw new HttpError(
      502,
      'Google OAuth 2.0 no está configurado en el servidor'
    );
  }

  if (forceRefresh) {
    cachedAccessToken = null;
    inFlightTokenInfoPromise = null;
  } else if (
    cachedAccessToken &&
    Date.now() < cachedAccessToken.expiresAtMs - TOKEN_REFRESH_MARGIN_MS
  ) {
    return cachedAccessToken.token;
  }

  if (!inFlightRefreshPromise) {
    inFlightRefreshPromise = refreshAccessTokenFromGoogle().finally(() => {
      inFlightRefreshPromise = null;
    });
  }

  return inFlightRefreshPromise;
}

/**
 * Ejecuta `fetch` autenticado con Bearer token de Google. Si responde HTTP 401,
 * invalida la caché, renueva el token una vez y reintenta la petición una vez.
 */
export async function fetchWithGoogleAuth(
  url: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
    headers: initHeaders,
    signal: externalSignal,
    ...restInit
  } = init ?? {};

  const execute = async (token: string): Promise<Response> => {
    const headers = new Headers(initHeaders);
    headers.set('Authorization', `Bearer ${token}`);

    try {
      return await fetch(url, {
        ...restInit,
        headers,
        signal: buildTimeoutSignal(timeoutMs, externalSignal),
      });
    } catch (err) {
      const reason =
        err instanceof Error && err.name === 'TimeoutError'
          ? 'tiempo de espera agotado'
          : 'error de comunicación con la API de Google';
      throw new HttpError(502, `Error al conectar con Google API (${reason})`);
    }
  };

  const token = await getGoogleAccessToken(false);
  const firstResponse = await execute(token);

  if (firstResponse.status !== 401) {
    return firstResponse;
  }

  await firstResponse.body?.cancel().catch(() => undefined);
  invalidateGoogleAccessToken();
  const refreshedToken = await getGoogleAccessToken(true);
  return execute(refreshedToken);
}

async function fetchGrantedScopesFromTokenInfo(): Promise<string[]> {
  const response = await fetchWithGoogleAuth(GOOGLE_TOKENINFO_ENDPOINT, {
    method: 'GET',
    timeoutMs: TOKEN_REQUEST_TIMEOUT_MS,
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new HttpError(
      502,
      `No se pudieron verificar los permisos OAuth de Google (HTTP ${response.status})`
    );
  }

  const info = (await response.json().catch(() => null)) as GoogleTokenInfoResponse | null;
  const scopes = parseGoogleScopes(info?.scope);

  if (cachedAccessToken) {
    cachedAccessToken.grantedScopes = scopes;
    cachedAccessToken.scopeVerifiedViaTokenInfo = true;
  }

  return scopes;
}

/** Obtiene los scopes OAuth concedidos para el token activo usando memoria o tokeninfo. */
export async function getGoogleGrantedScopes(options?: {
  forceTokenInfo?: boolean;
  forceRefresh?: boolean;
}): Promise<string[]> {
  await getGoogleAccessToken(Boolean(options?.forceRefresh));

  if (
    !options?.forceTokenInfo &&
    cachedAccessToken &&
    (cachedAccessToken.grantedScopes.length > 0 || cachedAccessToken.scopeVerifiedViaTokenInfo)
  ) {
    return [...cachedAccessToken.grantedScopes];
  }

  if (!inFlightTokenInfoPromise) {
    inFlightTokenInfoPromise = fetchGrantedScopesFromTokenInfo().finally(() => {
      inFlightTokenInfoPromise = null;
    });
  }

  return inFlightTokenInfoPromise;
}

/** Verifica si el token OAuth cuenta con todos los scopes requeridos. */
export async function verifyGoogleOAuthScopes(
  requiredScopes: readonly string[] = GOOGLE_OAUTH_SCOPES,
  options?: { forceTokenInfo?: boolean; forceRefresh?: boolean }
): Promise<GoogleScopeVerificationResult> {
  const grantedScopes = await getGoogleGrantedScopes(options);
  const grantedSet = new Set(grantedScopes);
  const missingScopes = requiredScopes.filter((scope) => !grantedSet.has(scope));

  return {
    grantedScopes,
    missingScopes,
    hasAllScopes: missingScopes.length === 0,
  };
}

/** Exige que el token OAuth cuente con todos los scopes indicados o lanza HttpError(502). */
export async function assertGoogleOAuthScopes(
  requiredScopes: readonly string[] = GOOGLE_OAUTH_SCOPES,
  options?: { forceTokenInfo?: boolean; forceRefresh?: boolean }
): Promise<string[]> {
  const result = await verifyGoogleOAuthScopes(requiredScopes, options);
  if (!result.hasAllScopes) {
    throw new HttpError(
      502,
      `El token OAuth de Google no cuenta con los permisos requeridos: ${result.missingScopes.join(', ')}`
    );
  }
  return result.grantedScopes;
}
