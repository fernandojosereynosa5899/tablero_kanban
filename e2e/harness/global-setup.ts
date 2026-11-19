import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type EmbeddedPostgres from 'embedded-postgres';
import {
  buildIsolatedServerEnv,
  checkMaintenanceJsonPreflight,
  CLIENT_DIR,
  killProcessTree,
  PRISMA_CLI_PATH,
  REPO_ROOT,
  RoleSession,
  RUNTIME_STATE_PATH,
  RuntimeState,
  SERVER_DIR,
  TMP_DIR,
  TSX_CLI_PATH,
  VITE_CLI_PATH,
  waitForHttpReady,
} from './env';
import { getFreePorts } from './ports';

declare global {
  // eslint-disable-next-line no-var
  var __E2E_PG__: EmbeddedPostgres | undefined;
}

function runNodeSync(scriptPath: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, label: string): void {
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (res.status !== 0) {
    throw new Error(
      `${label} failed (exit ${res.status}):\nSTDOUT:\n${res.stdout ?? ''}\nSTDERR:\n${res.stderr ?? ''}`,
    );
  }
}

export default async function globalSetup(): Promise<void> {
  checkMaintenanceJsonPreflight();

  for (const requiredFile of [PRISMA_CLI_PATH, TSX_CLI_PATH, VITE_CLI_PATH]) {
    if (!fs.existsSync(requiredFile)) {
      throw new Error(`Required CLI entrypoint not found: ${requiredFile}`);
    }
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });
  const [pgPort, serverPort, clientPort] = await getFreePorts(3);
  const pgDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-e2e-pg-'));
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  const testPassword = `E2eKanban_${crypto.randomBytes(6).toString('hex')}!9A`;

  let serverPid: number | undefined;
  let clientPid: number | undefined;
  const { default: EmbeddedPostgresCtor } = await import('embedded-postgres');
  const pg = new EmbeddedPostgresCtor({
    databaseDir: pgDataDir,
    user: 'postgres',
    password: 'postgres',
    port: pgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: () => {},
  });

  try {
    await pg.initialise();
    await pg.start();
    globalThis.__E2E_PG__ = pg;

    const serverEnv = buildIsolatedServerEnv({
      pgPort,
      serverPort,
      clientPort,
      jwtSecret,
      testPassword,
    });

    runNodeSync(
      PRISMA_CLI_PATH,
      ['db', 'push', '--skip-generate', '--schema', path.join(SERVER_DIR, 'prisma', 'schema.prisma')],
      SERVER_DIR,
      serverEnv,
      'prisma db push',
    );

    runNodeSync(
      TSX_CLI_PATH,
      [path.join(SERVER_DIR, 'prisma', 'seed.ts')],
      SERVER_DIR,
      serverEnv,
      'prisma seed',
    );

    const serverLogs: string[] = [];
    const serverChild = spawn(process.execPath, [TSX_CLI_PATH, path.join(SERVER_DIR, 'src', 'index.ts')], {
      cwd: SERVER_DIR,
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    serverPid = serverChild.pid;
    serverChild.stdout?.on('data', (chunk: Buffer) => serverLogs.push(chunk.toString('utf8')));
    serverChild.stderr?.on('data', (chunk: Buffer) => serverLogs.push(chunk.toString('utf8')));

    const apiUrl = `http://127.0.0.1:${serverPort}`;
    const baseUrl = `http://127.0.0.1:${clientPort}`;

    try {
      await waitForHttpReady(
        `${apiUrl}/api/health`,
        (res, text) => {
          if (res.status !== 200) return false;
          const data = JSON.parse(text) as { status?: string; db?: boolean };
          return data.status === 'ok' && data.db === true;
        },
        30_000,
        'primary backend /api/health',
      );
    } catch (err) {
      throw new Error(`${(err as Error).message}\nServer logs:\n${serverLogs.slice(-30).join('')}`);
    }

    const clientLogs: string[] = [];
    const clientChild = spawn(
      process.execPath,
      [VITE_CLI_PATH, '--host', '127.0.0.1', '--port', String(clientPort), '--strictPort'],
      {
        cwd: CLIENT_DIR,
        env: {
          ...process.env,
          VITE_API_URL: apiUrl,
          VITE_SOCKET_URL: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    clientPid = clientChild.pid;
    clientChild.stdout?.on('data', (chunk: Buffer) => clientLogs.push(chunk.toString('utf8')));
    clientChild.stderr?.on('data', (chunk: Buffer) => clientLogs.push(chunk.toString('utf8')));

    try {
      await waitForHttpReady(
        `${baseUrl}/`,
        (res, text) => res.status === 200 && text.includes('Tablero Kanban'),
        30_000,
        'primary Vite client',
      );
    } catch (err) {
      throw new Error(`${(err as Error).message}\nClient logs:\n${clientLogs.slice(-30).join('')}`);
    }

    // Cache role sessions once (6 logins total, well within 25/5m IP rate limiter)
    const sessions: Record<string, RoleSession> = {};
    for (const username of ['lider', 'integrante1', 'integrante2', 'integrante3', 'integrante4', 'integrante5']) {
      const loginRes = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: testPassword }),
      });
      if (!loginRes.ok) {
        const body = await loginRes.text();
        throw new Error(`Failed bootstrap login for ${username}: ${loginRes.status} ${body}`);
      }
      sessions[username] = (await loginRes.json()) as RoleSession;
    }

    const tasksRes = await fetch(`${apiUrl}/api/tasks`, {
      headers: { Authorization: `Bearer ${sessions.lider.token}` },
    });
    if (!tasksRes.ok) {
      throw new Error(`Failed to fetch seeded tasks: ${tasksRes.status}`);
    }
    const seededTasks = (await tasksRes.json()) as Array<{ id: string }>;

    const state: RuntimeState = {
      pgPort,
      serverPort,
      clientPort,
      pgDataDir,
      serverPid: serverPid ?? 0,
      clientPid: clientPid ?? 0,
      apiUrl,
      baseUrl,
      jwtSecret,
      testPassword,
      sessions,
      seededTaskIds: seededTasks.map((t) => t.id),
    };

    fs.writeFileSync(RUNTIME_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    killProcessTree(clientPid);
    killProcessTree(serverPid);
    try {
      await pg.stop();
    } catch {
      // ignore
    }
    try {
      fs.rmSync(pgDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    throw err;
  }
}

export { REPO_ROOT };
