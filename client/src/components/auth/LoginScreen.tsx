import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Eye, EyeOff, Loader2, Lock, LogIn, Moon, Sun, User } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { ApiError } from '../../lib/api';
import { LoginHeroIllustration } from '../illustrations/VectorIllustrations';

export function LoginScreen() {
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    const trimmedUser = username.trim();
    if (!trimmedUser || !password) {
      setErrorMessage('Ingresa tu clave de usuario y contraseña.');
      return;
    }

    setSubmitting(true);
    try {
      await login(trimmedUser, password);
      toast.success('¡Bienvenido al Tablero Kanban!');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Ocurrió un error al iniciar sesión. Intenta nuevamente.';
      setErrorMessage(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-8 sm:px-6 lg:px-8 overflow-hidden bg-[#F3F4F6] dark:bg-[#111215] transition-colors">
      {/* Toggle claro/oscuro en esquina */}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        className="fixed top-4 right-4 z-20 inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 shadow-xs transition hover:bg-zinc-100 dark:border-[#272A33] dark:bg-[#181A1F] dark:text-zinc-200 dark:hover:bg-[#22252C]"
      >
        {theme === 'dark' ? (
          <>
            <Sun className="h-4 w-4 text-amber-400" />
            <span className="hidden sm:inline">Modo claro</span>
          </>
        ) : (
          <>
            <Moon className="h-4 w-4 text-zinc-600" />
            <span className="hidden sm:inline">Modo oscuro</span>
          </>
        )}
      </button>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 rounded-2xl border border-zinc-200 bg-white shadow-lg dark:border-[#272A33] dark:bg-[#181A1F] dark:shadow-black/40 overflow-hidden"
      >
        {/* Panel izquierdo con ilustración SVG */}
        <div className="lg:col-span-6 flex flex-col justify-between p-6 sm:p-10 bg-[#FAFAFA] dark:bg-[#14161A] border-b lg:border-b-0 lg:border-r border-zinc-200 dark:border-[#272A33]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700 dark:border-[#2D3038] dark:bg-[#1E2027] dark:text-zinc-300">
              <span className="h-2 w-2 rounded-full bg-[#2E9E5B]" />
              Espacio de trabajo del equipo
            </div>
            <h1 className="mt-4 text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100">
              Tablero Kanban
            </h1>
            <p className="mt-2 text-xs sm:text-sm font-semibold tracking-wider text-zinc-500 dark:text-zinc-400 uppercase">
              Organiza proyectos, mide avances y coordina a tu equipo
            </p>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="my-6"
          >
            <LoginHeroIllustration />
          </motion.div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/80 px-2.5 py-1 ring-1 ring-slate-200/80 dark:bg-slate-800/70 dark:ring-slate-700">
              <span className="h-2 w-2 rounded-full bg-[#1E88E5]" /> Por hacer
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/80 px-2.5 py-1 ring-1 ring-slate-200/80 dark:bg-slate-800/70 dark:ring-slate-700">
              <span className="h-2 w-2 rounded-full bg-[#FFA726]" /> En proceso
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/80 px-2.5 py-1 ring-1 ring-slate-200/80 dark:bg-slate-800/70 dark:ring-slate-700">
              <span className="h-2 w-2 rounded-full bg-[#7E57C2]" /> Hecho
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/80 px-2.5 py-1 ring-1 ring-slate-200/80 dark:bg-slate-800/70 dark:ring-slate-700">
              <span className="h-2 w-2 rounded-full bg-[#2E9E5B]" /> Aprobado
            </span>
          </div>
        </div>

        {/* Panel derecho con formulario */}
        <div className="lg:col-span-6 flex flex-col justify-center p-6 sm:p-10 lg:p-12">
          <div className="mx-auto w-full max-w-md">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
              Iniciar sesión
            </h2>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
              Ingresa con la clave de usuario y contraseña asignadas para tu equipo.
            </p>

            <form onSubmit={handleSubmit} className="mt-7 space-y-5" noValidate>
              <div>
                <label
                  htmlFor="login-username"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5"
                >
                  Clave de usuario
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    id="login-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Ej. lider o integrante1"
                    disabled={submitting}
                    className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5"
                >
                  Contraseña
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Ingresa tu contraseña"
                    disabled={submitting}
                    className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-11 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {errorMessage ? (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  role="alert"
                  className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
                >
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{errorMessage}</span>
                </motion.div>
              ) : null}

              <motion.button
                whileTap={{ scale: 0.99 }}
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Validando acceso...
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" />
                    Entrar al tablero
                  </>
                )}
              </motion.button>
            </form>

            <p className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
              Acceso privado para el líder y hasta 5 integrantes del equipo.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
