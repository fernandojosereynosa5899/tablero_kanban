import { z } from 'zod';
import { AVATAR_ACCESSORIES, AVATAR_PRESETS, DEFAULT_AVATAR } from '../types/domain';

export { AVATAR_ACCESSORIES, AVATAR_PRESETS, DEFAULT_AVATAR };

export const avatarSchema = z.object({
  preset: z
    .string({ message: 'El preset del avatar es obligatorio' })
    .trim()
    .min(1, 'El preset del avatar es obligatorio')
    .max(30, 'El preset del avatar no puede superar 30 caracteres'),
  bg: z
    .string({ message: 'El color de fondo es obligatorio' })
    .regex(/^#[0-9a-fA-F]{6}$/, 'El color de fondo debe tener formato hexadecimal (#RRGGBB)'),
  color: z
    .string({ message: 'El color principal es obligatorio' })
    .regex(/^#[0-9a-fA-F]{6}$/, 'El color principal debe tener formato hexadecimal (#RRGGBB)'),
  accessory: z.enum(AVATAR_ACCESSORIES, {
    message: 'Accesorio de avatar inválido',
  }),
});

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export const usernameSchema = z
  .string({ message: 'La clave de usuario es obligatoria' })
  .trim()
  .toLowerCase()
  .min(3, 'La clave de usuario debe tener al menos 3 caracteres')
  .max(30, 'La clave de usuario no puede superar 30 caracteres')
  .regex(
    /^[a-z0-9_-]+$/,
    'La clave de usuario solo puede contener letras minúsculas, números, guiones y guiones bajos',
  );

export const displayNameSchema = z
  .string({ message: 'El nombre visible es obligatorio' })
  .trim()
  .min(2, 'El nombre visible debe tener al menos 2 caracteres')
  .max(50, 'El nombre visible no puede superar 50 caracteres');

export const loginSchema = z.object({
  username: z
    .string({ message: 'La clave de usuario es obligatoria' })
    .trim()
    .min(1, 'La clave de usuario es obligatoria')
    .max(60, 'Clave de usuario demasiado larga'),
  password: z
    .string({ message: 'La contraseña es obligatoria' })
    .min(1, 'La contraseña es obligatoria')
    .max(128, 'Contraseña demasiado larga'),
});

export const updateMeSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    avatar: avatarSchema.optional(),
  })
  .refine((data) => data.displayName !== undefined || data.avatar !== undefined, {
    message: 'Debes indicar al menos un campo para actualizar',
  });

export const changeMyPasswordSchema = z.object({
  currentPassword: z
    .string({ message: 'La contraseña actual es obligatoria' })
    .min(1, 'La contraseña actual es obligatoria'),
  newPassword: z
    .string({ message: 'La nueva contraseña es obligatoria' })
    .min(8, 'La nueva contraseña debe tener al menos 8 caracteres')
    .max(128, 'La nueva contraseña no puede superar 128 caracteres')
    .refine(
      (pw) => /[a-zA-Z]/.test(pw) && /[0-9]/.test(pw),
      'La nueva contraseña debe incluir al menos una letra y un número',
    ),
});

export const createUserSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: z
    .string({ message: 'La contraseña es obligatoria' })
    .min(6, 'La contraseña debe tener al menos 6 caracteres')
    .max(128, 'La contraseña no puede superar 128 caracteres'),
  avatar: avatarSchema.optional(),
});

export const updateUserSchema = z
  .object({
    username: usernameSchema.optional(),
    displayName: displayNameSchema.optional(),
    avatar: avatarSchema.optional(),
    password: z
      .string()
      .min(6, 'La contraseña debe tener al menos 6 caracteres')
      .max(128, 'La contraseña no puede superar 128 caracteres')
      .optional(),
  })
  .refine(
    (data) =>
      data.username !== undefined ||
      data.displayName !== undefined ||
      data.avatar !== undefined ||
      data.password !== undefined,
    {
      message: 'Debes indicar al menos un campo para actualizar',
    },
  );

export function formatZodError(error: z.ZodError): string {
  const first = error.issues[0];
  return first?.message ?? 'Datos de entrada inválidos';
}

export const taskStatusEnum = z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'APPROVED'], {
  message: 'Estado de tarea inválido',
});

export const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'], {
  message: 'Prioridad de tarea inválida',
});

const taskTitleSchema = z
  .string({ message: 'El título de la tarea es obligatorio' })
  .trim()
  .min(1, 'El título de la tarea es obligatorio')
  .max(140, 'El título de la tarea no puede superar 140 caracteres');

const taskDescriptionSchema = z
  .string({ message: 'La descripción debe ser texto' })
  .trim()
  .max(4000, 'La descripción no puede superar 4000 caracteres');

const requiredTaskDescriptionSchema = z
  .string({ message: 'La descripción de la actividad es obligatoria' })
  .trim()
  .min(1, 'La descripción de la actividad es obligatoria')
  .max(4000, 'La descripción no puede superar 4000 caracteres');

