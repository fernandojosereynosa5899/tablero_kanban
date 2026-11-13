/**
 * Asistente interactivo CLI para obtener el GOOGLE_REFRESH_TOKEN (OAuth 2.0)
 * con permisos de Google Drive privado (drive.file) y Gmail REST API (gmail.send).
 *
 * Uso: npm --prefix server run google:auth
 * Opcional: npm --prefix server run google:auth -- --port 48152
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import dotenv from 'dotenv';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_ABOUT_URL =
  'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName),storageQuota';
const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.send',
] as const;

const DEFAULT_PORT = 48152;
const CALLBACK_PATH = '/oauth2callback';
const CALLBACK_TIMEOUT_MS = 5 * 60_000;

function loadEnvCandidates(): void {
  const candidates = [
    path.resolve(process.cwd(), 'server/.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../.env'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
    }
  }
}

function resolvePort(): number {
  const args = process.argv.slice(2);
  let rawPort: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' && args[i + 1]) {
      rawPort = args[i + 1];
      break;
    }
    if (arg.startsWith('--port=')) {
      rawPort = arg.slice('--port='.length);
      break;
    }
  }

  rawPort ??= process.env.GOOGLE_OAUTH_PORT;
  if (!rawPort) return DEFAULT_PORT;

  const parsed = Number(rawPort.trim());
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new Error(
      `Puerto inválido (${rawPort}). Usa un entero entre 1024 y 65535.`
    );
  }
  return parsed;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'N/D';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function renderCallbackPage(title: string, message: string, isError: boolean): string {
  const accent = isError ? '#b91c1c' : '#15803d';
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 32px; }
      .card { max-width: 560px; margin: 40px auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; box-shadow: 0 4px 16px rgba(15,23,42,0.06); }
      h1 { margin: 0 0 12px; font-size: 20px; color: ${accent}; }
      p { margin: 0; line-height: 1.5; font-size: 15px; color: #334155; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </div>
  </body>
</html>`;
}

async function promptIfMissing(
  rl: readline.Interface,
  label: string,
  currentValue: string
): Promise<string> {
  if (currentValue) return currentValue;
  const answer = (await rl.question(`${label}: `)).trim();
  if (!answer) {
    throw new Error(`El campo ${label} es obligatorio para continuar.`);
  }
  return answer;
}

interface OAuthTokenExchangeResult {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface DriveAboutResult {
  user?: {
    displayName?: string;
    emailAddress?: string;
  };
  storageQuota?: {
    limit?: string;
    usage?: string;
    usageInDrive?: string;
  };
}

function waitForOAuthCode(
  port: number,
  expectedState: string
): Promise<{ code: string; closeServer: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

      if (reqUrl.pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (reqUrl.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Ruta no encontrada');
        return;
      }

      const errorParam = reqUrl.searchParams.get('error');
      const codeParam = reqUrl.searchParams.get('code')?.trim() || '';
      const stateParam = reqUrl.searchParams.get('state')?.trim() || '';

      if (errorParam) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          renderCallbackPage(
            'Autorización cancelada o rechazada',
            `Google devolvió el error "${errorParam}". Vuelve a la consola para revisar los detalles.`,
            true
          )
        );
        if (!settled) {
          settled = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          server.close(() =>
            reject(new Error(`Google OAuth devolvió error: ${errorParam}`))
          );
        }
        return;
      }

      if (!codeParam || stateParam !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          renderCallbackPage(
            'Solicitud inválida',
            'Falta el código de autorización o el parámetro state no coincide. Reintenta desde la consola.',
            true
          )
        );
        if (!settled) {
          settled = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          server.close(() =>
            reject(
              new Error(
                'Callback OAuth inválido: código ausente o parámetro state no coincide.'
              )
            )
          );
        }
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        renderCallbackPage(
          'Autorización completada',
          'Puedes cerrar esta pestaña y volver a la terminal para copiar tus variables de entorno.',
          false
        )
      );

      if (!settled) {
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        const closeServer = () =>
          new Promise<void>((closeResolve) => {
            server.close(() => closeResolve());
          });
        resolve({ code: codeParam, closeServer });
      }
    });

    server.on('error', (err) => {
      if (!settled) {
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(
          new Error(
            `No se pudo abrir el servidor temporal en 127.0.0.1:${port}: ${err.message}`
          )
        );
      }
    });

    server.listen(port, '127.0.0.1', () => {
      timeoutHandle = setTimeout(() => {
        if (!settled) {
          settled = true;
          server.close(() =>
            reject(
              new Error(
                'Tiempo de espera agotado (5 minutos) esperando la respuesta de Google.'
              )
            )
          );
        }
      }, CALLBACK_TIMEOUT_MS);
    });
  });
}

async function exchangeCodeForTokens(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<OAuthTokenExchangeResult> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json().catch(() => ({}))) as OAuthTokenExchangeResult;
  if (!response.ok) {
    const errLabel = payload.error_description || payload.error || `HTTP ${response.status}`;
    throw new Error(`No se pudo canjear el código OAuth2: ${errLabel}`);
  }
  return payload;
}

async function verifyDriveAccess(accessToken: string): Promise<DriveAboutResult> {
  const response = await fetch(GOOGLE_DRIVE_ABOUT_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(
      `La verificación contra Google Drive falló (HTTP ${response.status}). Revisa que la API de Google Drive esté habilitada en tu proyecto.`
    );
  }

  return (await response.json()) as DriveAboutResult;
}

async function main(): Promise<void> {
  loadEnvCandidates();
  const port = resolvePort();
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  const rl = readline.createInterface({ input, output });

  try {
    console.log('\n=== Asistente OAuth 2.0 para Google Drive + Gmail REST API ===\n');

    const clientId = await promptIfMissing(
      rl,
      'GOOGLE_CLIENT_ID',
      process.env.GOOGLE_CLIENT_ID?.trim() || ''
    );
    const clientSecret = await promptIfMissing(
      rl,
      'GOOGLE_CLIENT_SECRET',
      process.env.GOOGLE_CLIENT_SECRET?.trim() || ''
    );
    const rootFolder =
      process.env.GOOGLE_DRIVE_ROOT_FOLDER?.trim() || 'Tablero Kanban';

    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = new URL(GOOGLE_AUTH_URL);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', GOOGLE_OAUTH_SCOPES.join(' '));
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('include_granted_scopes', 'true');
    authUrl.searchParams.set('state', state);

    const codePromise = waitForOAuthCode(port, state);

    console.log(`Servidor temporal escuchando en ${redirectUri}`);
    console.log('\nNota sobre el tipo de cliente OAuth en Google Cloud Console:');
    console.log(
      '  - Si creaste un cliente "App de escritorio" (Desktop app), el callback loopback funciona automáticamente.'
    );
    console.log(
      `  - Si creaste un cliente "Aplicación web", asegúrate de registrar "${redirectUri}" como URI de redireccionamiento autorizada antes de continuar.`
    );
    console.log('\n1) Abre la siguiente URL en tu navegador e inicia sesión con la cuenta Google del tablero:\n');
    console.log(authUrl.toString());
    console.log('\n2) Acepta los permisos de Google Drive (drive.file) y envío de Gmail (gmail.send).');
    console.log('Esperando autorización desde el navegador...\n');

    const { code, closeServer } = await codePromise;
    await closeServer();

    console.log('Código recibido. Intercambiando por tokens OAuth 2.0...');
    const tokens = await exchangeCodeForTokens({
      code,
      clientId,
      clientSecret,
      redirectUri,
    });

    if (!tokens.access_token) {
      throw new Error('Google no devolvió access_token.');
    }
    if (!tokens.refresh_token) {
      throw new Error(
        'Google no devolvió refresh_token. Revoca el acceso previo de la app en tu cuenta Google (myaccount.google.com/permissions) y vuelve a ejecutar este asistente.'
      );
    }

    const about = await verifyDriveAccess(tokens.access_token);
    const email = about.user?.emailAddress || 'desconocido';
    const displayName = about.user?.displayName || 'Cuenta Google';
    const usage = Number(about.storageQuota?.usage ?? 0);
    const limit = about.storageQuota?.limit ? Number(about.storageQuota.limit) : null;

    console.log(`\nConexión verificada con éxito: ${displayName} (${email})`);
    console.log(
      `Cuota de Google Drive: ${formatBytes(usage)} usados${
        limit !== null && Number.isFinite(limit) ? ` / ${formatBytes(limit)} totales` : ' (sin límite reportado)'
      }`
    );

    console.log('\n=== Copia estas variables en server/.env y en Render (Environment Variables) ===\n');
    console.log(`GOOGLE_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`GOOGLE_DRIVE_ROOT_FOLDER=${rootFolder}`);
    console.log('');
  } finally {
    rl.close();
  }
}

main().catch((err: unknown) => {
  console.error(
    '\n[google:auth] Error:',
    err instanceof Error ? err.message : String(err)
  );
  process.exitCode = 1;
});
