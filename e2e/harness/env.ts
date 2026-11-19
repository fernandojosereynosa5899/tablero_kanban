import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const E2E_ROOT = path.resolve(__dirname, '..');
export const REPO_ROOT = path.resolve(E2E_ROOT, '..');
export const SERVER_DIR = path.join(REPO_ROOT, 'server');
export const CLIENT_DIR = path.join(REPO_ROOT, 'client');
export const TMP_DIR = path.join(E2E_ROOT, '.tmp');
export const RUNTIME_STATE_PATH = path.join(TMP_DIR, 'runtime-state.json');

export const PRISMA_CLI_PATH = path.join(SERVER_DIR, 'node_modules', 'prisma', 'build', 'index.js');
export const TSX_CLI_PATH = path.join(SERVER_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
export const VITE_CLI_PATH = path.join(CLIENT_DIR, 'node_modules', 'vite', 'bin', 'vite.js');

export interface RoleSession {
  token: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    role: 'LEADER' | 'SUBLEADER' | 'MEMBER';
    slot: number;
    avatar: {
      preset: string;
      bg: string;
      color: string;
      accessory: string;
    };
    createdAt: string;
  };
}

export interface RuntimeState {
  pgPort: number;
  serverPort: number;
  clientPort: number;
  pgDataDir: string;
  serverPid: number;
  clientPid: number;
  apiUrl: string;
  baseUrl: string;
  jwtSecret: string;
  testPassword: string;
  sessions: Record<string, RoleSession>;
  seededTaskIds: string[];
}

export function checkMaintenanceJsonPreflight(): void {
  const maintenanceFile = path.join(REPO_ROOT, 'maintenance.json');
  if (!fs.existsSync(maintenanceFile)) {
    return;
  }
  const raw = fs.readFileSync(maintenanceFile, 'utf8');
  const parsed = JSON.parse(raw) as { enabled?: unknown };
  if (parsed.enabled === true) {
    throw new Error(
      `Preflight aborted: ${maintenanceFile} has enabled: true. E2E requires local maintenance.json enabled !== true.`,
    );
  }
}

export interface IsolatedServerEnvOptions {
  pgPort: number;
  serverPort: number;
  clientPort: number;
  jwtSecret: string;
  testPassword: string;
  maintenanceMode?: string;
  nodeEnv?: string;
  allowedOrigins?: string;
  clientOrigin?: string;
  attachmentsQuotaMb?: string;
  maintenanceTitle?: string;
  maintenanceMessage?: string;
  maintenanceEtaMinutes?: string;
}

export function buildIsolatedServerEnv(opts: IsolatedServerEnvOptions): NodeJS.ProcessEnv {
  const clientOrigin = opts.clientOrigin ?? `http://127.0.0.1:${opts.clientPort}`;
  return {
    ...process.env,
    DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${opts.pgPort}/postgres`,
    PORT: String(opts.serverPort),
    NODE_ENV: opts.nodeEnv ?? 'development',
    CLIENT_ORIGIN: clientOrigin,
    ALLOWED_ORIGINS: opts.allowedOrigins ?? clientOrigin,
    JWT_SECRET: opts.jwtSecret,
    SEED_INITIAL_PASSWORD: opts.testPassword,
    TEST_USER_PASSWORD: opts.testPassword,
    MAINTENANCE_MODE: opts.maintenanceMode ?? 'false',
    MAINTENANCE_TITLE: opts.maintenanceTitle ?? '',
    MAINTENANCE_MESSAGE: opts.maintenanceMessage ?? '',
    MAINTENANCE_ETA_MINUTES: opts.maintenanceEtaMinutes ?? '',
    MAIL_DISABLED: '1',
    // Explicit empty strings prevent dotenv (override: false) from loading real server/.env secrets
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GOOGLE_REFRESH_TOKEN: '',
    GOOGLE_DRIVE_ROOT_FOLDER: '',
    SMTP_HOST: '',
    SMTP_PORT: '',
    SMTP_SECURE: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    MAIL_NOTIFY_TO: '',
    ATTACHMENTS_QUOTA_MB: opts.attachmentsQuotaMb ?? '512',
    RENDER: '',
    RENDER_EXTERNAL_URL: '',
  };
}

export function killProcessTree(pid: number | undefined): void {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // ignore if already exited
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }
}

export async function waitForHttpReady(
  url: string,
  check: (res: Response, text: string) => boolean,
  timeoutMs = 30_000,
  label = url,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (check(res, text)) {
        return;
      }
      lastErr = `status=${res.status} body=${text.slice(0, 200)}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${label}: ${lastErr}`);
}
