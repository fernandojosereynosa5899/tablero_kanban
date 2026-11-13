import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Award,
  CalendarClock,
  CheckCircle2,
  CheckSquare,
  Edit3,
  Loader2,
  Lock,
  MessageSquare,
  Plus,
  Send,
  Square,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { api, ApiError } from '../../lib/api';
import type {
  AttachmentCreatedPayload,
  AttachmentDeletedPayload,
  CommentCreatedPayload,
  CommentDeletedPayload,
  CommentTypingPayload,
} from '../../lib/socket';
import {
  DEFAULT_POSTIT_COLOR,
  isTaskIncompleteOverdue,
  KANBAN_COLUMNS,
  PRIORITY_MAP,
  type AttachmentStorageStats,
  type Comment,
  type Task,
  type TaskAttachment,
  type TaskStatus,
} from '../../types/kanban';
import { RoleBadge, VectorAvatar } from '../avatars/VectorAvatar';
import { TaskAttachmentsSection } from './TaskAttachmentsSection';

interface TaskDetailModalProps {
  taskId: string | null;
  onClose: () => void;
  onEditTask: (task: Task) => void;
  onMoveTask: (task: Task, toStatus: TaskStatus) => Promise<boolean>;
}

function formatDateTimeEs(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function formatDateShortEs(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

function mergeComments(existing: Comment[], incoming: Comment[]): Comment[] {
  const byId = new Map<string, Comment>();
  for (const item of existing) {
    byId.set(item.id, item);
  }
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values()).sort((a, b) => {
    const timeDiff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });
}

function mergeAttachments(existing: TaskAttachment[], incoming: TaskAttachment[]): TaskAttachment[] {
  const byId = new Map<string, TaskAttachment>();
  for (const item of existing) {
    byId.set(item.id, item);
  }
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values()).sort((a, b) => {
    const timeDiff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (timeDiff !== 0) return timeDiff;
    return b.id.localeCompare(a.id);
  });
}