export const PROJECT_DATE_MIN = '2026-11-07';
export const PROJECT_DATE_MAX = '2026-12-19';
const PROJECT_START_MS = Date.parse(`${PROJECT_DATE_MIN}T00:00:00.000Z`);
const PROJECT_END_MS = Date.parse(`${PROJECT_DATE_MAX}T23:59:59.999Z`);

const requiredDueDateSchema = z
  .string({ message: 'La fecha límite de la actividad es obligatoria' })
  .trim()
  .min(1, 'La fecha límite de la actividad es obligatoria')
  .refine((val) => !Number.isNaN(Date.parse(val)), 'La fecha límite debe tener formato ISO válido')
  .refine((val) => {
    const ms = Date.parse(val);
    return ms >= PROJECT_START_MS && ms <= PROJECT_END_MS;
  }, 'La fecha límite debe estar entre el 07/11/2026 y el 19/12/2026');

const dueDateSchema = requiredDueDateSchema.nullable();

const assigneeIdSchema = z
  .string({ message: 'El identificador de usuario asignado es inválido' })
  .trim()
  .min(1, 'El identificador de usuario asignado no puede estar vacío')
  .nullable();

const taskColorSchema = z
  .string({ message: 'El color debe ser una cadena válida' })
  .trim()
  .min(1, 'El color no puede estar vacío')
  .max(20, 'El color no puede superar 20 caracteres')
  .nullable();

const subtaskTitleSchema = z
  .string({ message: 'El título de la subtarea es obligatorio' })
  .trim()
  .min(1, 'El título de la subtarea es obligatorio')
  .max(200, 'El título de la subtarea no puede superar 200 caracteres');

const requiredPriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'], {
  message: 'La prioridad de la actividad es obligatoria',
});

const requiredTaskStatusEnum = z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'APPROVED'], {
  message: 'La columna inicial de la actividad es obligatoria',
});

export const createTaskSchema = z
  .object({
    title: taskTitleSchema,
    description: requiredTaskDescriptionSchema,
    priority: requiredPriorityEnum,
    dueDate: requiredDueDateSchema,
    assigneeId: assigneeIdSchema.optional(),
    assignedToAll: z.boolean({ message: 'El campo asignar a todos debe ser booleano' }).optional(),
    color: taskColorSchema.optional(),
    status: requiredTaskStatusEnum,
    subtasks: z
      .array(subtaskTitleSchema, { message: 'Debes agregar al menos una subtarea inicial' })
      .min(1, 'Debes agregar al menos una subtarea inicial')
      .max(20, 'No puedes crear más de 20 subtareas iniciales'),
  })
  .refine(
    (data) =>
      data.assignedToAll === true ||
      (typeof data.assigneeId === 'string' && data.assigneeId.trim().length > 0),
    {
      path: ['assigneeId'],
      message: 'El responsable de la actividad es obligatorio',
    },
  );

export const updateTaskSchema = z
  .object({
    title: taskTitleSchema.optional(),
    description: taskDescriptionSchema.optional(),
    priority: priorityEnum.optional(),
    dueDate: dueDateSchema.optional(),
    assigneeId: assigneeIdSchema.optional(),
    assignedToAll: z.boolean({ message: 'El campo asignar a todos debe ser booleano' }).optional(),
    color: taskColorSchema.optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.priority !== undefined ||
      data.dueDate !== undefined ||
      data.assigneeId !== undefined ||
      data.assignedToAll !== undefined ||
      data.color !== undefined,
    {
      message: 'Debes indicar al menos un campo para actualizar',
    },
  );

export const moveTaskSchema = z.object({
  status: taskStatusEnum,
  position: z
    .number({ message: 'La posición debe ser un número' })
    .finite('La posición debe ser un número finito')
    .min(0, 'La posición no puede ser negativa')
    .optional(),
});

export const socketMoveTaskSchema = moveTaskSchema.extend({
  taskId: z
    .string({ message: 'El identificador de la tarea es obligatorio' })
    .trim()
    .min(1, 'El identificador de la tarea es obligatorio'),
});

export const createSubtaskSchema = z.object({
  title: subtaskTitleSchema,
});

export const updateSubtaskSchema = z
  .object({
    done: z.boolean({ message: 'El campo done debe ser booleano' }).optional(),
    title: subtaskTitleSchema.optional(),
  })
  .refine((data) => data.done !== undefined || data.title !== undefined, {
    message: 'Debes indicar done o title para actualizar la subtarea',
  });

export const createCommentSchema = z.object({
  content: z
    .string({ message: 'El comentario es obligatorio' })
    .trim()
    .min(1, 'El comentario no puede estar vacío')
    .max(1000, 'El comentario no puede superar 1000 caracteres'),
});

export const socketTypingCommentSchema = z.object({
  taskId: z
    .string({ message: 'El identificador de la tarea es obligatorio' })
    .trim()
    .min(1, 'El identificador de la tarea es obligatorio')
    .max(64),
  isTyping: z.boolean(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
export type UpdateSubtaskInput = z.infer<typeof updateSubtaskSchema>;
