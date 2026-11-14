import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

// Busca server/.env tanto desde src/ como desde dist/src/ o cwd=server, sin fallar si no existe (en Render vienen del entorno).
const envCandidates = [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(process.cwd(), '.env'),
];

for (const candidate of envCandidates) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Variable de entorno obligatoria no definida: ${name}`);
  }
  return value;
}

const jwtSecret = requireEnv('JWT_SECRET');
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres para mayor seguridad');
}

const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
const isHostedOnRender = Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL);
const isProd = nodeEnv === 'production' || isHostedOnRender;
const parsedPort = Number(process.env.PORT);
const parsedSmtpPort = Number(process.env.SMTP_PORT);
const parsedQuotaMb = Number(process.env.ATTACHMENTS_QUOTA_MB);
const rawMaintenanceMode = process.env.MAINTENANCE_MODE?.trim().toLowerCase() ?? '';
const rawMaintenanceEta = process.env.MAINTENANCE_ETA_MINUTES?.trim() ?? '';
const parsedMaintenanceEta = rawMaintenanceEta ? Number(rawMaintenanceEta) : NaN;
const smtpUser = process.env.SMTP_USER?.trim() || '';
const smtpPass = process.env.SMTP_PASS?.trim() || '';
function normalizeOrigin(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.includes('*')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    // Conservar cadena recortada si no corresponde a una URL completa
  }
  return trimmed;
}

function compileOriginWildcard(pattern: string): RegExp | null {
  if (!pattern.includes('*')) return null;
  const match = /^(https?):\/\/([a-z0-9*.-]+)(:\d+)?$/i.exec(pattern);
  if (!match) return null;
  const [, protocol, hostPattern, port = ''] = match;
  const fixedLabels = hostPattern.split('.').filter((label) => label && !label.includes('*'));
  if (fixedLabels.length < 2) {
    return null;
  }
  const escapedHost = hostPattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[a-z0-9-]+');
  const escapedPort = port.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${protocol.toLowerCase()}:\\/\\/${escapedHost}${escapedPort}$`, 'i');
}

const clientOrigin = normalizeOrigin(process.env.CLIENT_ORIGIN ?? '') || 'http://localhost:5173';
const renderExternalUrl = normalizeOrigin(process.env.RENDER_EXTERNAL_URL ?? '');
const extraAllowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((item) => normalizeOrigin(item))
  .filter(Boolean);

const rawAllowedEntries = [
  'https://tablero-kanban.onrender.com',
  clientOrigin,
  ...extraAllowedOrigins,
  ...(renderExternalUrl ? [renderExternalUrl] : []),
];

const prodAllowedOrigins = new Set<string>(
  rawAllowedEntries.filter((entry) => !entry.includes('*')),
);
const prodAllowedOriginPatterns = rawAllowedEntries
  .map((entry) => compileOriginWildcard(entry))
  .filter((re): re is RegExp => re !== null);

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized)) {
    return true;
  }
  if (isProd) {
    if (prodAllowedOrigins.has(normalized)) return true;
    if (prodAllowedOriginPatterns.some((re) => re.test(normalized))) return true;
    // Permite el dominio propio del servicio en Render (*.onrender.com con HTTPS)
    if (/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.onrender\.com$/i.test(normalized)) {
      return true;
    }
    return false;
  }
  return (
    normalized === clientOrigin ||
    prodAllowedOrigins.has(normalized) ||
    prodAllowedOriginPatterns.some((re) => re.test(normalized))
  );
}

export const config = {
  port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000,
  nodeEnv,
  isProd,
  jwtSecret,
  clientOrigin,
  smtpHost: process.env.SMTP_HOST?.trim() || 'smtp.gmail.com',
  smtpPort: Number.isFinite(parsedSmtpPort) && parsedSmtpPort > 0 ? parsedSmtpPort : 465,
  smtpSecure: (process.env.SMTP_SECURE?.trim() ?? 'true').toLowerCase() !== 'false',
  smtpUser,
  smtpPass,
  mailNotifyTo: process.env.MAIL_NOTIFY_TO?.trim() || smtpUser,
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || '',
  googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN?.trim() || '',
  googleDriveRootFolder: process.env.GOOGLE_DRIVE_ROOT_FOLDER?.trim() || 'Tablero Kanban',
  attachmentsQuotaMb:
    Number.isFinite(parsedQuotaMb) && parsedQuotaMb >= 16 ? parsedQuotaMb : 512,
  maintenanceMode: rawMaintenanceMode === 'true' || rawMaintenanceMode === '1',
  maintenanceTitle: process.env.MAINTENANCE_TITLE?.trim() || 'Tablero Kanban en mantenimiento',
  maintenanceMessage: process.env.MAINTENANCE_MESSAGE?.trim() || '',
  maintenanceEtaMinutes:
    Number.isInteger(parsedMaintenanceEta) && parsedMaintenanceEta > 0
      ? parsedMaintenanceEta
      : null,
} as const;
