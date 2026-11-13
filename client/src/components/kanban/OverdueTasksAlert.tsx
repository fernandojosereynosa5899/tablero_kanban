import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { isTaskIncompleteOverdue, TASK_STATUS_LABELS, type Role, type Task } from '../../types/kanban';

interface OverdueTasksAlertProps {
  tasks: Task[];
  currentUserId: string;
  currentUserRole: Role;
  onOpenTask: (taskId: string) => void;
}

function formatDueShort(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

export function OverdueTasksAlert({
  tasks,
  currentUserId,
  currentUserRole,
  onOpenTask,
}: OverdueTasksAlertProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [collapsed, setCollapsed] = useState(false);
  const alertedIdsRef = useRef<Set<string>>(new Set());

  // Reevaluar cada minuto por si una tarea vence mientras el tablero está abierto
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const overdueTasks = useMemo(() => {
    return tasks
      .filter((t) => isTaskIncompleteOverdue(t, nowMs))
      .sort((a, b) => {
        const aTime = a.dueDate ? Date.parse(a.dueDate) : 0;
        const bTime = b.dueDate ? Date.parse(b.dueDate) : 0;
        return aTime - bTime;
      });
  }, [tasks, nowMs]);

  const myOverdueTasks = useMemo(
    () => overdueTasks.filter((t) => t.assignedToAll || t.assigneeId === currentUserId),
    [overdueTasks, currentUserId],
  );

  // Enviar alerta toast automática cuando aparezcan tareas vencidas sin completar
  useEffect(() => {
    const newAlerts = overdueTasks.filter((t) => !alertedIdsRef.current.has(t.id));
    if (newAlerts.length === 0) return;

    for (const t of newAlerts) {
      alertedIdsRef.current.add(t.id);
    }

    const mineCount = newAlerts.filter((t) => t.assignedToAll || t.assigneeId === currentUserId).length;
    const firstTarget =
      newAlerts.find((t) => t.assignedToAll || t.assigneeId === currentUserId) ?? newAlerts[0];

    const message =
      mineCount > 0
        ? `Alerta: tienes ${mineCount} tarea${mineCount === 1 ? '' : 's'} vencida${mineCount === 1 ? '' : 's'} sin completar`
        : currentUserRole === 'LEADER'
          ? `Alerta de equipo: ${newAlerts.length} tarea${newAlerts.length === 1 ? '' : 's'} vencida${newAlerts.length === 1 ? '' : 's'} sin completar`
          : `Alerta: hay ${newAlerts.length} tarea${newAlerts.length === 1 ? '' : 's'} vencida${newAlerts.length === 1 ? '' : 's'} sin completar en el tablero`;

    toast.error(message, {
      duration: 7000,
      action: firstTarget
        ? {
            label: 'Ver tarea',
            onClick: () => onOpenTask(firstTarget.id),
          }
        : undefined,
    });
  }, [overdueTasks, currentUserId, currentUserRole, onOpenTask]);

  // Limpiar registro si una tarea vencida se completa o deja de estar vencida
  useEffect(() => {
    const activeIds = new Set(overdueTasks.map((t) => t.id));
    for (const id of Array.from(alertedIdsRef.current)) {
      if (!activeIds.has(id)) {
        alertedIdsRef.current.delete(id);
      }
    }
  }, [overdueTasks]);

  if (overdueTasks.length === 0) return null;

  return (
    <section
      role="alert"
      aria-live="polite"
      aria-label="Alerta de tareas sin completar vencidas"
      className="rounded-xl border border-rose-300/80 bg-rose-50/90 px-3 py-2 shadow-xs dark:border-rose-500/35 dark:bg-rose-950/35"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-600 dark:bg-rose-500/25 dark:text-rose-300">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-bold text-rose-900 dark:text-rose-200">
              Alerta: {overdueTasks.length} tarea{overdueTasks.length === 1 ? '' : 's'} sin completar fuera de fecha
              {myOverdueTasks.length > 0
                ? ` (${myOverdueTasks.length} asignada${myOverdueTasks.length === 1 ? '' : 's'} a ti)`
                : ''}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          className="inline-flex min-h-[30px] items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-900/40"
        >
          <span>{collapsed ? 'Ver detalle' : 'Ocultar'}</span>
          {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>
      </div>

      {!collapsed ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {overdueTasks.map((task) => {
            const isMine = task.assigneeId === currentUserId;
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpenTask(task.id)}
                className={`inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-left text-xs transition hover:shadow-xs ${
                  isMine
                    ? 'border-rose-400 bg-white text-rose-900 dark:border-rose-500/60 dark:bg-rose-950/70 dark:text-rose-100'
                    : 'border-rose-200 bg-white/85 text-slate-800 hover:bg-white dark:border-rose-500/30 dark:bg-slate-900/75 dark:text-slate-200'
                }`}
              >
                <Clock className="h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
                <span className="font-bold">{task.title}</span>
                <span className="text-[11px] text-rose-700 dark:text-rose-300">
                  ({TASK_STATUS_LABELS[task.status]} · {task.dueDate ? formatDueShort(task.dueDate) : ''})
                </span>
                {task.assignee ? (
                  <span className="rounded-md bg-rose-100/80 px-1.5 py-0.5 text-[11px] font-medium text-rose-800 dark:bg-rose-500/20 dark:text-rose-200">
                    {task.assignee.displayName}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
