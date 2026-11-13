import type { NextFunction, Request, Response } from 'express';
import { verifyJwtAndLoadUser } from '../services/authService';
import { getMaintenanceStatus } from '../services/maintenanceService';
import type { MaintenanceStatus } from '../types/domain';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match?.[1]?.trim() || null;
}

export const MAINTENANCE_CLIENT_SCRIPT = `(function () {
  'use strict';

  var POLL_INTERVAL_SECONDS = 10;
  var TOKEN_STORAGE_KEY = 'kanban_token';

  function describeSource(source) {
    switch (source) {
      case 'env':
        return 'Variable de entorno (MAINTENANCE_MODE)';
      case 'file':
        return 'Archivo del repositorio (maintenance.json)';
      case 'database':
        return 'Base de datos (control en vivo)';
      default:
        return 'Ninguna';
    }
  }

  function init() {
    var card = document.getElementById('maintenance-card');
    var titleEl = document.getElementById('maintenance-title');
    var messageEl = document.getElementById('maintenance-message');
    var etaEl = document.getElementById('maintenance-eta');
    var etaTextEl = document.getElementById('maintenance-eta-text');
    var countdownEl = document.getElementById('countdown-seconds');
    var checkBtn = document.getElementById('check-now-btn');
    var checkStatusEl = document.getElementById('check-status');

    var leaderForm = document.getElementById('leader-login-form');
    var usernameInput = document.getElementById('leader-username');
    var passwordInput = document.getElementById('leader-password');
    var loginBtn = document.getElementById('leader-login-btn');
    var feedbackEl = document.getElementById('leader-feedback');
    var leaderPanelEl = document.getElementById('leader-panel');
    var leaderNameEl = document.getElementById('leader-name');
    var leaderSourceEl = document.getElementById('leader-source');
    var disableBtn = document.getElementById('disable-maintenance-btn');
    var sourceHintEl = document.getElementById('leader-source-hint');

    var secondsLeft = POLL_INTERVAL_SECONDS;
    var isChecking = false;
    var leaderToken = null;
    var currentStatus = {
      active: true,
      source: card ? card.getAttribute('data-source') || 'none' : 'none',
      canDisableInApp: card ? card.getAttribute('data-can-disable') === 'true' : false,
    };

    function setFeedback(message, isError) {
      if (!feedbackEl) return;
      if (!message) {
        feedbackEl.textContent = '';
        feedbackEl.hidden = true;
        feedbackEl.className = 'feedback';
        return;
      }
      feedbackEl.textContent = message;
      feedbackEl.hidden = false;
      feedbackEl.className = isError ? 'feedback feedback-error' : 'feedback feedback-success';
    }

    function syncLeaderPanel() {
      if (!leaderPanelEl || leaderPanelEl.hidden) return;
      if (leaderSourceEl) {
        leaderSourceEl.textContent = describeSource(currentStatus.source);
      }
      if (disableBtn) {
        disableBtn.hidden = !currentStatus.canDisableInApp;
      }
      if (sourceHintEl) {
        sourceHintEl.hidden = Boolean(currentStatus.canDisableInApp);
      }
    }

    function applyStatus(status) {
      if (!status || typeof status !== 'object') return;
      currentStatus = status;

      if (titleEl && typeof status.title === 'string' && status.title.length > 0) {
        titleEl.textContent = status.title;
      }
      if (messageEl && typeof status.message === 'string' && status.message.length > 0) {
        messageEl.textContent = status.message;
      }
      if (etaEl && etaTextEl) {
        if (typeof status.estimatedMinutes === 'number' && status.estimatedMinutes > 0) {
          etaTextEl.textContent = 'Tiempo estimado: ~' + status.estimatedMinutes + ' min';
          etaEl.hidden = false;
        } else {
          etaTextEl.textContent = '';
          etaEl.hidden = true;
        }
      }
      if (card) {
        card.setAttribute('data-source', status.source || 'none');
        card.setAttribute('data-can-disable', status.canDisableInApp ? 'true' : 'false');
      }
      syncLeaderPanel();
    }

    async function checkAvailability(isManual) {
      if (isChecking) return;
      isChecking = true;

      if (isManual && checkBtn) {
        checkBtn.disabled = true;
      }
      if (isManual && checkStatusEl) {
        checkStatusEl.textContent = 'Verificando disponibilidad del tablero...';
      }

      try {
        var res = await fetch('/api/maintenance/status', {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (res.ok) {
          var data = await res.json();
          applyStatus(data);
          if (data && data.active === false) {
            if (checkStatusEl) {
              checkStatusEl.textContent = '¡Tablero disponible! Recargando página...';
            }
            window.location.reload();
            return;
          }
          if (isManual && checkStatusEl) {
            checkStatusEl.textContent =
              'La ventana de mantenimiento sigue activa. Seguiremos verificando automáticamente.';
          }
        } else if (isManual && checkStatusEl) {
          checkStatusEl.textContent =
            'El servidor aún está en actualización. Intentaremos de nuevo en unos segundos.';
        }
      } catch (_err) {
        if (isManual && checkStatusEl) {
          checkStatusEl.textContent =
            'No se pudo contactar al servidor todavía. Reintentando automáticamente...';
        }
      } finally {
        isChecking = false;
        secondsLeft = POLL_INTERVAL_SECONDS;
        if (countdownEl) {
          countdownEl.textContent = String(secondsLeft);
        }
        if (checkBtn) {
          checkBtn.disabled = false;
        }
      }
    }

    window.setInterval(function () {
      if (isChecking) return;
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        void checkAvailability(false);
        return;
      }
      if (countdownEl) {
        countdownEl.textContent = String(secondsLeft);
      }
    }, 1000);

    if (checkBtn) {
      checkBtn.addEventListener('click', function () {
        void checkAvailability(true);
      });
    }

    if (leaderForm) {
      leaderForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        setFeedback('', false);

        var username = usernameInput ? usernameInput.value.trim() : '';
        var password = passwordInput ? passwordInput.value : '';
        if (!username || !password) {
          setFeedback('Ingresa tu usuario y contraseña de Líder.', true);
          return;
        }

        if (loginBtn) {
          loginBtn.disabled = true;
          loginBtn.textContent = 'Verificando credenciales...';
        }

        try {
          var res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ username: username, password: password }),
          });

          var data = await res.json().catch(function () {
            return {};
          });

          if (res.status === 503 && data && data.maintenance) {
            setFeedback(
              'Esta cuenta no tiene permisos de Líder. Por favor espera a que finalice la ventana de mantenimiento.',
              true,
            );
            return;
          }

          if (!res.ok) {
            setFeedback(
              (data && typeof data.error === 'string' && data.error) ||
                'No se pudo iniciar sesión. Verifica tus credenciales.',
              true,
            );
            return;
          }

          if (!data || !data.user || data.user.role !== 'LEADER' || !data.token) {
            setFeedback(
              'Tu cuenta no tiene rol de Líder. Solo el Líder puede gestionar el modo mantenimiento.',
              true,
            );
            return;
          }

          leaderToken = data.token;
          try {
            window.localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
          } catch (_storageErr) {
            // Ignorar si localStorage no está disponible.
          }

          try {
            var statusRes = await fetch('/api/maintenance/status', {
              method: 'GET',
              cache: 'no-store',
              headers: { Accept: 'application/json' },
            });
            if (statusRes.ok) {
              var latestStatus = await statusRes.json();
              applyStatus(latestStatus);
            }
          } catch (_statusErr) {
            // Conservar el estado actual si falla la refrescada.
          }

          if (leaderNameEl) {
            leaderNameEl.textContent = data.user.displayName || data.user.username;
          }
          leaderForm.hidden = true;
          if (leaderPanelEl) {
            leaderPanelEl.hidden = false;
          }
          syncLeaderPanel();
          setFeedback('Acceso de Líder verificado correctamente.', false);
        } catch (_err) {
          setFeedback('Error de red al verificar las credenciales. Intenta de nuevo.', true);
        } finally {
          if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.textContent = 'Iniciar sesión como Líder';
          }
        }
      });
    }

    if (disableBtn) {
      disableBtn.addEventListener('click', async function () {
        if (!leaderToken) {
          setFeedback('Debes iniciar sesión como Líder primero.', true);
          return;
        }

        disableBtn.disabled = true;
        disableBtn.textContent = 'Desactivando mantenimiento...';
        setFeedback('', false);

        try {
          var res = await fetch('/api/maintenance', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: 'Bearer ' + leaderToken,
            },
            body: JSON.stringify({ enabled: false }),
          });

          var data = await res.json().catch(function () {
            return {};
          });

          if (!res.ok) {
            setFeedback(
              (data && typeof data.error === 'string' && data.error) ||
                'No se pudo desactivar el modo mantenimiento.',
              true,
            );
            disableBtn.disabled = false;
            disableBtn.textContent = 'Desactivar mantenimiento y abrir tablero';
            return;
          }

          applyStatus(data);
          if (data && data.active === false) {
            setFeedback('Mantenimiento desactivado. Abriendo el tablero...', false);
            window.location.reload();
            return;
          }

          setFeedback(
            'Se desactivó en la base de datos, pero el mantenimiento sigue activo por: ' +
              describeSource(data && data.source) +
              '.',
            true,
          );
          disableBtn.disabled = false;
          disableBtn.textContent = 'Desactivar mantenimiento y abrir tablero';
        } catch (_err) {
          setFeedback('Error de conexión al desactivar el mantenimiento.', true);
          disableBtn.disabled = false;
          disableBtn.textContent = 'Desactivar mantenimiento y abrir tablero';
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;

export function renderMaintenanceHtml(status: MaintenanceStatus, overrideNotice?: string): string {
  const safeTitle = escapeHtml(status.title);
  const safeMessage = escapeHtml(status.message);
  const safeSource = escapeHtml(status.source);
  const hasEta = typeof status.estimatedMinutes === 'number' && status.estimatedMinutes > 0;
  const etaText = hasEta ? `Tiempo estimado: ~${status.estimatedMinutes} min` : '';
  const cleanNotice = overrideNotice?.trim();

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="refresh" content="20" />
  <title>${safeTitle} — Tablero Kanban</title>
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
    }
    [hidden] {
      display: none !important;
    }
    :root {
      color-scheme: dark;
    }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background:
        radial-gradient(circle at 20% 15%, rgba(99, 102, 241, 0.22), transparent 42%),
        radial-gradient(circle at 80% 85%, rgba(56, 189, 248, 0.14), transparent 45%),
        linear-gradient(160deg, #020617 0%, #0f172a 55%, #111827 100%);
      color: #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
      line-height: 1.55;
    }
    .page {
      width: 100%;
      max-width: 560px;
    }
    .card {
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 20px;
      padding: 32px 28px;
      box-shadow:
        0 24px 60px rgba(2, 6, 23, 0.7),
        inset 0 1px 0 rgba(255, 255, 255, 0.06);
      backdrop-filter: blur(12px);
    }
    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 18px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 6px 13px;
      border-radius: 999px;
      background: rgba(99, 102, 241, 0.18);
      border: 1px solid rgba(129, 140, 248, 0.45);
      color: #c7d2fe;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #818cf8;
      box-shadow: 0 0 0 0 rgba(129, 140, 248, 0.75);
      animation: pulse-ring 1.8s infinite ease-in-out;
    }
    @keyframes pulse-ring {
      0% {
        transform: scale(0.95);
        box-shadow: 0 0 0 0 rgba(129, 140, 248, 0.7);
      }
      70% {
        transform: scale(1.08);
        box-shadow: 0 0 0 8px rgba(129, 140, 248, 0);
      }
      100% {
        transform: scale(0.95);
        box-shadow: 0 0 0 0 rgba(129, 140, 248, 0);
      }
    }
    .eta-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 999px;
      background: rgba(30, 41, 59, 0.9);
      border: 1px solid rgba(148, 163, 184, 0.25);
      color: #cbd5e1;
      font-size: 13px;
      font-weight: 500;
    }
    h1 {
      margin: 0 0 12px;
      font-size: clamp(1.35rem, 2.5vw, 1.7rem);
      font-weight: 700;
      color: #f8fafc;
      letter-spacing: -0.02em;
    }
    .message {
      margin: 0 0 20px;
      color: #cbd5e1;
      font-size: 15px;
    }
    .notice {
      margin: 0 0 18px;
      padding: 11px 14px;
      border-radius: 12px;
      background: rgba(99, 102, 241, 0.12);
      border: 1px solid rgba(129, 140, 248, 0.3);
      color: #e0e7ff;
      font-size: 13.5px;
    }
    .status-box {
      padding: 18px;
      border-radius: 14px;
      background: rgba(30, 41, 59, 0.58);
      border: 1px solid rgba(148, 163, 184, 0.16);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .countdown {
      margin: 0;
      font-size: 13.5px;
      color: #94a3b8;
    }
    .countdown strong {
      color: #a5b4fc;
      font-variant-numeric: tabular-nums;
    }
    button {
      font-family: inherit;
      cursor: pointer;
      border: none;
      border-radius: 11px;
      font-weight: 600;
      transition: transform 0.12s ease, opacity 0.15s ease, background-color 0.15s ease;
    }
    button:disabled {
      opacity: 0.6;
      cursor: wait;
    }
    button:active:not(:disabled) {
      transform: translateY(1px);
    }
    .primary-btn {
      padding: 11px 16px;
      font-size: 14px;
      background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
      color: #ffffff;
      box-shadow: 0 6px 20px rgba(79, 70, 229, 0.35);
    }
    .primary-btn:hover:not(:disabled) {
      background: linear-gradient(135deg, #818cf8 0%, #6366f1 100%);
    }
    .check-status {
      margin: 0;
      min-height: 18px;
      font-size: 13px;
      color: #a5b4fc;
    }
    .leader-accordion {
      margin-top: 22px;
      border-top: 1px solid rgba(148, 163, 184, 0.18);
      padding-top: 16px;
    }
    .leader-accordion summary {
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      color: #94a3b8;
      list-style: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      user-select: none;
    }
    .leader-accordion summary::-webkit-details-marker {
      display: none;
    }
    .leader-accordion summary::after {
      content: "▾";
      font-size: 12px;
      transition: transform 0.15s ease;
    }
    .leader-accordion[open] summary::after {
      transform: rotate(180deg);
    }
    .leader-accordion summary:hover {
      color: #cbd5e1;
    }
    .leader-body {
      margin-top: 14px;
    }
    .leader-form {
      display: grid;
      gap: 12px;
    }
    .field {
      display: grid;
      gap: 5px;
    }
    .field label {
      font-size: 12.5px;
      font-weight: 500;
      color: #cbd5e1;
    }
    .field input {
      width: 100%;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(148, 163, 184, 0.28);
      background: rgba(2, 6, 23, 0.65);
      color: #f8fafc;
      font-size: 14px;
      outline: none;
    }
    .field input:focus {
      border-color: #818cf8;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25);
    }
    .secondary-btn {
      padding: 10px 14px;
      font-size: 13.5px;
      background: rgba(51, 65, 85, 0.85);
      color: #f1f5f9;
      border: 1px solid rgba(148, 163, 184, 0.25);
    }
    .secondary-btn:hover:not(:disabled) {
      background: rgba(71, 85, 105, 0.95);
    }
    .feedback {
      margin: 12px 0 0;
      padding: 10px 12px;
      border-radius: 10px;
      font-size: 13px;
    }
    .feedback-error {
      background: rgba(239, 68, 68, 0.14);
      border: 1px solid rgba(248, 113, 113, 0.35);
      color: #fecaca;
    }
    .feedback-success {
      background: rgba(16, 185, 129, 0.14);
      border: 1px solid rgba(52, 211, 153, 0.35);
      color: #a7f3d0;
    }
    .leader-panel {
      margin-top: 12px;
      padding: 14px;
      border-radius: 12px;
      background: rgba(2, 6, 23, 0.55);
      border: 1px solid rgba(148, 163, 184, 0.2);
      display: grid;
      gap: 10px;
    }
    .leader-meta {
      margin: 0;
      font-size: 13px;
      color: #cbd5e1;
    }
    .leader-meta strong {
      color: #f8fafc;
    }
    .danger-btn {
      padding: 10px 14px;
      font-size: 13.5px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: #ffffff;
    }
    .danger-btn:hover:not(:disabled) {
      background: linear-gradient(135deg, #34d399 0%, #10b981 100%);
    }
    .source-hint {
      margin: 0;
      font-size: 12.5px;
      color: #94a3b8;
    }
    @media (max-width: 480px) {
      .card {
        padding: 24px 18px;
      }
    }
  </style>
  <script src="/maintenance-client.js" defer></script>
</head>
<body>
  <main class="page">
    <section
      id="maintenance-card"
      class="card"
      data-source="${safeSource}"
      data-can-disable="${status.canDisableInApp ? 'true' : 'false'}"
    >
      <div class="header-row">
        <div class="badge">
          <span class="dot" aria-hidden="true"></span>
          <span>MANTENIMIENTO ACTIVO</span>
        </div>
        <div id="maintenance-eta" class="eta-chip"${hasEta ? '' : ' hidden'}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span id="maintenance-eta-text">${escapeHtml(etaText)}</span>
        </div>
      </div>

      <h1 id="maintenance-title">${safeTitle}</h1>
      <p id="maintenance-message" class="message">${safeMessage}</p>
      ${cleanNotice ? `<div class="notice">${escapeHtml(cleanNotice)}</div>` : ''}

      <div class="status-box">
        <p class="countdown">
          Próxima verificación automática en <strong id="countdown-seconds">10</strong>s
        </p>
        <button type="button" id="check-now-btn" class="primary-btn">
          Verificar disponibilidad ahora
        </button>
        <p id="check-status" class="check-status" role="status" aria-live="polite"></p>
      </div>

      <details id="leader-accordion" class="leader-accordion">
        <summary>Acceso exclusivo Líder</summary>
        <div class="leader-body">
          <form id="leader-login-form" class="leader-form">
            <div class="field">
              <label for="leader-username">Usuario</label>
              <input id="leader-username" name="username" type="text" autocomplete="username" required />
            </div>
            <div class="field">
              <label for="leader-password">Contraseña</label>
              <input id="leader-password" name="password" type="password" autocomplete="current-password" required />
            </div>
            <button type="submit" id="leader-login-btn" class="secondary-btn">
              Iniciar sesión como Líder
            </button>
          </form>

          <p id="leader-feedback" class="feedback" role="status" aria-live="polite" hidden></p>

          <div id="leader-panel" class="leader-panel" hidden>
            <p class="leader-meta">Líder autenticado: <strong id="leader-name"></strong></p>
            <p class="leader-meta">Fuente actual: <strong id="leader-source"></strong></p>
            <button type="button" id="disable-maintenance-btn" class="danger-btn" hidden>
              Desactivar mantenimiento y abrir tablero
            </button>
            <p id="leader-source-hint" class="source-hint" hidden>
              Este mantenimiento proviene de configuración externa (variable de entorno o maintenance.json) y no puede desactivarse desde la app.
            </p>
          </div>
        </div>
      </details>
    </section>
  </main>
</body>
</html>
`;
}

