import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  CalendarClock,
  CheckSquare,
  GripVertical,
  Lock,
  MessageSquare,
  Paperclip,
  Users,
} from 'lucide-react';
import {
  DEFAULT_POSTIT_COLOR,
  isTaskIncompleteOverdue,
  KANBAN_COLUMNS,
  PRIORITY_MAP,
  type Role,
  type Task,
  type TaskStatus,
} from '../../types/kanban';
import { VectorAvatar } from '../avatars/VectorAvatar';

interface TaskCardProps {
  task: Task;
  currentUserId: string;
  currentUserRole: Role;
  onOpenDetail: (task: Task) => void;
  onQuickMove?: (task: Task, toStatus: TaskStatus) => void;
  isOverlay?: boolean;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `rgba(255, 245, 157, ${alpha})`;
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatDueDate(iso: string): { label: string; isOverdue: boolean } {
  const date = new Date(iso);
  const now = new Date();
  const isOverdue = date.getTime() < now.getTime();
  const label = new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
  return { label, isOverdue };
}

export function canUserMoveTask(task: Task, userId: string, role: Role): boolean {
  if (role === 'LEADER') return true;
  return (task.assignedToAll || task.assigneeId === userId) && task.status !== 'APPROVED';
}

export function TaskCard({
  task,
  currentUserId,
  currentUserRole,
  onOpenDetail,
  onQuickMove,
  isOverlay = false,
}: TaskCardProps) {
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const moveMenuRef = useRef<HTMLDivElement | null>(null);

  const canMove = canUserMoveTask(task, currentUserId, currentUserRole);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: {
      type: 'task',
      task,
    },
    disabled: isOverlay || !canMove,
  });

  useEffect(() => {
    if (!moveMenuOpen) return;
    const handleOutside = (event: MouseEvent) => {
      if (moveMenuRef.current && !moveMenuRef.current.contains(event.target as Node)) {
        setMoveMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [moveMenuOpen]);

  const style: CSSProperties | undefined = isOverlay
    ? undefined
    : {
        transform: CSS.Transform.toString(transform),
        transition,
      };

  const postItColor = task.color || DEFAULT_POSTIT_COLOR;
  const priorityMeta = PRIORITY_MAP[task.priority];

  const subtaskStats = useMemo(() => {
    const total = task.subtasks.length;
    const done = task.subtasks.filter((s) => s.done).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, pct };
  }, [task.subtasks]);

  const dueInfo = useMemo(() => {
    if (!task.dueDate) return null;
    const { label, isOverdue } = formatDueDate(task.dueDate);
    return {
      label,
      isOverdue: isOverdue && task.status !== 'APPROVED',
    };
  }, [task.dueDate, task.status]);

  const permittedTargets = useMemo(() => {
    return KANBAN_COLUMNS.filter((col) => {
      if (col.status === task.status) return false;
      if (currentUserRole !== 'LEADER' && col.status === 'APPROVED') return false;
      return true;
    });
  }, [task.status, currentUserRole]);

  const isLocked =
    task.status === 'APPROVED' ||
    (currentUserRole !== 'LEADER' && !task.assignedToAll && task.assigneeId !== currentUserId);

  return (
    <article
      ref={isOverlay ? undefined : setNodeRef}
      style={style}
      {...(isOverlay ? {} : attributes)}
      {...(isOverlay ? {} : listeners)}
      onClick={() => {
        if (!isDragging && !isOverlay) {
          onOpenDetail(task);
        }
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          onOpenDetail(task);
        }
      }}
      tabIndex={isOverlay ? -1 : 0}
      aria-label={`Tarea ${task.title}. Prioridad ${priorityMeta.label}`}
      className={`group relative flex flex-col overflow-visible rounded-xl border bg-white text-left transition-shadow focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-[#212329] ${
        moveMenuOpen ? 'z-30' : 'z-0'
      } ${
        isOverlay
          ? 'rotate-1 scale-[1.02] cursor-grabbing border-blue-500 shadow-xl'
          : isDragging
            ? 'opacity-35 border-dashed border-zinc-400 shadow-none dark:border-zinc-600'
            : canMove
              ? 'touch-pan-y cursor-grab active:cursor-grabbing border-zinc-200/90 shadow-xs hover:shadow-md dark:border-zinc-700/80'
              : 'cursor-pointer border-zinc-200/80 shadow-xs hover:shadow-md dark:border-zinc-800'
      }`}
    >
      {/* Capa sutil estilo post-it (primera versión) */}
      <div
        aria-hidden="true"
        style={{ backgroundColor: hexToRgba(postItColor, 0.34) }}
        className="pointer-events-none absolute inset-0 rounded-xl dark:opacity-15"
      />

      {/* Franja superior tipo nota adhesiva */}
      <div
        aria-hidden="true"
        style={{ backgroundColor: postItColor }}
        className="relative h-2 w-full rounded-t-xl border-b border-black/5 dark:border-white/10"
      />

      <div className="relative flex flex-col gap-2.5 p-3.5">
        {/* Fila superior: prioridad, candado/arrastre y menú rápido */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${priorityMeta.badgeClass}`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: priorityMeta.color }}
              />
              {priorityMeta.label}
            </span>

            {isLocked ? (
              <span
                title={
                  task.status === 'APPROVED'
                    ? 'Tarea aprobada y bloqueada para integrantes'
                    : 'Solo el responsable asignado o el líder pueden mover esta tarjeta'
                }
                className="inline-flex items-center gap-0.5 rounded-full bg-slate-900/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-white/10 dark:text-slate-300"
              >
                <Lock className="h-2.5 w-2.5" />
                {task.status === 'APPROVED' ? 'Aprobada' : 'Solo lectura'}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-1">
            {canMove && onQuickMove && !isOverlay ? (
              <div
                ref={moveMenuRef}
                className="relative"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => setMoveMenuOpen((prev) => !prev)}
                  title="Mover de columna"
                  aria-label="Mover tarea a otra columna"
                  aria-expanded={moveMenuOpen}
                  className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-xl p-1.5 text-slate-500 transition hover:bg-black/10 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <ArrowRightLeft className="h-4 w-4" />
                </button>

                {moveMenuOpen ? (
                  <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                    <p className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Mover a:
                    </p>
                    {permittedTargets.map((col) => (
                      <button
                        key={col.status}
                        type="button"
                        onClick={() => {
                          setMoveMenuOpen(false);
                          onQuickMove(task, col.status);
                        }}
                        className="flex min-h-[40px] w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: col.color }}
                        />
                        <span className="truncate">{col.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {canMove ? (
              <GripVertical
                aria-hidden="true"
                className="h-4 w-4 text-slate-400/80 opacity-70 transition group-hover:opacity-100 dark:text-slate-500"
              />
            ) : null}
          </div>
        </div>

        {/* Título y extracto de descripción */}
        <div>
          <h4 className="text-sm font-bold leading-snug text-slate-900 dark:text-slate-50 line-clamp-2">
            {task.title}
          </h4>
          {task.description ? (
            <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300 line-clamp-2">
              {task.description}
            </p>
          ) : null}
        </div>

        {/* Progreso de subtareas */}
        {subtaskStats.total > 0 ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-600 dark:text-slate-300">
              <span className="inline-flex items-center gap-1">
                <CheckSquare className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Subtareas
              </span>
              <span className="font-bold">
                {subtaskStats.done}/{subtaskStats.total}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${subtaskStats.pct}%` }}
              />
            </div>
          </div>
        ) : null}

        {/* Pie: fecha límite + alerta sin completar + comentarios + responsable completo */}
        <div className="mt-0.5 space-y-2 pt-2 border-t border-black/10 dark:border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              {dueInfo ? (
                <span
                  title={dueInfo.isOverdue ? 'Fecha límite vencida' : 'Fecha límite'}
                  className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] font-semibold ${
                    dueInfo.isOverdue
                      ? 'bg-red-100 text-red-700 ring-1 ring-red-300/70 dark:bg-red-500/20 dark:text-red-300 dark:ring-red-500/40'
                      : 'bg-white/75 text-slate-700 dark:bg-slate-800/90 dark:text-slate-300'
                  }`}
                >
                  <CalendarClock className="h-3 w-3 shrink-0" />
                  {dueInfo.label}
                </span>
              ) : null}

              {isTaskIncompleteOverdue(task) ? (
                <span
                  title="Esta tarea venció y aún no ha sido completada"
                  className="inline-flex items-center gap-1 rounded-lg bg-rose-600/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-500/35 dark:bg-rose-500/25 dark:text-rose-200"
                >
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  ¡Sin completar!
                </span>
              ) : null}
            </div>

            <span
              title={`${task.commentCount} comentarios`}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {task.commentCount}
            </span>
            {task.attachmentCount > 0 ? (
              <span
                title={`${task.attachmentCount} ${task.attachmentCount === 1 ? 'archivo adjunto' : 'archivos adjuntos'}`}
                className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-400/15 dark:text-blue-300"
              >
                <Paperclip className="h-3 w-3" />
                {task.attachmentCount}
              </span>
            ) : null}
          </div>

          {task.assignedToAll ? (
            <div
              className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100/90 px-2.5 py-0.5 text-[11px] font-bold text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200"
              title="Asignada a todo el equipo (6 personas)"
            >
              <Users className="h-3.5 w-3.5 shrink-0" />
              <span>Todo el equipo</span>
            </div>
          ) : task.assignee ? (
            <div
              className="flex items-center gap-2 min-w-0"
              title={`Responsable: ${task.assignee.displayName}`}
            >
              <VectorAvatar
                avatar={task.assignee.avatar}
                size={24}
                className="shrink-0 ring-2 ring-white dark:ring-slate-800"
              />
              <span className="text-[11px] font-semibold leading-tight text-slate-700 dark:text-slate-200 break-words">
                {task.assignee.displayName}
              </span>
            </div>
          ) : (
            <span className="inline-block rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              Sin asignar
            </span>
          )}

          {/* Botones directos de movimiento en móvil (< md) para mover en 1 toque sin arrastrar */}
          {canMove && onQuickMove && !isOverlay && permittedTargets.length > 0 ? (
            <div
              className="md:hidden pt-1.5 border-t border-black/5 dark:border-white/5"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Mover a:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {permittedTargets.map((col) => (
                  <button
                    key={col.status}
                    type="button"
                    onClick={() => onQuickMove(task, col.status)}
                    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border border-slate-300/80 bg-white/85 px-2.5 py-1 text-[11px] font-bold text-slate-800 shadow-2xs transition active:scale-95 dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-100"
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: col.color }}
                    />
                    <span>{col.label}</span>
                    <ArrowRight className="h-3 w-3 opacity-60" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
