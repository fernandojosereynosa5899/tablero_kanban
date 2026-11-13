import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ChevronDown,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Moon,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sun,
  User,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { ApiError } from '../../lib/api';
import type { MaintenanceSource, MaintenanceStatus } from '../../types/kanban';

export interface MaintenanceScreenProps {
  status: MaintenanceStatus;
  onRefresh: () => Promise<MaintenanceStatus | null>;
  allowLeaderLogin?: boolean;
}

const POLL_INTERVAL_MS = 15_000;

export function getMaintenanceSourceLabel(source: MaintenanceSource): string {
  switch (source) {
    case 'env':
      return 'Render / Env';
    case 'file':
      return 'Despliegue / Push';
    case 'database':
      return 'Líder en vivo';
    default:
      return 'Sistema';
  }
}

function formatEstimatedMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours} h ${remaining} min` : `${hours} h`;
}

function formatUpdatedAt(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
  }).format(date);
}

export function MaintenanceScreen({
  status,
  onRefresh,
  allowLeaderLogin = false,
}: MaintenanceScreenProps) {
  const { user, login, logout, updateMaintenance } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [checking, setChecking] = useState(false);
  const [lastCheckedLabel, setLastCheckedLabel] = useState<string | null>(null);
  const checkingRef = useRef(false);

  // Acordeón de acceso exclusivo para el Líder
  const [leaderOpen, setLeaderOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [disableOnLogin, setDisableOnLogin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const runCheck = useCallback(
    async (manual: boolean) => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      if (manual) {
        setChecking(true);
      }

      try {
        const fresh = await onRefresh();
        const nowLabel = new Intl.DateTimeFormat('es-ES', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date());
        setLastCheckedLabel(nowLabel);

        if (manual) {
          if (fresh && !fresh.active) {
            toast.success('¡El tablero ya está disponible!');
          } else if (fresh && fresh.active) {
            toast.info('El mantenimiento sigue en curso. Te reconectaremos automáticamente al terminar.');
          } else {
            toast.warning('No se pudo verificar el estado. Se reintentará automáticamente.');
          }
        }
      } finally {
        checkingRef.current = false;
        if (manual) {
          setChecking(false);
        }
      }
    },
    [onRefresh],
  );

  // Polling automático ligero cada 15s únicamente mientras esta pantalla está montada
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void runCheck(false);
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [runCheck]);

  const showLeaderAccess = allowLeaderLogin && (!user || user.role !== 'LEADER');
  const sourceLabel = getMaintenanceSourceLabel(status.source);
  const updatedAtLabel = formatUpdatedAt(status.updatedAt);

  const handleLeaderSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError(null);

    const trimmedUser = username.trim();
    if (!trimmedUser || !password) {
      setLoginError('Ingresa la clave de usuario y contraseña del Líder.');
      return;
    }

    setSubmitting(true);
    try {
      await login(trimmedUser, password);
      if (disableOnLogin && status.canDisableInApp) {
        try {
          await updateMaintenance({ enabled: false });
          toast.success('Mantenimiento finalizado. Tablero abierto para todo el equipo.');
        } catch (err) {
          const msg =
            err instanceof ApiError
              ? err.message
              : 'Ingresaste al tablero, pero no se pudo desactivar el mantenimiento.';
          toast.warning(msg);
        }
      } else {
        toast.success('Sesión de Líder iniciada en modo mantenimiento.');
      }
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'No se pudo validar el acceso. Verifica tus credenciales.';
      setLoginError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-10 sm:px-6 overflow-hidden bg-[#F3F4F6] dark:bg-[#111215] transition-colors">
      {/* Orbes ambientales suaves */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-28 -left-24 h-80 w-80 rounded-full bg-amber-400/20 blur-3xl dark:bg-amber-500/10" />
        <div className="absolute -bottom-28 -right-24 h-96 w-96 rounded-full bg-indigo-400/20 blur-3xl dark:bg-indigo-500/15" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-72 w-72 rounded-full bg-blue-400/10 blur-3xl dark:bg-blue-500/10" />
      </div>

      {/* Toggle claro/oscuro en esquina */}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        className="fixed top-4 right-4 z-20 inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white/90 backdrop-blur-md px-3 py-2 text-xs font-medium text-zinc-700 shadow-xs transition hover:bg-zinc-100 dark:border-[#272A33] dark:bg-[#181A1F]/90 dark:text-zinc-200 dark:hover:bg-[#22252C]"
      >
        {theme === 'dark' ? (
          <>
            <Sun className="h-4 w-4 text-amber-400" />
            <span className="hidden sm:inline">Modo claro</span>
          </>
        ) : (
          <>
            <Moon className="h-4 w-4 text-indigo-600" />
            <span className="hidden sm:inline">Modo oscuro</span>
          </>
        )}
      </button>

      {/* Tarjeta glassmorphic centrada */}
      <motion.main
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-xl rounded-3xl border border-white/70 bg-white/80 p-6 sm:p-9 shadow-2xl shadow-slate-900/10 backdrop-blur-xl dark:border-[#2D3038]/90 dark:bg-[#181A1F]/85 dark:shadow-black/50"
      >
        <div className="flex flex-col items-center text-center">
          {/* Ícono animado suavemente */}
          <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl border border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-100/80 shadow-inner dark:border-amber-500/30 dark:from-amber-500/20 dark:to-orange-500/10">
            <motion.div
              animate={{ rotate: [0, -10, 8, -4, 0] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
              className="text-amber-600 dark:text-amber-400"
            >
              <Wrench className="h-9 w-9" />
            </motion.div>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
              className="absolute -bottom-1.5 -right-1.5 flex h-8 w-8 items-center justify-center rounded-xl border border-indigo-200/80 bg-white text-indigo-600 shadow-sm dark:border-indigo-500/30 dark:bg-[#22252C] dark:text-indigo-300"
            >
              <Settings className="h-4 w-4" />
            </motion.div>
          </div>

          {/* Badge */}
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-amber-300/80 bg-amber-50 px-3.5 py-1 text-[11px] font-bold tracking-wider text-amber-800 uppercase dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-200">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
            VENTANA DE MANTENIMIENTO
          </div>

          {/* Título y mensaje */}
          <h1 className="mt-4 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white break-words">
            {status.title || 'Tablero Kanban en mantenimiento'}
          </h1>

          <p className="mt-3 text-sm sm:text-base leading-relaxed text-slate-600 dark:text-slate-300 break-words max-w-md">
            {status.message ||
              'Estamos realizando actualizaciones programadas para mejorar el tablero. Volveremos en breve.'}
          </p>

          {/* Chips informativos: tiempo estimado + origen */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {status.estimatedMinutes != null ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200/80 bg-indigo-50/90 px-3 py-1 text-xs font-semibold text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-200">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                Tiempo estimado: {formatEstimatedMinutes(status.estimatedMinutes)}
              </span>
            ) : null}

            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-100/90 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-[#2D3038] dark:bg-[#22252C] dark:text-slate-300">
              Origen: {sourceLabel}
            </span>
          </div>

          {(status.updatedByName || updatedAtLabel) && (
            <p className="mt-2.5 text-[11px] text-slate-400 dark:text-slate-500">
              {status.updatedByName ? `Actualizado por ${status.updatedByName}` : 'Actualizado'}
              {updatedAtLabel ? ` • ${updatedAtLabel}` : ''}
            </p>
          )}

          {/* Botón manual de verificación */}
          <div className="mt-6 w-full max-w-xs">
            <button
              type="button"
              onClick={() => void runCheck(true)}
              disabled={checking}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-500/25 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-500/30"
            >
              {checking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verificando disponibilidad...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Verificar disponibilidad ahora
                </>
              )}
            </button>
            <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
              Verificación automática cada 15 segundos
              {lastCheckedLabel ? ` • Última revisión ${lastCheckedLabel}` : ''}
            </p>
          </div>
        </div>

        {/* Pie: Acceso exclusivo Líder (cuando no hay Líder logueado en pantalla sin sesión) */}
        {showLeaderAccess ? (
          <div className="mt-7 pt-5 border-t border-zinc-200/80 dark:border-[#272A33]">
            <button
              type="button"
              onClick={() => {
                setLeaderOpen((prev) => !prev);
                setLoginError(null);
              }}
              aria-expanded={leaderOpen}
              className="w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#22252C] dark:hover:text-slate-200"
            >
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                Acceso exclusivo Líder
              </span>
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-200 ${
                  leaderOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            <AnimatePresence initial={false}>
              {leaderOpen ? (
                <motion.div
                  key="leader-accordion-body"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <form onSubmit={handleLeaderSubmit} className="mt-3 space-y-3 px-1 pb-1" noValidate>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Solo la cuenta de <strong>Líder</strong> puede acceder al tablero durante la
                      ventana de mantenimiento.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="maintenance-leader-user"
                          className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                        >
                          Clave de usuario
                        </label>
                        <div className="relative">
                          <User className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                          <input
                            id="maintenance-leader-user"
                            type="text"
                            autoComplete="username"
                            autoCapitalize="none"
                            spellCheck={false}
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Ej. lider"
                            disabled={submitting}
                            className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 disabled:opacity-60 dark:border-slate-700 dark:bg-[#14161A] dark:text-white dark:placeholder:text-slate-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="maintenance-leader-pass"
                          className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                        >
                          Contraseña
                        </label>
                        <div className="relative">
                          <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                          <input
                            id="maintenance-leader-pass"
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Contraseña"
                            disabled={submitting}
                            className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-9 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 disabled:opacity-60 dark:border-slate-700 dark:bg-[#14161A] dark:text-white dark:placeholder:text-slate-500"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((prev) => !prev)}
                            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          >
                            {showPassword ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {status.canDisableInApp ? (
                      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={disableOnLogin}
                          onChange={(e) => setDisableOnLogin(e.target.checked)}
                          disabled={submitting}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800"
                        />
                        <span>Finalizar mantenimiento y reabrir el tablero al iniciar sesión</span>
                      </label>
                    ) : null}

                    {loginError ? (
                      <div
                        role="alert"
                        className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
                      >
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>{loginError}</span>
                      </div>
                    ) : null}

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-500/25 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Verificando acceso...
                        </>
                      ) : (
                        <>
                          <LogIn className="h-3.5 w-3.5" />
                          {disableOnLogin && status.canDisableInApp
                            ? 'Ingresar y reabrir tablero'
                            : 'Ingresar como Líder'}
                        </>
                      )}
                    </button>
                  </form>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        ) : user && user.role !== 'LEADER' ? (
          <div className="mt-7 pt-4 border-t border-zinc-200/80 dark:border-[#272A33] flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>
              Sesión activa: <strong className="text-slate-700 dark:text-slate-200">{user.displayName}</strong>
            </span>
            <button
              type="button"
              onClick={() => logout('Sesión cerrada')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 dark:border-[#2D3038] dark:bg-[#212329] dark:text-slate-300 dark:hover:border-red-500/30 dark:hover:bg-red-950/40 dark:hover:text-red-300"
            >
              <LogOut className="h-3.5 w-3.5" />
              Cerrar sesión
            </button>
          </div>
        ) : null}
      </motion.main>
    </div>
  );
}
