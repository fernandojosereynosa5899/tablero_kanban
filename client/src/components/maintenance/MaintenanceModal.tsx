import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  Save,
  ShieldAlert,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../lib/api';
import { getMaintenanceSourceLabel } from './MaintenanceScreen';

interface MaintenanceModalProps {
  open: boolean;
  onClose: () => void;
}

const DEFAULT_TITLE = 'Tablero Kanban en mantenimiento';
const DEFAULT_MESSAGE =
  'Estamos realizando mejoras y ajustes en el tablero. Tu progreso está guardado y volveremos en unos minutos.';
const PRESET_MINUTES = [5, 10, 15, 30] as const;

export function MaintenanceModal({ open, onClose }: MaintenanceModalProps) {
  const { user, maintenanceStatus, updateMaintenance, refreshMaintenance } = useAuth();

  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [minutesInput, setMinutesInput] = useState('');
  const [submittingAction, setSubmittingAction] = useState<'activate' | 'update' | 'disable' | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;

    setTitle(maintenanceStatus?.title?.trim() ? maintenanceStatus.title : DEFAULT_TITLE);
    setMessage(maintenanceStatus?.message?.trim() ? maintenanceStatus.message : DEFAULT_MESSAGE);
    setMinutesInput(
      maintenanceStatus?.estimatedMinutes != null ? String(maintenanceStatus.estimatedMinutes) : '',
    );
    setSubmittingAction(null);
    void refreshMaintenance();
    // Solo reinicializar los campos al abrir el modal para no pisar la edición del Líder
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submittingAction) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, submittingAction]);

  if (!user || user.role !== 'LEADER') return null;

  const isActive = Boolean(maintenanceStatus?.active);
  const source = maintenanceStatus?.source ?? 'none';
  const canDisableInApp = maintenanceStatus?.canDisableInApp ?? true;
  const isForcedExternal = isActive && !canDisableInApp && (source === 'env' || source === 'file');
  const isBusy = submittingAction !== null;

  const parseFormValues = (): {
    title: string;
    message: string;
    estimatedMinutes: number | null;
  } | null => {
    const cleanTitle = title.trim();
    const cleanMessage = message.trim();
    const cleanMinutes = minutesInput.trim();

    if (cleanTitle.length < 3 || cleanTitle.length > 100) {
      toast.error('El título debe tener entre 3 y 100 caracteres.');
      return null;
    }

    if (cleanMessage.length < 5 || cleanMessage.length > 400) {
      toast.error('El mensaje para el equipo debe tener entre 5 y 400 caracteres.');
      return null;
    }

    let estimatedMinutes: number | null = null;
    if (cleanMinutes.length > 0) {
      const parsed = Number(cleanMinutes);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1440) {
        toast.error('La duración estimada debe ser un número entero entre 1 y 1440 minutos.');
        return null;
      }
      estimatedMinutes = parsed;
    }

    return {
      title: cleanTitle,
      message: cleanMessage,
      estimatedMinutes,
    };
  };

  const handleActivateOrUpdate = async (mode: 'activate' | 'update') => {
    if (isForcedExternal) return;
    const values = parseFormValues();
    if (!values) return;

    setSubmittingAction(mode);
    try {
      await updateMaintenance({
        enabled: true,
        title: values.title,
        message: values.message,
        estimatedMinutes: values.estimatedMinutes,
      });

      if (mode === 'activate') {
        toast.success('Ventana de mantenimiento activada para el equipo.');
        onClose();
      } else {
        toast.success('Aviso de mantenimiento actualizado.');
      }
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'No se pudo guardar la configuración de mantenimiento.';
      toast.error(msg);
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleDisable = async () => {
    if (!canDisableInApp) return;

    setSubmittingAction('disable');
    try {
      await updateMaintenance({ enabled: false });
      toast.success('Mantenimiento finalizado. El tablero fue reabierto para todo el equipo.');
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'No se pudo finalizar el modo mantenimiento.';
      toast.error(msg);
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isForcedExternal) return;
    void handleActivateOrUpdate(isActive ? 'update' : 'activate');
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="maintenance-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6 backdrop-blur-xs"
          onClick={() => {
            if (!isBusy) onClose();
          }}
        >
          <motion.div
            key="maintenance-modal-dialog"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="maintenance-modal-title"
            className="relative w-full max-w-xl max-h-[90dvh] flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-[#2D3038] dark:bg-[#181A1F]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabecera */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6 dark:border-[#272A33]">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                    isActive
                      ? 'bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300'
                      : 'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300'
                  }`}
                >
                  <Wrench className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="maintenance-modal-title"
                    className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate"
                  >
                    Ventana de Mantenimiento
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Control exclusivo del Líder para pausar el tablero al equipo
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                disabled={isBusy}
                aria-label="Cerrar modal de mantenimiento"
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-[#22252C] dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Contenido */}
            <form onSubmit={handleSubmit} className="overflow-y-auto px-5 py-5 sm:px-6 space-y-5">
              {/* Estado actual */}
              <div
                className={`rounded-2xl border p-3.5 ${
                  isActive
                    ? 'border-amber-200 bg-amber-50/80 dark:border-amber-500/30 dark:bg-amber-500/10'
                    : 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex h-2.5 w-2.5 rounded-full ${
                        isActive ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'
                      }`}
                    />
                    <span
                      className={`text-xs font-bold uppercase tracking-wide ${
                        isActive
                          ? 'text-amber-800 dark:text-amber-200'
                          : 'text-emerald-800 dark:text-emerald-200'
                      }`}
                    >
                      Estado actual: {isActive ? 'Activo' : 'Inactivo (Tablero abierto)'}
                    </span>
                  </div>

                  {isActive ? (
                    <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-amber-300/70 dark:bg-[#181A1F]/80 dark:text-slate-200 dark:ring-amber-500/30">
                      Origen: {getMaintenanceSourceLabel(source)}
                    </span>
                  ) : null}
                </div>

                {isForcedExternal ? (
                  <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-amber-300/80 bg-white/80 p-2.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-[#14161A]/80 dark:text-amber-200">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                    <p className="leading-relaxed">
                      {source === 'env' ? (
                        <>
                          El mantenimiento está forzado por la variable de entorno{' '}
                          <strong>Render / Env</strong> (<code>MAINTENANCE_MODE</code>). Esta fuente
                          tiene prioridad sobre la base de datos y no puede apagarse desde la
                          aplicación hasta retirarla en el entorno.
                        </>
                      ) : (
                        <>
                          El mantenimiento está forzado por el archivo de despliegue{' '}
                          <strong>Despliegue / Push</strong> (<code>maintenance.json</code>). Esta
                          fuente tiene prioridad sobre la base de datos y no puede apagarse desde la
                          aplicación hasta actualizar el archivo y redesplegar.
                        </>
                      )}
                    </p>
                  </div>
                ) : (
                  <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {isActive
                      ? 'Los integrantes y sublíderes ven actualmente la pantalla de mantenimiento. Tú conservas acceso completo al tablero para revisar o probar cambios.'
                      : 'Al activarlo, todos los integrantes y sublíderes verán la pantalla de mantenimiento en tiempo real, mientras tú mantienes acceso completo como Líder.'}
                  </p>
                )}
              </div>

              {/* Título */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label
                    htmlFor="maintenance-title-input"
                    className="text-xs font-semibold text-slate-700 dark:text-slate-200"
                  >
                    Título visible
                  </label>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    {title.trim().length}/100
                  </span>
                </div>
                <input
                  id="maintenance-title-input"
                  type="text"
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isBusy || isForcedExternal}
                  placeholder={DEFAULT_TITLE}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-[#14161A] dark:text-white dark:placeholder:text-slate-500"
                />
              </div>

              {/* Mensaje para el equipo */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label
                    htmlFor="maintenance-message-input"
                    className="text-xs font-semibold text-slate-700 dark:text-slate-200"
                  >
                    Mensaje para el equipo
                  </label>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    {message.trim().length}/400
                  </span>
                </div>
                <textarea
                  id="maintenance-message-input"
                  rows={3}
                  maxLength={400}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={isBusy || isForcedExternal}
                  placeholder={DEFAULT_MESSAGE}
                  className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-[#14161A] dark:text-white dark:placeholder:text-slate-500"
                />
              </div>

              {/* Duración estimada opcional */}
              <div>
                <label
                  htmlFor="maintenance-minutes-input"
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2"
                >
                  <Clock className="h-3.5 w-3.5 text-indigo-500" />
                  Duración estimada en minutos (opcional)
                </label>

                <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                  <button
                    type="button"
                    disabled={isBusy || isForcedExternal}
                    onClick={() => setMinutesInput('')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium border transition disabled:opacity-50 ${
                      minutesInput.trim() === ''
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-500/20 dark:text-indigo-200'
                        : 'border-zinc-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-[#2D3038] dark:bg-[#212329] dark:text-slate-300 dark:hover:bg-[#292C34]'
                    }`}
                  >
                    Sin estimación
                  </button>

                  {PRESET_MINUTES.map((mins) => {
                    const selected = minutesInput.trim() === String(mins);
                    return (
                      <button
                        key={mins}
                        type="button"
                        disabled={isBusy || isForcedExternal}
                        onClick={() => setMinutesInput(String(mins))}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium border transition disabled:opacity-50 ${
                          selected
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-500/20 dark:text-indigo-200'
                            : 'border-zinc-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-[#2D3038] dark:bg-[#212329] dark:text-slate-300 dark:hover:bg-[#292C34]'
                        }`}
                      >
                        {mins} min
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    id="maintenance-minutes-input"
                    type="number"
                    min={1}
                    max={1440}
                    step={1}
                    value={minutesInput}
                    onChange={(e) => setMinutesInput(e.target.value)}
                    disabled={isBusy || isForcedExternal}
                    placeholder="Personalizado (1 – 1440 min)"
                    className="w-full sm:w-56 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-[#14161A] dark:text-white dark:placeholder:text-slate-500"
                  />
                  <span className="text-xs text-slate-500 dark:text-slate-400">minutos</span>
                </div>
              </div>

              {!isActive ? (
                <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:border-[#272A33] dark:bg-[#14161A] dark:text-slate-400">
                  <Info className="h-4 w-4 shrink-0 mt-0.5 text-indigo-500" />
                  <span>
                    Cuando finalices tus cambios podrás reabrir el tablero con un clic desde el banner
                    superior o desde este modal.
                  </span>
                </div>
              ) : null}

              {/* Pie de acciones */}
              <div className="pt-2 border-t border-slate-100 dark:border-[#272A33] flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isBusy}
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-[#2D3038] dark:bg-[#212329] dark:text-slate-200 dark:hover:bg-[#292C34]"
                >
                  Cerrar
                </button>

                {!isActive ? (
                  <button
                    type="submit"
                    disabled={isBusy}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md shadow-amber-600/20 transition hover:bg-amber-700 focus:outline-none focus:ring-4 focus:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {submittingAction === 'activate' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Activando mantenimiento...
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="h-4 w-4" />
                        Activar ventana de mantenimiento
                      </>
                    )}
                  </button>
                ) : (
                  <>
                    {!isForcedExternal ? (
                      <button
                        type="submit"
                        disabled={isBusy}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-200 dark:hover:bg-indigo-500/25"
                      >
                        {submittingAction === 'update' ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Guardando...
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4" />
                            Actualizar aviso
                          </>
                        )}
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => void handleDisable()}
                      disabled={isBusy || !canDisableInApp}
                      title={
                        !canDisableInApp
                          ? 'No disponible: el mantenimiento está forzado por entorno o despliegue'
                          : undefined
                      }
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md shadow-emerald-600/20 transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {submittingAction === 'disable' ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Reabriendo tablero...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          Finalizar mantenimiento y reabrir tablero
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </form>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
