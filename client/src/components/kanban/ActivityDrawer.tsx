import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity as ActivityIcon,
  ArrowRight,
  Award,
  CheckSquare,
  Edit3,
  Loader2,
  LogIn,
  MessageSquare,
  Paperclip,
  PlusCircle,
  RefreshCw,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { api, ApiError } from '../../lib/api';
import { TASK_STATUS_LABELS, type Activity, type TaskStatus } from '../../types/kanban';
import { VectorAvatar } from '../avatars/VectorAvatar';
import { EmptyActivityIllustration } from '../illustrations/VectorIllustrations';

interface ActivityDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelectTask?: (taskId: string) => void;
}

function formatRelativeTimeEs(iso: string): string {
  const date = new Date(iso);
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'Hace un momento';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `Hace ${diffHrs} h`;
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getStatusLabel(raw: unknown): string {
  if (typeof raw === 'string' && raw in TASK_STATUS_LABELS) {
    return TASK_STATUS_LABELS[raw as TaskStatus];
  }
  return String(raw ?? '');
}

function describeActivity(act: Activity): {
  text: string;
  icon: typeof ActivityIcon;
  badgeClass: string;
} {
  const details = act.details ?? {};
  const title = typeof details.title === 'string' ? details.title : '';
  const taskTitle = typeof details.taskTitle === 'string' ? details.taskTitle : '';

  switch (act.action) {
    case 'task.created':
      return {
        text: `creó la actividad "${title}" en ${getStatusLabel(details.status)}`,
        icon: PlusCircle,
        badgeClass: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
      };
    case 'task.updated':
      return {
        text: `editó la actividad "${title}"`,
        icon: Edit3,
        badgeClass: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
      };
    case 'task.moved':
      return {
        text: `movió "${title}" de ${getStatusLabel(details.fromStatus)} a ${getStatusLabel(details.toStatus)}`,
        icon: ArrowRight,
        badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
      };
    case 'task.approved':
      return {
        text: `aprobó la actividad "${title}"`,
        icon: Award,
        badgeClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
      };
    case 'task.deleted':
      return {
        text: `eliminó la actividad "${title}"`,
        icon: Trash2,
        badgeClass: 'bg-red-500/15 text-red-600 dark:text-red-400',
      };
    case 'comment.created':
      return {
        text: `comentó en "${title}"`,
        icon: MessageSquare,
        badgeClass: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
      };
    case 'subtask.toggled':
      return {
        text: `${details.done ? 'completó' : 'reabrió'} la subtarea "${title}"${taskTitle ? ` en "${taskTitle}"` : ''}`,
        icon: CheckSquare,
        badgeClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
      };
    case 'user.created':
      return {
        text: `agregó a ${typeof details.displayName === 'string' ? details.displayName : 'un integrante'} al equipo`,
        icon: UserPlus,
        badgeClass: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
      };
    case 'user.updated':
      return {
        text: 'actualizó un perfil o credencial del equipo',
        icon: Users,
        badgeClass: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
      };
    case 'user.deleted':
      return {
        text: `eliminó a ${typeof details.displayName === 'string' ? details.displayName : 'un integrante'} del equipo`,
        icon: Trash2,
        badgeClass: 'bg-red-500/15 text-red-600 dark:text-red-400',
      };
    case 'auth.login':
      return {
        text: 'inició sesión en el tablero',
        icon: LogIn,
        badgeClass: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
      };
    case 'security.alert':
      return {
        text: `activó una alerta de seguridad (${typeof details.eventType === 'string' ? details.eventType : 'acceso restringido'})`,
        icon: ShieldAlert,
        badgeClass: 'bg-red-500/15 text-red-600 dark:text-red-400',
      };
    case 'attachment.uploaded':
      return {
        text: `adjuntó "${typeof details.originalName === 'string' ? details.originalName : 'archivo'}" en "${title}"`,
        icon: Paperclip,
        badgeClass: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
      };
    case 'attachment.deleted':
      return {
        text: `eliminó el archivo "${typeof details.originalName === 'string' ? details.originalName : 'adjunto'}" de "${title}"`,
        icon: Trash2,
        badgeClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
      };
    default:
      return {
        text: `realizó una acción (${act.action})`,
        icon: ActivityIcon,
        badgeClass: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
      };
  }
}

export function ActivityDrawer({ open, onClose, onSelectTask }: ActivityDrawerProps) {
  const { socket, tasks } = useAuth();
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);

  const loadActivity = () => {
    setLoading(true);
    api
      .listActivity(30)
      .then((list) => {
        setItems(list);
      })
      .catch((err) => {
        const msg = err instanceof ApiError ? err.message : 'No se pudo cargar la actividad';
        toast.error(msg);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (!open) return;
    loadActivity();
  }, [open]);

  useEffect(() => {
    if (!open || !socket) return;

    const handleNewActivity = (activity: Activity) => {
      setItems((prev) => {
        if (prev.some((a) => a.id === activity.id)) return prev;
        return [activity, ...prev].slice(0, 50);
      });
    };

    socket.on('activity:new', handleNewActivity);
    return () => {
      socket.off('activity:new', handleNewActivity);
    };
  }, [open, socket]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const existingTaskIds = new Set(tasks.map((t) => t.id));

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="activity-drawer-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-xs"
          onClick={onClose}
        >
          <motion.aside
            key="activity-drawer-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="activity-drawer-title"
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            {/* Cabecera */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-400">
                  <ActivityIcon className="h-5 w-5" />
                </div>
                <div>
                  <h2
                    id="activity-drawer-title"
                    className="text-base font-bold text-slate-900 dark:text-white"
                  >
                    Actividad en vivo
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Últimos movimientos y cambios del equipo
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={loadActivity}
                  disabled={loading}
                  title="Actualizar historial"
                  aria-label="Actualizar historial"
                  className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Cerrar panel de actividad"
                  className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Lista de actividad */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              {loading && items.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-xs text-slate-500">
                  <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
                  <span>Cargando actividad reciente...</span>
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <EmptyActivityIllustration />
                  <p className="mt-3 text-sm font-medium text-slate-500 dark:text-slate-400">
                    Todavía no hay actividad registrada
                  </p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {items.map((item) => {
                    const { text, icon: Icon, badgeClass } = describeActivity(item);
                    const canOpenTask =
                      item.taskId !== null && existingTaskIds.has(item.taskId) && onSelectTask;
                    const actorName = item.user ? item.user.displayName : 'Sistema';

                    return (
                      <li
                        key={item.id}
                        className="flex items-start gap-3 rounded-2xl border border-slate-200/75 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40"
                      >
                        {item.user ? (
                          <VectorAvatar avatar={item.user.avatar} size={34} />
                        ) : (
                          <div
                            className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full ${badgeClass}`}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">
                            <strong className="font-bold text-slate-900 dark:text-white">
                              {actorName}
                            </strong>{' '}
                            {text}
                          </p>

                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                              <Icon className="h-3 w-3" />
                              {formatRelativeTimeEs(item.createdAt)}
                            </span>

                            {canOpenTask ? (
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectTask(item.taskId!);
                                  onClose();
                                }}
                                className="text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                              >
                                Ver tarjeta
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