export function serveMaintenanceClientScript(_req: Request, res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(MAINTENANCE_CLIENT_SCRIPT);
}

export function sendMaintenanceHtmlResponse(
  res: Response,
  status: MaintenanceStatus,
  overrideNotice?: string,
): void {
  res.status(503);
  res.setHeader('Retry-After', '30');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderMaintenanceHtml(status, overrideNotice));
}

export async function apiMaintenanceGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const normalizedPath = req.path.startsWith('/api/')
      ? req.path.slice(4)
      : req.path === '/api'
        ? '/'
        : req.path;

    if (
      normalizedPath === '/health' ||
      normalizedPath === '/health/' ||
      normalizedPath.startsWith('/maintenance') ||
      normalizedPath === '/auth/login'
    ) {
      next();
      return;
    }

    const status = await getMaintenanceStatus();
    if (!status.active) {
      next();
      return;
    }

    const token = extractBearerToken(req.headers.authorization);
    if (token) {
      try {
        const user = await verifyJwtAndLoadUser(token);
        if (user.role === 'LEADER') {
          req.user = user;
          next();
          return;
        }
      } catch {
        // Token inválido o expirado: continuar con respuesta 503 de mantenimiento.
      }
    }

    res.setHeader('Retry-After', '30');
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({
      error: status.message,
      maintenance: true,
      status,
    });
  } catch (err) {
    next(err);
  }
}

export async function webMaintenanceGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (
      req.path === '/api' ||
      req.path.startsWith('/api/') ||
      req.path === '/socket.io' ||
      req.path.startsWith('/socket.io/') ||
      req.path === '/maintenance-client.js' ||
      req.path.startsWith('/assets/')
    ) {
      next();
      return;
    }

    const status = await getMaintenanceStatus();
    if (!status.active) {
      next();
      return;
    }

    sendMaintenanceHtmlResponse(res, status);
  } catch (err) {
    next(err);
  }
}
