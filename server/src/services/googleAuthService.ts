import { config } from '../config';
import { HttpError } from '../utils/errors';

export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.send',
] as const;

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const TOKEN_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_API_TIMEOUT_MS = 30_000;

interface CachedAccessToken {
  token: string;
  expiresAtMs: number;
}

interface GoogleTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
}

let cachedAccessToken: CachedAccessToken | null = null;
let inFlightRefreshPromise: Promise<string> | null = null;

/** Indica si las credenciales OAuth 2.0 de Google están configuradas. */
export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    config.googleClientId && config.googleClientSecret && config.googleRefreshToken
  );
}

/** Invalida el access token almacenado en memoria para forzar su renovación. */
export function invalidateGoogleAccessToken(): void {
  cachedAccessToken = null;
}

/** Reinicia por completo el estado en memoria de autenticación Google (solo pruebas). */
export function resetGoogleAuthStateForTests(): void {
  cachedAccessToken = null;
  inFlightRefreshPromise = null;
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
  if (!isGoogleOAuthConfigured()) {
    throw new HttpError(
      502,
      'Google OAuth 2.0 no está configurado en el servidor'
    );
  }

  const body = new URLSearchParams({
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    refresh_token: config.googleRefreshToken,
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

  cachedAccessToken = {
    token: accessToken,
    expiresAtMs: Date.now() + expiresInSec * 1000,
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
