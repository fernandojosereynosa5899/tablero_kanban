import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Calendar, Check, Loader2, Plus, Save, StickyNote, Trash2, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { api, ApiError } from '../../lib/api';
import {
  DEFAULT_POSTIT_COLOR,
  getRoleLabel,
  KANBAN_COLUMNS,
  POSTIT_COLORS,
  PRIORITY_OPTIONS,
  PROJECT_DATE_MAX,
  PROJECT_DATE_MIN,
  type Priority,
  type Task,
  type TaskStatus,
} from '../../types/kanban';
import { VectorAvatar } from '../avatars/VectorAvatar';

interface TaskFormModalProps {
  open: boolean;
  task: Task | null; // null = crear, Task = editar
  initialStatus?: TaskStatus;
  onClose: () => void;
}

type TaskFormFieldErrorKey =
  | 'title'
  | 'description'
  | 'priority'
  | 'dueDate'
  | 'assigneeId'
  | 'status'
  | 'subtasks';

const FIELD_INPUT_IDS: Array<[TaskFormFieldErrorKey, string]> = [
  ['title', 'task-title-input'],
  ['description', 'task-desc-input'],
  ['priority', 'task-priority-select'],
  ['dueDate', 'task-due-input'],
  ['assigneeId', 'task-assignee-select'],
  ['status', 'task-status-select'],
  ['subtasks', 'initial-subtask-input'],
];

function fieldBorderClasses(hasError: boolean): string {
  return hasError
    ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20 dark:border-rose-500'
    : 'border-slate-300 focus:border-blue-500 focus:ring-blue-500/15 dark:border-slate-700';
}

function RequiredMark({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="ml-0.5 text-rose-500 dark:text-rose-400" aria-hidden="true">
      *
    </span>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">
      {message}
    </p>
  );
}

function isoToDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateInputToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(`${trimmed}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function TaskFormModal({
  open,
  task,
  initialStatus = 'TODO',
  onClose,
}: TaskFormModalProps) {
  const { user, users, setTasks } = useAuth();
  const isLeader = user?.role === 'LEADER';
  const isEditing = isLeader && task !== null;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [status, setStatus] = useState<TaskStatus | ''>('TODO');
  const [color, setColor] = useState<string>(DEFAULT_POSTIT_COLOR);

  // Subtareas iniciales al crear
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const [initialSubtasks, setInitialSubtasks] = useState<string[]>([]);
  const [errors, setErrors] = useState<Partial<Record<TaskFormFieldErrorKey, string>>>({});
  const [saving, setSaving] = useState(false);

  const clearFieldError = (field: TaskFormFieldErrorKey) => {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (isLeader && task) {
      setTitle(task.title);
      setDescription(task.description);
      setPriority(task.priority);
      setDueDate(isoToDateInput(task.dueDate));
      setAssigneeId(task.assignedToAll ? '__ALL__' : (task.assigneeId ?? ''));
      setStatus(task.status);
      setColor(task.color || DEFAULT_POSTIT_COLOR);
      setInitialSubtasks([]);
      setSubtaskDraft('');
    } else {
      const safeInitial = !isLeader && initialStatus === 'APPROVED' ? 'TODO' : initialStatus;
      setTitle('');
      setDescription('');
      setPriority('');
      setDueDate('');
      setAssigneeId('');
      setStatus(safeInitial);
      setColor(DEFAULT_POSTIT_COLOR);
      setInitialSubtasks([]);
      setSubtaskDraft('');
    }
  }, [open, task, initialStatus, isLeader]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const handleAddInitialSubtask = () => {
    const clean = subtaskDraft.trim();
    if (!clean) {
      setErrors((prev) => ({
        ...prev,
        subtasks: 'Escribe el texto de la subtarea antes de agregarla.',
      }));
      return;
    }
    if (clean.length > 200) {
      toast.error('La subtarea no puede superar 200 caracteres.');
      return;
    }
    if (initialSubtasks.length >= 20) {
      toast.error('Máximo 20 subtareas iniciales.');
      return;
    }
    setInitialSubtasks((prev) => [...prev, clean]);
    setSubtaskDraft('');
    clearFieldError('subtasks');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanTitle = title.trim();

    if (isEditing && task) {
      const editErrors: Partial<Record<TaskFormFieldErrorKey, string>> = {};
      if (!cleanTitle) {
        editErrors.title = 'El título de la actividad es obligatorio.';
      }
      if (!priority) {
        editErrors.priority = 'Selecciona una prioridad.';
      }
      if (dueDate && (dueDate < PROJECT_DATE_MIN || dueDate > PROJECT_DATE_MAX)) {
        editErrors.dueDate = 'Solo se pueden asignar tareas entre el 07/11/2026 y el 19/12/2026.';
      }
      if (Object.keys(editErrors).length > 0) {
        setErrors(editErrors);
        const firstMsg = Object.values(editErrors)[0];
        if (firstMsg) toast.error(firstMsg);
        return;
      }

      setSaving(true);
      try {
        const normalizedDueDate = dateInputToIso(dueDate);
        const assignToAll = assigneeId === '__ALL__';
        const normalizedAssignee = assignToAll ? null : assigneeId ? assigneeId : null;
        const updated = await api.updateTask(task.id, {
          title: cleanTitle,
          description: description.trim(),
          priority: priority as Priority,
          dueDate: normalizedDueDate,
          assigneeId: normalizedAssignee,
          assignedToAll: assignToAll,
          color,
        });
        setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        toast.success('Actividad actualizada');
        onClose();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'No se pudo guardar la actividad';
        toast.error(msg);
      } finally {
        setSaving(false);
      }
      return;
    }

    // Validación estricta para crear actividad: todos los 7 requerimientos obligatorios
    const nextErrors: Partial<Record<TaskFormFieldErrorKey, string>> = {};
    const cleanDescription = description.trim();
    const normalizedDueDate = dateInputToIso(dueDate);

    if (!cleanTitle) {
      nextErrors.title = 'El título de la actividad es obligatorio.';
    }
    if (!cleanDescription) {
      nextErrors.description = 'La descripción de la actividad es obligatoria.';
    }
    if (!priority) {
      nextErrors.priority = 'Selecciona una prioridad para la actividad.';
    }
    if (!dueDate || !normalizedDueDate) {
      nextErrors.dueDate = 'La fecha límite es obligatoria.';
    } else if (dueDate < PROJECT_DATE_MIN || dueDate > PROJECT_DATE_MAX) {
      nextErrors.dueDate = 'Solo se pueden asignar fechas entre el 07/11/2026 y el 19/12/2026.';
    }
    if (!assigneeId) {
      nextErrors.assigneeId = 'Selecciona un responsable o Todo el equipo.';
    }
    if (!status) {
      nextErrors.status = 'Selecciona una columna inicial.';
    }

    let effectiveSubtasks = [...initialSubtasks];
    const draftSubtask = subtaskDraft.trim();
    if (draftSubtask.length > 200) {
      nextErrors.subtasks = 'La subtarea no puede superar 200 caracteres.';
    } else if (draftSubtask.length > 0) {
      if (effectiveSubtasks.length >= 20) {
        nextErrors.subtasks = 'Máximo 20 subtareas iniciales.';
      } else {
        effectiveSubtasks = [...effectiveSubtasks, draftSubtask];
        setInitialSubtasks(effectiveSubtasks);
        setSubtaskDraft('');
      }
    }

    if (!nextErrors.subtasks && effectiveSubtasks.length === 0) {
      nextErrors.subtasks = 'Debes agregar al menos una subtarea inicial.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      const firstInvalid = FIELD_INPUT_IDS.find(([key]) => Boolean(nextErrors[key]));
      if (firstInvalid) {
        document.getElementById(firstInvalid[1])?.focus();
      }
      const errorList = Object.values(nextErrors).filter(Boolean);
      toast.error(
        errorList.length === 1
          ? errorList[0]
          : `Completa todos los campos obligatorios con * (faltan ${errorList.length}).`,
      );
      return;
    }

    setErrors({});
    setSaving(true);
    try {
      const assignToAll = assigneeId === '__ALL__';
      const normalizedAssignee = assignToAll ? null : assigneeId;
      const created = await api.createTask({
        title: cleanTitle,
        description: cleanDescription,
        priority: priority as Priority,
        dueDate: normalizedDueDate!,
        assigneeId: normalizedAssignee,
        assignedToAll: assignToAll,
        color,
        status: status as TaskStatus,
        subtasks: effectiveSubtasks,
      });
      setTasks((prev) => {
        if (prev.some((t) => t.id === created.id)) return prev;
        return [...prev, created];
      });
      toast.success('Actividad creada correctamente');
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo guardar la actividad';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="task-form-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6 backdrop-blur-xs"
          onClick={onClose}
        >
          <motion.div
            key="task-form-dialog"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-form-title"
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            {/* Cabecera */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-7 sm:py-4 dark:border-slate-800">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  style={{ backgroundColor: color }}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-900 shadow-xs ring-1 ring-black/10"
                >
                  <StickyNote className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="task-form-title"
                    className="text-lg font-bold text-slate-900 dark:text-white truncate"
                  >
                    {isEditing ? 'Editar Actividad' : 'Nueva Actividad'}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {isEditing
                      ? 'Actualiza los detalles, prioridad o responsable de la tarjeta'
                      : 'Completa los campos obligatorios (*) y agrega al menos una subtarea'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar modal"
                className="inline-flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Formulario */}
            <form onSubmit={handleSubmit} noValidate className="overflow-y-auto p-4 sm:p-7 space-y-4 sm:space-y-5">
              <div>
                <label
                  htmlFor="task-title-input"
                  className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300"
                >
                  Título
                  <RequiredMark show />
                </label>
                <input
                  id="task-title-input"
                  type="text"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (e.target.value.trim()) clearFieldError('title');
                  }}
                  maxLength={140}
                  required
                  aria-required="true"
                  aria-invalid={Boolean(errors.title)}
                  placeholder="Ej. Diseñar pantalla de reportes mensuales"
                  className={`w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:ring-4 dark:bg-slate-800 dark:text-white ${fieldBorderClasses(Boolean(errors.title))}`}
                />
                <FieldError message={errors.title} />
              </div>

              <div>
                <label
                  htmlFor="task-desc-input"
                  className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300"
                >
                  Descripción
                  <RequiredMark show={!isEditing} />
                </label>
                <textarea
                  id="task-desc-input"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    if (e.target.value.trim()) clearFieldError('description');
                  }}
                  maxLength={4000}
                  rows={3}
                  required={!isEditing}
                  aria-required={!isEditing}
                  aria-invalid={Boolean(errors.description)}
                  placeholder="Describe los criterios de aceptación o contexto para el equipo..."
                  className={`w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:ring-4 dark:bg-slate-800 dark:text-white ${fieldBorderClasses(Boolean(errors.description))}`}
                />
                <FieldError message={errors.description} />
              </div>

              {/* Prioridad y Fecha límite */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <label
                    htmlFor="task-priority-select"
                    className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300"
                  >
                    Prioridad
                    <RequiredMark show={!isEditing} />
                  </label>
                  <select
                    id="task-priority-select"
                    value={priority}
                    onChange={(e) => {
                      setPriority(e.target.value as Priority | '');
                      if (e.target.value) clearFieldError('priority');
                    }}
                    required={!isEditing}
                    aria-required={!isEditing}
                    aria-invalid={Boolean(errors.priority)}
                    className={`w-full min-w-0 rounded-xl border bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none focus:ring-4 dark:bg-slate-800 dark:text-white ${fieldBorderClasses(Boolean(errors.priority))}`}
                  >
                    {!isEditing ? (
                      <option value="" disabled>
                        Selecciona prioridad...
                      </option>
                    ) : null}
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <FieldError message={errors.priority} />
                </div>

                <div className="min-w-0">
                  <label
                    htmlFor="task-due-input"
                    className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300"
                  >
                    Fecha límite
                    <RequiredMark show={!isEditing} />
                  </label>
                  <div className="relative flex min-w-0 items-center gap-2">
                    <div className="relative min-w-0 flex-1">
                      <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        id="task-due-input"
                        type="date"
                        min={PROJECT_DATE_MIN}
                        max={PROJECT_DATE_MAX}
                        value={dueDate}
                        onChange={(e) => {
                          setDueDate(e.target.value);
                          if (e.target.value) clearFieldError('dueDate');
                        }}
                        required={!isEditing}
                        aria-required={!isEditing}
                        aria-invalid={Boolean(errors.dueDate)}
                        className={`w-full min-w-0 rounded-xl border bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none focus:ring-4 dark:bg-slate-800 dark:text-white ${fieldBorderClasses(Boolean(errors.dueDate))}`}
                      />
                    </div>
                    {isEditing && dueDate ? (
                      <button
                        type="button"
                        onClick={() => setDueDate('')}
                        title="Quitar fecha límite"
                        className="shrink-0 rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Periodo permitido: 07/11/2026 al 19/12/2026
                  </p>
                  <FieldError message={errors.dueDate} />
                </div>
              </div>

              {/* Responsable + Columna inicial */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className={isEditing ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
                  <label
                    htmlFor="task-assignee-select"
                    className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300"
                  >
                    Responsable
                    <RequiredMark show={!isEditing} />
                  </label>
                  <div className="flex w-full min-w-0 items-center gap-2.5">
                    {assigneeId === '__ALL__' ? (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
                        <Users className="h-4.5 w-4.5" />
                      </div>
                    ) : assigneeId ? (
                      <div className="shrink-0">
                        <VectorAvatar
                          avatar={users.find((u) => u.id === assigneeId)?.avatar}
                          size={36}
                        />
                      </div>
                    ) : null}
                    <select
                      id="task-assignee-select"
                      value={assigneeId}
                      onChange={(e) => {
                        setAssigneeId(e.target.value);
                        if (e.target.value) clearFieldError('assigneeId');
                      }}
                      required={!isEditing}
                      aria-required={!isEditing}
                      aria-invalid={Boolean(errors.assigneeId)}
                      className={`w-full min-w-0 flex-1 truncate rounded-xl border bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none focus:ring-4 dark:bg-slate-800 dark:text-white ${fieldBorderClasses(Boolean(errors.assigneeId))}`}
                    >
                      {isEditing ? (
                        <option value="">Sin asignar</option>
                      ) : (
                        <option value="" disabled>
                          Selecciona responsable...
                        </option>
                      )}
                      <option value="__ALL__">Todo el equipo (Todos)</option>
                      {users.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.displayName} ({getRoleLabel(member.role)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <FieldError message={errors.assigneeId} />
                </div>

                {!isEditing ? (
                  <div className="min-w-0">
                    <label
                      htmlFor="task-status-select"
                      className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300"
                    >
                      Columna inicial
                      <RequiredMark show />
                    </label>
                    <select
                      id="task-status-select"
                      value={status}
                      onChange={(e) => {
                        setStatus(e.target.value as TaskStatus | '');
                        if (e.target.value) clearFieldError('status');
                      }}
                      required
                      aria-required="true"
                      aria-invalid={Boolean(errors.status)}
                      className={`w-full min-w-0 rounded-xl border bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none focus:ring-4 dark:bg-slate-800 dark:text-white ${fieldBorderClasses(Boolean(errors.status))}`}
                    >
                      <option value="" disabled>
                        Selecciona columna...
                      </option>
                      {KANBAN_COLUMNS.filter((col) => isLeader || col.status !== 'APPROVED').map((col) => (
                        <option key={col.status} value={col.status}>
                          {col.label}
                        </option>
                      ))}
                    </select>
                    <FieldError message={errors.status} />
                  </div>
                ) : null}
              </div>

              {/* Selector de color post-it */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    Color de nota Post-it
                  </span>
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {POSTIT_COLORS.find((c) => c.hex.toLowerCase() === color.toLowerCase())?.label ??
                      color}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  {POSTIT_COLORS.map((option) => {
                    const selected = color.toLowerCase() === option.hex.toLowerCase();
                    return (
                      <button
                        key={option.hex}
                        type="button"
                        onClick={() => setColor(option.hex)}
                        title={option.label}
                        aria-label={`Color ${option.label}`}
                        style={{ backgroundColor: option.hex }}
                        className={`flex h-9 w-9 items-center justify-center rounded-xl border transition ${
                          selected
                            ? 'scale-110 border-slate-900 ring-2 ring-blue-500 ring-offset-2 dark:border-white dark:ring-offset-slate-900'
                            : 'border-black/15 hover:scale-105'
                        }`}
                      >
                        {selected ? <Check className="h-4 w-4 text-slate-900" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Subtareas iniciales (obligatorio al crear) */}
              {!isEditing ? (
                <div
                  className={`rounded-2xl border p-4 ${
                    errors.subtasks
                      ? 'border-rose-400 bg-rose-50/40 dark:border-rose-500/70 dark:bg-rose-950/20'
                      : 'border-slate-200/80 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/40'
                  }`}
                >
                  <label
                    htmlFor="initial-subtask-input"
                    className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300"
                  >
                    Subtareas iniciales ({initialSubtasks.length}/20)
                    <RequiredMark show />
                  </label>
                  <p className="mb-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Agrega al menos 1 subtarea (presiona Enter o el botón Agregar).
                  </p>
                  <div className="flex gap-2">
                    <input
                      id="initial-subtask-input"
                      type="text"
                      value={subtaskDraft}
                      onChange={(e) => {
                        setSubtaskDraft(e.target.value);
                        if (e.target.value.trim()) clearFieldError('subtasks');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddInitialSubtask();
                        }
                      }}
                      maxLength={200}
                      aria-required="true"
                      aria-invalid={Boolean(errors.subtasks)}
                      placeholder="Ej. Revisar criterios con el equipo..."
                      className={`min-h-[40px] min-w-0 flex-1 rounded-xl border bg-white px-3 py-2 text-xs sm:text-sm text-slate-900 outline-none dark:bg-slate-900 dark:text-white ${fieldBorderClasses(Boolean(errors.subtasks))}`}
                    />
                    <button
                      type="button"
                      onClick={handleAddInitialSubtask}
                      className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600"
                    >
                      <Plus className="h-4 w-4" />
                      Agregar
                    </button>
                  </div>
                  <FieldError message={errors.subtasks} />

                  {initialSubtasks.length > 0 ? (
                    <ul className="mt-3 space-y-1.5">
                      {initialSubtasks.map((st, idx) => (
                        <li
                          key={`${st}-${idx}`}
                          className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        >
                          <span className="truncate">{st}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setInitialSubtasks((prev) => prev.filter((_, i) => i !== idx))
                            }
                            aria-label="Quitar subtarea"
                            className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {/* Acciones */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-65"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {isEditing ? 'Guardar cambios' : 'Crear Actividad'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
