import fs from 'node:fs';
import { killProcessTree, RUNTIME_STATE_PATH, RuntimeState, TMP_DIR } from './env';

export default async function globalTeardown(): Promise<void> {
  let state: RuntimeState | null = null;
  if (fs.existsSync(RUNTIME_STATE_PATH)) {
    try {
      state = JSON.parse(fs.readFileSync(RUNTIME_STATE_PATH, 'utf8')) as RuntimeState;
    } catch {
      state = null;
    }
  }

  if (state) {
    killProcessTree(state.clientPid);
    killProcessTree(state.serverPid);
  }

  if (globalThis.__E2E_PG__) {
    try {
      await globalThis.__E2E_PG__.stop();
    } catch {
      // ignore stop errors on teardown
    }
    globalThis.__E2E_PG__ = undefined;
  }

  if (state?.pgDataDir && fs.existsSync(state.pgDataDir)) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.rmSync(state.pgDataDir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }

  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
