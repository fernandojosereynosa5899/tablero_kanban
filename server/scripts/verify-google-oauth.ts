import crypto from 'node:crypto';
import { loadEnvFiles } from './lib/testCredentials';

function maskEmail(email: string | null): string {
  if (!email) return '(desconocido)';
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) return '***';
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function main(): Promise<void> {
  loadEnvFiles();

  const oauthKeys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] as const;
  const presence: Record<string, boolean> = {};
  const missing: string[] = [];

  for (const key of oauthKeys) {
    const present = Boolean(process.env[key]?.trim());
    presence[key] = present;
    if (!present) {
      missing.push(key);
    }
  }

  const mailDisabled = process.env.MAIL_DISABLED === '1';
  const hasMailRecipient = Boolean(
    process.env.MAIL_NOTIFY_TO?.trim() || process.env.SMTP_USER?.trim(),
  );
  const hasSmtpCredentials = Boolean(
    process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim(),
  );
  const driveRootFolder = process.env.GOOGLE_DRIVE_ROOT_FOLDER?.trim() || 'Tablero Kanban';

  console.log('[google:verify] Diagnóstico de configuración Google OAuth 2.0 (Drive + Gmail)');
  console.log(`  GOOGLE_CLIENT_ID:     ${presence.GOOGLE_CLIENT_ID ? 'configurado' : 'NO_CONFIGURADO'}`);
  console.log(`  GOOGLE_CLIENT_SECRET: ${presence.GOOGLE_CLIENT_SECRET ? 'configurado' : 'NO_CONFIGURADO'}`);
  console.log(`  GOOGLE_REFRESH_TOKEN: ${presence.GOOGLE_REFRESH_TOKEN ? 'configurado' : 'NO_CONFIGURADO'}`);
  console.log(`  GOOGLE_DRIVE_ROOT_FOLDER: ${driveRootFolder}`);
  console.log(`  MAIL_DISABLED:        ${mailDisabled ? 'true' : 'false'}`);
  console.log(`  MAIL_NOTIFY_TO/USER:  ${hasMailRecipient ? 'configurado' : 'NO_CONFIGURADO'}`);
  console.log(`  SMTP respaldo:        ${hasSmtpCredentials ? 'configurado' : 'NO_CONFIGURADO'}`);

  if (missing.length > 0) {
    console.log('');
    console.log(`[google:verify] Variables faltantes: ${missing.join(', ')}`);
    console.log(
      `[google:verify] Respaldo activo local -> Almacenamiento: PostgreSQL (AttachmentBlob) | Correo SMTP: ${
        hasSmtpCredentials && hasMailRecipient && !mailDisabled ? 'disponible' : 'no disponible'
      }`,
    );
    console.log('[google:verify] Estado: NO_CONFIGURADO (exitCode=1)');
    process.exitCode = 1;
    return;
  }

  // En ejecución CLI aislada sin JWT_SECRET definido, usar secreto efímero en memoria solo para cargar config.ts.
  if (!process.env.JWT_SECRET?.trim() || process.env.JWT_SECRET.trim().length < 32) {
    process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  }

  try {
    const { GOOGLE_OAUTH_SCOPES, verifyGoogleOAuthScopes } = await import(
      '../src/services/googleAuthService'
    );
    const { verifyDriveAboutAccess } = await import('../src/services/googleDriveService');

    const scopeResult = await verifyGoogleOAuthScopes(GOOGLE_OAUTH_SCOPES, {
      forceRefresh: true,
      forceTokenInfo: true,
    });

    console.log('');
    console.log('[google:verify] Scopes OAuth verificados vía /oauth2/v3/tokeninfo:');
    const grantedSet = new Set(scopeResult.grantedScopes);
    for (const requiredScope of GOOGLE_OAUTH_SCOPES) {
      console.log(`  - ${requiredScope}: ${grantedSet.has(requiredScope) ? 'PASS' : 'MISSING'}`);
    }
    console.log(`  Total scopes concedidos: ${scopeResult.grantedScopes.length}`);

    if (!scopeResult.hasAllScopes) {
      console.error(
        `[google:verify] Faltan permisos OAuth requeridos: ${scopeResult.missingScopes.join(', ')}`,
      );
      console.log('[google:verify] Estado: SCOPES_INCOMPLETOS (exitCode=1)');
      process.exitCode = 1;
      return;
    }

    const about = await verifyDriveAboutAccess();
    const limitLabel = about.limitBytes !== null ? formatBytes(about.limitBytes) : 'ilimitado';
    console.log('');
    console.log('[google:verify] Google Drive API (/drive/v3/about, solo lectura): PASS');
    console.log(`  Cuenta Drive: ${maskEmail(about.userEmail)}`);
    console.log(`  Uso / Cuota:  ${formatBytes(about.usageBytes)} / ${limitLabel}`);

    const gmailReady = !mailDisabled && hasMailRecipient;
    console.log('');
    console.log(
      `[google:verify] Gmail REST API (gmail.send): ${
        gmailReady ? 'PASS (listo sin enviar correo)' : 'WARN (scope OK, falta destinatario o MAIL_DISABLED=1)'
      }`,
    );

    if (!gmailReady) {
      console.log('[google:verify] Estado: CONFIGURACION_CORREO_INCOMPLETA (exitCode=1)');
      process.exitCode = 1;
      return;
    }

    console.log('[google:verify] Estado: VERIFICADO (exitCode=0)');
    process.exitCode = 0;
  } catch (err) {
    const safeMessage = err instanceof Error ? err.message : 'Error desconocido';
    console.error(`[google:verify] Falló la verificación OAuth: ${safeMessage}`);
    console.log('[google:verify] Estado: ERROR (exitCode=1)');
    process.exitCode = 1;
  }
}

void main();