export function TaskDetailModal({
  taskId,
  onClose,
  onEditTask,
  onMoveTask,
}: TaskDetailModalProps) {
  const { user, tasks, setTasks, socket } = useAuth();

  const task = useMemo(
    () => (taskId ? tasks.find((t) => t.id === taskId) ?? null : null),
    [taskId, tasks],
  );

  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [storageStats, setStorageStats] = useState<AttachmentStorageStats | null>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<
    Record<string, { displayName: string; expiresAt: number }>
  >({});
  const lastTypingEmitRef = useRef<{ taskId: string; ts: number; active: boolean }>({
    taskId: '',
    ts: 0,
    active: false,
  });

  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [togglingSubtaskId, setTogglingSubtaskId] = useState<string | null>(null);
  const [deletingSubtaskId, setDeletingSubtaskId] = useState<string | null>(null);

  const [movingStatus, setMovingStatus] = useState<TaskStatus | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deletingTask, setDeletingTask] = useState(false);

  // Cerrar si la tarea fue eliminada en vivo mientras estaba abierta
  useEffect(() => {
    if (taskId && !task) {
      onClose();
    }
  }, [taskId, task, onClose]);

  // Cargar detalle, adjuntos y comentarios al abrir
  useEffect(() => {
    if (!taskId) {
      setComments([]);
      setAttachments([]);
      setTypingUsers({});
      return;
    }
    let active = true;
    setComments([]);
    setAttachments([]);
    setTypingUsers({});
    setLoadingComments(true);
    setConfirmDeleteOpen(false);
    setCommentDraft('');
    setNewSubtaskTitle('');

    api
      .getTask(taskId)
      .then((detail) => {
        if (!active) return;
        setComments((prev) => mergeComments(prev, detail.comments));
        setAttachments((prev) => mergeAttachments(prev, detail.attachments ?? []));
        // Sincronizar versión fresca sin perder orden
        const {
          comments: _ignoredComments,
          attachments: _ignoredAttachments,
          ...freshTask
        } = detail;
        setTasks((prev) => prev.map((t) => (t.id === freshTask.id ? freshTask : t)));
      })
      .catch((err) => {
        if (!active) return;
        const msg = err instanceof ApiError ? err.message : 'No se pudo cargar la tarea';
        toast.error(msg);
      })
      .finally(() => {
        if (active) setLoadingComments(false);
      });

    api
      .getAttachmentStorageStats()
      .then((stats) => {
        if (active) setStorageStats(stats);
      })
      .catch(() => {
        // Opcional: si falla la estadística no bloquea el detalle
      });

    return () => {
      active = false;
    };
  }, [taskId, setTasks]);

  // Escuchar comentarios y estado de escritura simultánea en tiempo real
  useEffect(() => {
    if (!socket || !taskId) return;

    const handleCreated = ({ taskId: evtTaskId, comment }: CommentCreatedPayload) => {
      if (evtTaskId !== taskId) return;
      setComments((prev) => mergeComments(prev, [comment]));
      setTypingUsers((prev) => {
        if (!(comment.author.id in prev)) return prev;
        const next = { ...prev };
        delete next[comment.author.id];
        return next;
      });
    };

    const handleDeleted = ({ taskId: evtTaskId, id }: CommentDeletedPayload) => {
      if (evtTaskId !== taskId) return;
      setComments((prev) => prev.filter((c) => c.id !== id));
    };

    const handleTyping = ({
      taskId: evtTaskId,
      userId,
      displayName,
      isTyping,
    }: CommentTypingPayload) => {
      if (evtTaskId !== taskId || userId === user?.id) return;
      setTypingUsers((prev) => {
        if (!isTyping) {
          if (!(userId in prev)) return prev;
          const next = { ...prev };
          delete next[userId];
          return next;
        }
        return {
          ...prev,
          [userId]: { displayName, expiresAt: Date.now() + 3600 },
        };
      });
    };

    const handleAttachmentCreated = ({ taskId: evtTaskId, attachment }: AttachmentCreatedPayload) => {
      if (evtTaskId !== taskId) return;
      setAttachments((prev) => mergeAttachments(prev, [attachment]));
    };

    const handleAttachmentDeleted = ({ taskId: evtTaskId, id }: AttachmentDeletedPayload) => {
      if (evtTaskId !== taskId) return;
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    };

    socket.on('comment:created', handleCreated);
    socket.on('comment:deleted', handleDeleted);
    socket.on('comment:typing', handleTyping);
    socket.on('attachment:created', handleAttachmentCreated);
    socket.on('attachment:deleted', handleAttachmentDeleted);

    const cleanupTimer = window.setInterval(() => {
      const now = Date.now();
      setTypingUsers((prev) => {
        const entries = Object.entries(prev);
        if (entries.length === 0) return prev;
        let changed = false;
        const next: typeof prev = {};
        for (const [uid, info] of entries) {
          if (info.expiresAt > now) {
            next[uid] = info;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);

    return () => {
      window.clearInterval(cleanupTimer);
      socket.off('comment:created', handleCreated);
      socket.off('comment:deleted', handleDeleted);
      socket.off('comment:typing', handleTyping);
      socket.off('attachment:created', handleAttachmentCreated);
      socket.off('attachment:deleted', handleAttachmentDeleted);
      if (lastTypingEmitRef.current.active && lastTypingEmitRef.current.taskId === taskId) {
        socket.emit('comment:typing', { taskId, isTyping: false });
        lastTypingEmitRef.current = { taskId: '', ts: 0, active: false };
      }
    };
  }, [socket, taskId, user?.id]);

  useEffect(() => {
    if (!taskId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [taskId, onClose]);

  if (!user) return null;

  const isLeader = user.role === 'LEADER';
  const canToggleSubtask =
    task !== null && (isLeader || task.assignedToAll || task.assigneeId === user.id);
  const canUploadAttachments =
    task !== null &&
    (isLeader ||
      ((user.role === 'SUBLEADER' || task.assignedToAll || task.assigneeId === user.id) &&
        task.status !== 'APPROVED'));
  const canMoveAny =
    task !== null &&
    (isLeader || ((task.assignedToAll || task.assigneeId === user.id) && task.status !== 'APPROVED'));

  const handleStatusChange = async (toStatus: TaskStatus) => {
    if (!task || task.status === toStatus) return;
    setMovingStatus(toStatus);
    try {
      await onMoveTask(task, toStatus);
    } finally {
      setMovingStatus(null);
    }
  };

  const handleToggleSubtask = async (subtaskId: string, currentDone: boolean) => {
    if (!task || !canToggleSubtask) return;
    setTogglingSubtaskId(subtaskId);

    // Actualización optimista inmediata
    const snapshot = task;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? {
              ...t,
              subtasks: t.subtasks.map((s) =>
                s.id === subtaskId ? { ...s, done: !currentDone } : s,
              ),
            }
          : t,
      ),
    );

    try {
      const updated = await api.updateSubtask(subtaskId, { done: !currentDone });
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      setTasks((prev) => prev.map((t) => (t.id === snapshot.id ? snapshot : t)));
      const msg = err instanceof ApiError ? err.message : 'No se pudo actualizar la subtarea';
      toast.error(msg);
    } finally {
      setTogglingSubtaskId(null);
    }
  };

  const handleAddSubtask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!task || !isLeader) return;
    const clean = newSubtaskTitle.trim();
    if (!clean) return;

    setAddingSubtask(true);
    try {
      const updated = await api.createSubtask(task.id, clean);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setNewSubtaskTitle('');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo agregar la subtarea';
      toast.error(msg);
    } finally {
      setAddingSubtask(false);
    }
  };

  const handleDeleteSubtask = async (subtaskId: string) => {
    if (!task || !isLeader) return;
    setDeletingSubtaskId(subtaskId);
    try {
      const updated = await api.deleteSubtask(subtaskId);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo eliminar la subtarea';
      toast.error(msg);
    } finally {
      setDeletingSubtaskId(null);
    }
  };

  const emitTypingStatus = (isTyping: boolean) => {
    if (!socket || !task) return;
    const now = Date.now();
    const last = lastTypingEmitRef.current;
    if (isTyping) {
      if (last.active && last.taskId === task.id && now - last.ts < 1500) {
        return;
      }
      lastTypingEmitRef.current = { taskId: task.id, ts: now, active: true };
      socket.emit('comment:typing', { taskId: task.id, isTyping: true });
    } else if (last.active && last.taskId === task.id) {
      lastTypingEmitRef.current = { taskId: '', ts: now, active: false };
      socket.emit('comment:typing', { taskId: task.id, isTyping: false });
    }
  };

  const handlePostComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!task) return;
    const clean = commentDraft.trim();
    if (!clean) return;

    emitTypingStatus(false);
    setPostingComment(true);
    try {
      const created = await api.createComment(task.id, clean);
      setComments((prev) => mergeComments(prev, [created]));
      setCommentDraft('');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo publicar el comentario';
      toast.error(msg);
    } finally {
      setPostingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    setDeletingCommentId(commentId);
    try {
      await api.deleteComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo eliminar el comentario';
      toast.error(msg);
    } finally {
      setDeletingCommentId(null);
    }
  };

  const handleDeleteTask = async () => {
    if (!task || !isLeader) return;
    setDeletingTask(true);
    try {
      await api.deleteTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      toast.success('Actividad eliminada');
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo eliminar la actividad';
      toast.error(msg);
    } finally {
      setDeletingTask(false);
    }
  };

  const postItColor = task?.color || DEFAULT_POSTIT_COLOR;
  const priorityMeta = task ? PRIORITY_MAP[task.priority] : null;
  const doneSubtasks = task ? task.subtasks.filter((s) => s.done).length : 0;
  const totalSubtasks = task ? task.subtasks.length : 0;
  const activeTypingNames = Object.values(typingUsers)
    .filter((t) => t.expiresAt > Date.now())
    .map((t) => t.displayName);
  const isOverdue =
    task?.dueDate &&
    new Date(task.dueDate).getTime() < Date.now() &&
    task.status !== 'APPROVED';

  return (
    <AnimatePresence>
      {taskId && task ? (
        <motion.div
          key="task-detail-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6 backdrop-blur-xs"
          onClick={onClose}
        >
          <motion.div
            key="task-detail-dialog"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-detail-title"
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            {/* Banda superior del color post-it */}
            <div style={{ backgroundColor: postItColor }} className="h-2.5 w-full shrink-0" />

            {/* Cabecera */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-7 sm:py-4 dark:border-slate-800">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  {priorityMeta ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${priorityMeta.badgeClass}`}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: priorityMeta.color }}
                      />
                      Prioridad {priorityMeta.label}
                    </span>
                  ) : null}

                  {task.status === 'APPROVED' && task.approvedAt ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
                      <Award className="h-3.5 w-3.5" />
                      Aprobada el {formatDateShortEs(task.approvedAt)}
                    </span>
                  ) : null}

                  {isTaskIncompleteOverdue(task) ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-bold text-rose-800 ring-1 ring-rose-300/80 dark:bg-rose-500/25 dark:text-rose-200 dark:ring-rose-500/40">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Vencida sin completar
                    </span>
                  ) : null}
                </div>

                <h2
                  id="task-detail-title"
                  className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white leading-snug"
                >
                  {task.title}
                </h2>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {isLeader ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onEditTask(task)}
                      title="Editar actividad"
                      className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Editar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteOpen((p) => !p)}
                      title="Eliminar actividad"
                      className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Eliminar</span>
                    </button>
                  </>
                ) : null}

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Cerrar detalle"
                  className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Confirmación inline de eliminación (solo líder) */}
            {confirmDeleteOpen && isLeader ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-5 py-3 sm:px-7 dark:border-red-900/60 dark:bg-red-950/40">
                <p className="text-xs sm:text-sm font-semibold text-red-800 dark:text-red-200">
                  ¿Eliminar permanentemente esta actividad, sus subtareas y comentarios?
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteOpen(false)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={deletingTask}
                    onClick={handleDeleteTask}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-65"
                  >
                    {deletingTask ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Confirmar eliminación
                  </button>
                </div>
              </div>
            ) : null}

            {/* Cuerpo scrollable */}
            <div className="overflow-y-auto p-4 sm:p-7 space-y-5 sm:space-y-6">
              {/* Barra de estado / columnas rápidas + botón destacado Aprobar */}
              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5 sm:p-4 dark:border-slate-800 dark:bg-slate-800/40 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    Estado en el flujo Kanban
                  </span>

                  {isLeader && task.status === 'DONE' ? (
                    <button
                      type="button"
                      disabled={movingStatus !== null}
                      onClick={() => void handleStatusChange('APPROVED')}
                      className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-[#2E9E5B] px-4 py-2 text-xs sm:text-sm font-bold text-white shadow-md shadow-emerald-600/25 transition hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-65"
                    >
                      {movingStatus === 'APPROVED' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Award className="h-4 w-4" />
                      )}
                      Aprobar tarea
                    </button>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {KANBAN_COLUMNS.map((col) => {
                    const isCurrent = task.status === col.status;
                    const disabled =
                      movingStatus !== null ||
                      isCurrent ||
                      !canMoveAny ||
                      (!isLeader && col.status === 'APPROVED');

                    return (
                      <button
                        key={col.status}
                        type="button"
                        disabled={disabled}
                        title={
                          !isLeader && col.status === 'APPROVED'
                            ? 'Solo el líder puede aprobar tareas'
                            : !canMoveAny
                              ? 'Solo el responsable asignado o el líder pueden cambiar el estado'
                              : undefined
                        }
                        onClick={() => void handleStatusChange(col.status)}
                        style={
                          isCurrent
                            ? {
                                backgroundColor: col.color,
                                borderColor: col.color,
                              }
                            : undefined
                        }
                        className={`flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                          isCurrent
                            ? 'text-white shadow-sm'
                            : disabled
                              ? 'cursor-not-allowed border-slate-200/70 bg-slate-100/70 text-slate-400 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-600'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                        }`}
                      >
                        {movingStatus === col.status ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : !isLeader && col.status === 'APPROVED' ? (
                          <Lock className="h-3 w-3" />
                        ) : (
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: isCurrent ? '#FFFFFF' : col.color }}
                          />
                        )}
                        <span className="truncate">{col.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Metadatos: Responsable & Fecha */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
                  {task.assignedToAll ? (
                    <>
                      <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
                        <Users className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          Responsable
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold leading-snug text-indigo-700 dark:text-indigo-200">
                            Todo el equipo (Todos)
                          </span>
                        </div>
                      </div>
                    </>
                  ) : task.assignee ? (
                    <>
                      <VectorAvatar avatar={task.assignee.avatar} size={42} />
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          Responsable
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold leading-snug text-slate-900 dark:text-white">
                            {task.assignee.displayName}
                          </span>
                          <RoleBadge role={task.assignee.role} size="sm" />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="py-1">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Responsable
                      </p>
                      <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                        Sin asignar
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      isOverdue
                        ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300'
                        : 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300'
                    }`}
                  >
                    <CalendarClock className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Fecha límite
                    </p>
                    <p
                      className={`text-sm font-bold ${
                        isOverdue
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {task.dueDate
                        ? `${formatDateShortEs(task.dueDate)}${isOverdue ? ' (Vencida)' : ''}`
                        : 'Sin fecha límite'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Descripción */}
              <div>
                <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Descripción
                </h3>
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-200">
                  {task.description ? (
                    task.description
                  ) : (
                    <span className="italic text-slate-400 dark:text-slate-500">
                      Sin descripción adicional.
                    </span>
                  )}
                </div>
              </div>

              {/* Subtareas interactivas */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      Subtareas ({doneSubtasks}/{totalSubtasks})
                    </h3>
                  </div>
                  {!canToggleSubtask && totalSubtasks > 0 ? (
                    <span className="text-[11px] text-slate-400">
                      Solo el responsable o el líder pueden marcarlas
                    </span>
                  ) : null}
                </div>

                {totalSubtasks > 0 ? (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                      style={{
                        width: `${Math.round((doneSubtasks / totalSubtasks) * 100)}%`,
                      }}
                    />
                  </div>
                ) : null}

                {task.subtasks.length === 0 ? (
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    No hay subtareas registradas en esta actividad.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {task.subtasks.map((sub) => {
                      const isToggling = togglingSubtaskId === sub.id;
                      const isDeleting = deletingSubtaskId === sub.id;
                      return (
                        <li
                          key={sub.id}
                          className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-900"
                        >
                          <button
                            type="button"
                            disabled={!canToggleSubtask || isToggling}
                            onClick={() => void handleToggleSubtask(sub.id, sub.done)}
                            className={`flex flex-1 items-center gap-3 text-left text-sm transition ${
                              canToggleSubtask ? 'cursor-pointer' : 'cursor-default'
                            }`}
                          >
                            {isToggling ? (
                              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
                            ) : sub.done ? (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                            ) : (
                              <Square className="h-4 w-4 shrink-0 text-slate-400" />
                            )}
                            <span
                              className={
                                sub.done
                                  ? 'line-through text-slate-400 dark:text-slate-500'
                                  : 'font-medium text-slate-800 dark:text-slate-100'
                              }
                            >
                              {sub.title}
                            </span>
                          </button>

                          {isLeader ? (
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => void handleDeleteSubtask(sub.id)}
                              aria-label={`Eliminar subtarea ${sub.title}`}
                              className="rounded-lg p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                            >
                              {isDeleting ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {isLeader ? (
                  <form onSubmit={handleAddSubtask} className="flex gap-2 pt-1">
                    <input
                      type="text"
                      value={newSubtaskTitle}
                      onChange={(e) => setNewSubtaskTitle(e.target.value)}
                      maxLength={200}
                      placeholder="Agregar nueva subtarea..."
                      aria-label="Nueva subtarea"
                      className="min-h-[40px] min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs sm:text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <button
                      type="submit"
                      disabled={addingSubtask || !newSubtaskTitle.trim()}
                      className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600"
                    >
                      {addingSubtask ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      Agregar
                    </button>
                  </form>
                ) : null}
              </div>

              {/* Archivos adjuntos */}
              <TaskAttachmentsSection
                task={task}
                attachments={attachments}
                loading={loadingComments}
                storageStats={storageStats}
                canUpload={canUploadAttachments}
                isLeader={isLeader}
                currentUserId={user.id}
                onAttachmentAdded={(created) => {
                  setAttachments((prev) => mergeAttachments(prev, [created]));
                }}
                onAttachmentRemoved={(removedId) => {
                  setAttachments((prev) => prev.filter((a) => a.id !== removedId));
                }}
                onStorageStatsRefresh={() => {
                  api
                    .getAttachmentStorageStats()
                    .then((stats) => setStorageStats(stats))
                    .catch(() => {});
                }}
              />

              {/* Comentarios en tiempo real */}
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    Comentarios ({comments.length})
                  </h3>
                </div>

                {loadingComments ? (
                  <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                    Cargando comentarios...
                  </div>
                ) : comments.length === 0 ? (
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Aún no hay comentarios. ¡Sé el primero en dejar una nota!
                  </p>
                ) : (
                  <ul className="space-y-2.5">
                    {comments.map((comment) => {
                      const canDeleteComment = isLeader || comment.author.id === user.id;
                      const isDeleting = deletingCommentId === comment.id;
                      return (
                        <li
                          key={comment.id}
                          className="flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40"
                        >
                          <VectorAvatar avatar={comment.author.avatar} size={32} />
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2 min-w-0">
                                <span className="text-xs font-bold leading-snug text-slate-900 dark:text-white">
                                  {comment.author.displayName}
                                </span>
                                <span className="text-[11px] text-slate-400">
                                  {formatDateTimeEs(comment.createdAt)}
                                </span>
                              </div>

                              {canDeleteComment ? (
                                <button
                                  type="button"
                                  disabled={isDeleting}
                                  onClick={() => void handleDeleteComment(comment.id)}
                                  aria-label="Eliminar comentario"
                                  className="rounded-lg p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                                >
                                  {isDeleting ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs sm:text-sm leading-relaxed text-slate-700 whitespace-pre-wrap dark:text-slate-200">
                              {comment.content}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* Indicador de escritura simultánea en tiempo real */}
                {activeTypingNames.length > 0 ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-2 rounded-xl bg-blue-50/80 px-3 py-1.5 text-xs font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
                  >
                    <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse shrink-0" />
                    <span>
                      {activeTypingNames.join(', ')}{' '}
                      {activeTypingNames.length === 1
                        ? 'está escribiendo un comentario...'
                        : 'están escribiendo comentarios...'}
                    </span>
                  </div>
                ) : null}

                {/* Publicar comentario */}
                <form onSubmit={handlePostComment} className="flex items-start gap-2.5 pt-1">
                  <VectorAvatar avatar={user.avatar} size={34} className="mt-0.5 hidden sm:block" />
                  <div className="flex min-w-0 flex-1 gap-2">
                    <input
                      type="text"
                      value={commentDraft}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCommentDraft(val);
                        emitTypingStatus(val.trim().length > 0);
                      }}
                      onBlur={() => emitTypingStatus(false)}
                      maxLength={1000}
                      placeholder="Escribe un comentario en tiempo real para todo el equipo..."
                      aria-label="Nuevo comentario"
                      className="min-h-[42px] min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <button
                      type="submit"
                      disabled={postingComment || !commentDraft.trim()}
                      className="inline-flex min-h-[42px] shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-55"
                    >
                      {postingComment ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      <span className="hidden sm:inline">Enviar</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
