import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildIsolatedServerEnv,
  killProcessTree,
  RUNTIME_STATE_PATH,
  RuntimeState,
  SERVER_DIR,
  TSX_CLI_PATH,
  waitForHttpReady,
} from './env';
import { getFreePort } from './ports';

export interface SecondaryServerHandle {
  port: number;
  apiUrl: string;
  pid: number;
  stop: () => Promise<void>;
}

export interface SecondaryServerOptions {
  maintenanceMode?: string;
  maintenanceTitle?: string;
  maintenanceMessage?: string;
  maintenanceEtaMinutes?: string;
  clientOrigin?: string;
  allowedOrigins?: string;
  attachmentsQuotaMb?: string;
  nodeEnv?: string;
}

export async function startSecondaryServer(
  opts: SecondaryServerOptions = {},
): Promise<SecondaryServerHandle> {
  const state = JSON.parse(fs.readFileSync(RUNTIME_STATE_PATH, 'utf8')) as RuntimeState;
  const port = await getFreePort('127.0.0.1');
  const env = buildIsolatedServerEnv({
    pgPort: state.pgPort,
    serverPort: port,
    clientPort: state.clientPort,
    jwtSecret: state.jwtSecret,
    testPassword: state.testPassword,
    maintenanceMode: opts.maintenanceMode,
    maintenanceTitle: opts.maintenanceTitle,
    maintenanceMessage: opts.maintenanceMessage,
    maintenanceEtaMinutes: opts.maintenanceEtaMinutes,
    clientOrigin: opts.clientOrigin,
    allowedOrigins: opts.allowedOrigins,
    attachmentsQuotaMb: opts.attachmentsQuotaMb,
    nodeEnv: opts.nodeEnv,
  });

  const logs: string[] = [];
  const child = spawn(process.execPath, [TSX_CLI_PATH, path.join(SERVER_DIR, 'src', 'index.ts')], {
    cwd: SERVER_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout?.on('data', (chunk: Buffer) => logs.push(chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => logs.push(chunk.toString('utf8')));

  const apiUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHttpReady(
      `${apiUrl}/api/health`,
      (res, text) => {
        if (res.status !== 200) return false;
        const body = JSON.parse(text) as { status?: string; db?: boolean };
        return body.status === 'ok' && body.db === true;
      },
      25_000,
      `secondary backend (${port})`,
    );
  } catch (err) {
    killProcessTree(child.pid);
    throw new Error(`${(err as Error).message}\nSecondary server logs:\n${logs.slice(-30).join('')}`);
  }

  return {
    port,
    apiUrl,
    pid: child.pid ?? 0,
    stop: async () => {
      killProcessTree(child.pid);
    },
  };
}
