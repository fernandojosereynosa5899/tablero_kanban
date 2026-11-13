import assert from 'node:assert/strict';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import { getTestUserPassword } from './lib/testCredentials';

const PORT = Number(process.env.PROD_TEST_PORT || 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ROOT_DIR = path.resolve(__dirname, '../..');

function killProcessTree(child: ChildProcess | null): void {
  if (!child || child.pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // El proceso pudo haber terminado ya
  }
}

async function waitForHealth(timeoutMs = 30000): Promise<{ status: string; db: boolean; time: string }> {
  const start = Date.now();
  let lastError = 'sin respuesta';

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.status === 200) {
        const body = (await res.json()) as { status: string; db: boolean; time: string };
        if (body.status === 'ok' && body.db === true) {
          return body;
        }
        lastError = `health payload inesperado: ${JSON.stringify(body)}`;
      } else {
        lastError = `status ${res.status}`;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  throw new Error(`El servidor de producción no respondió /api/health en ${timeoutMs}ms (${lastError})`);
}

async function main(): Promise<void> {
  console.log(`[test:prod] Iniciando servidor unificado en modo producción (${BASE_URL})...`);

  const serverChild = spawn('npm', ['--prefix', 'server', 'run', 'start:prod'], {
    cwd: ROOT_DIR,
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutLog = '';
  let stderrLog = '';
  serverChild.stdout?.on('data', (chunk: Buffer) => {
    stdoutLog += chunk.toString('utf8');
  });
  serverChild.stderr?.on('data', (chunk: Buffer) => {
    stderrLog += chunk.toString('utf8');
  });

  const socketHolder: { current: Socket | null } = { current: null };

  try {
    const health = await waitForHealth(35000);
    assert.equal(health.status, 'ok');
    assert.equal(health.db, true);
    console.log('[test:prod] 1. GET /api/health -> 200', JSON.stringify(health));

    // 2. Verificar raíz '/'
    const rootRes = await fetch(`${BASE_URL}/`);
    assert.equal(rootRes.status, 200, 'GET / debe responder 200');
    const rootCt = rootRes.headers.get('content-type') || '';
    assert.ok(rootCt.includes('text/html'), `Content-Type de / debe ser text/html, fue ${rootCt}`);
    const rootCache = rootRes.headers.get('cache-control') || '';
    assert.ok(rootCache.includes('no-store'), `Cache-Control de / debe incluir no-store, fue ${rootCache}`);
    const rootHtml = await rootRes.text();
    assert.ok(rootHtml.includes('<div id="root">'), 'HTML raíz debe contener <div id="root">');
    console.log('[test:prod] 2. GET / -> 200 text/html con <div id="root"> y Cache-Control: no-store');

    // 3. Verificar fallback SPA
    const spaRes = await fetch(`${BASE_URL}/ruta-spa-cualquiera`);
    assert.equal(spaRes.status, 200, 'Fallback SPA debe responder 200');
    const spaCt = spaRes.headers.get('content-type') || '';
    assert.ok(spaCt.includes('text/html'), `Content-Type SPA debe ser text/html, fue ${spaCt}`);
    const spaHtml = await spaRes.text();
    assert.ok(spaHtml.includes('<div id="root">'), 'Fallback SPA debe devolver index.html');
    console.log('[test:prod] 3. GET /ruta-spa-cualquiera -> 200 text/html (fallback SPA)');

    // 4. Verificar /api/inexistente -> 404 JSON (no HTML)
    const notFoundRes = await fetch(`${BASE_URL}/api/inexistente`);
    assert.equal(notFoundRes.status, 404, 'GET /api/inexistente debe responder 404');
    const notFoundCt = notFoundRes.headers.get('content-type') || '';
    assert.ok(notFoundCt.includes('application/json'), `404 de API debe ser JSON, fue ${notFoundCt}`);
    const notFoundJson = (await notFoundRes.json()) as { error?: string };
    assert.equal(notFoundJson.error, 'Ruta de API no encontrada');
    console.log('[test:prod] 4. GET /api/inexistente -> 404 JSON:', JSON.stringify(notFoundJson));

    // 5. Extraer asset /assets/*.js y verificar 200 application/javascript
    const jsMatch = /src="(\/assets\/[^"]+\.js)"/.exec(rootHtml);
    assert.ok(jsMatch?.[1], 'Debe existir un script /assets/*.js en index.html');
    const assetPath = jsMatch[1];
    const assetRes = await fetch(`${BASE_URL}${assetPath}`);
    assert.equal(assetRes.status, 200, `GET ${assetPath} debe responder 200`);
    const assetCt = assetRes.headers.get('content-type') || '';
    assert.ok(
      assetCt.includes('javascript'),
      `Content-Type de ${assetPath} debe ser JavaScript, fue ${assetCt}`,
    );
    const assetText = await assetRes.text();
    assert.ok(assetText.length > 1000, 'El bundle JS debe tener contenido');
    console.log(`[test:prod] 5. GET ${assetPath} -> 200 (${assetCt}, ${assetText.length} bytes)`);

    // 6. Verificar CORS en producción con origen Render simulado
    const corsRes = await fetch(`${BASE_URL}/api/health`, {
      headers: { Origin: 'https://tablero-kanban.onrender.com' },
    });
    assert.equal(corsRes.status, 200);
    const acao = corsRes.headers.get('access-control-allow-origin');
    assert.equal(acao, 'https://tablero-kanban.onrender.com', 'CORS en prod debe permitir origen Render');
    console.log('[test:prod] 6. CORS REST en prod verificado (Access-Control-Allow-Origin:', acao, ')');

    // 7. Login vía POST /api/auth/login como lider
    const teamCredential = getTestUserPassword();
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'lider', password: teamCredential }),
    });
    assert.equal(loginRes.status, 200, 'Login como lider debe responder 200');
    const loginData = (await loginRes.json()) as {
      token: string;
      user: { id: string; username: string; role: string };
    };
    assert.ok(loginData.token, 'Login debe devolver token JWT');
    assert.equal(loginData.user.username, 'lider');
    console.log('[test:prod] 7. POST /api/auth/login (lider) -> 200 OK');

    // 8. Consultar GET /api/tasks autenticado
    const tasksRes = await fetch(`${BASE_URL}/api/tasks`, {
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    assert.equal(tasksRes.status, 200, 'GET /api/tasks debe responder 200');
    const tasks = (await tasksRes.json()) as Array<{ id: string; title: string; status: string }>;
    assert.ok(Array.isArray(tasks), 'Debe devolver lista de tareas');
    console.log(`[test:prod] 8. GET /api/tasks -> 200 (${tasks.length} tareas)`);

    // 9. Conectar Socket.IO con transports: ['websocket', 'polling'] y verificar presence:update
    const presencePayload = await new Promise<{ onlineUserIds: string[] }>((resolve, reject) => {
      const sock = createSocketClient(BASE_URL, {
        auth: { token: loginData.token },
        transports: ['websocket', 'polling'],
        reconnection: false,
        timeout: 6000,
      });
      socketHolder.current = sock;

      const timer = setTimeout(() => {
        reject(new Error('Timeout esperando presence:update en Socket.IO'));
      }, 7000);

      sock.on('presence:update', (payload: { onlineUserIds: string[] }) => {
        if (Array.isArray(payload?.onlineUserIds) && payload.onlineUserIds.includes(loginData.user.id)) {
          clearTimeout(timer);
          resolve(payload);
        }
      });

      sock.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Error de conexión Socket.IO: ${err.message}`));
      });
    });

    assert.ok(presencePayload.onlineUserIds.includes(loginData.user.id));
    console.log(
      '[test:prod] 9. Socket.IO conectado y presence:update recibido:',
      JSON.stringify(presencePayload),
    );

    // 10. Validar restricción de fechas (07/11/2026 al 19/12/2026)
    const prodTaskBase = {
      description: 'Prueba de validación de fechas en producción',
      priority: 'MEDIUM',
      assignedToAll: true,
      status: 'TODO',
      subtasks: ['Subtarea de validación'],
    };

    const beforeMinRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginData.token}`,
      },
      body: JSON.stringify({
        ...prodTaskBase,
        title: 'Prueba fuera de rango min',
        dueDate: '2026-11-06T12:00:00.000Z',
      }),
    });
    assert.equal(beforeMinRes.status, 400, 'Fecha menor a 2026-11-07 debe ser rechazada con 400');

    const afterMaxRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginData.token}`,
      },
      body: JSON.stringify({
        ...prodTaskBase,
        title: 'Prueba fuera de rango max',
        dueDate: '2026-12-20T12:00:00.000Z',
      }),
    });
    assert.equal(afterMaxRes.status, 400, 'Fecha mayor a 2026-12-19 debe ser rechazada con 400');

    const validRangeRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginData.token}`,
      },
      body: JSON.stringify({
        ...prodTaskBase,
        title: 'Prueba dentro de rango',
        dueDate: '2026-12-19T12:00:00.000Z',
      }),
    });
    assert.equal(validRangeRes.status, 201, 'Fecha 2026-12-19 dentro de rango debe crear 201');
    const createdTemp = (await validRangeRes.json()) as { id: string };
    const delTempRes = await fetch(`${BASE_URL}/api/tasks/${createdTemp.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    assert.equal(delTempRes.status, 200);
    console.log('[test:prod] 10. Validación rango fechas (07/11/2026 - 19/12/2026) -> OK');
  } catch (err) {
    console.error('[test:prod] STDOUT servidor:\n', stdoutLog);
    console.error('[test:prod] STDERR servidor:\n', stderrLog);
    throw err;
  } finally {
    if (socketHolder.current) {
      socketHolder.current.disconnect();
    }
    killProcessTree(serverChild);
  }

  console.log('[test:prod] Verificación integral en modo producción EXITOSA.');
}

void main().catch((err) => {
  console.error('[test:prod] FALLÓ:', err);
  process.exit(1);
});
