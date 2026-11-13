export type Role = 'LEADER' | 'SUBLEADER' | 'MEMBER';

export function getRoleLabel(role: Role): string {
  if (role === 'LEADER') return 'Líder';
  if (role === 'SUBLEADER') return 'Sublíder';
  return 'Integrante';
}

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'APPROVED';

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export const MAX_USERS = 6;
export const PROJECT_DATE_MIN = '2026-11-07';
export const PROJECT_DATE_MAX = '2026-12-19';

export function isTaskIncompleteOverdue(task: Pick<Task, 'dueDate' | 'status'>, nowMs = Date.now()): boolean {
  if (!task.dueDate) return false;
  if (task.status === 'DONE' || task.status === 'APPROVED') return false;
  const dueMs = Date.parse(task.dueDate);
  if (Number.isNaN(dueMs)) return false;
  return dueMs < nowMs;
}

export const AVATAR_ACCESSORIES = [
  'none',
  'glasses',
  'headphones',
  'crown',
  'cap',
  'bow',
  'star',
  'earring',
] as const;

export type AvatarAccessory = (typeof AVATAR_ACCESSORIES)[number];

export const AVATAR_PRESETS = [
  'astronauta',
  'robot',
  'gato',
  'zorro',
  'buho',
  'panda',
  'ninja',
  'mago',
  'piloto',
  'artista',
  'chef',
  'gamer',
  'cientifica',
  'exploradora',
  'oso',
  'koala',
] as const;

export type AvatarPreset = (typeof AVATAR_PRESETS)[number];

export interface AvatarConfig {
  preset: string;
  bg: string;
  color: string;
  accessory: AvatarAccessory;
}

export const DEFAULT_AVATAR: AvatarConfig = {
  preset: 'astronauta',
  bg: '#1E88E5',
  color: '#FFFFFF',
  accessory: 'none',
};

export interface UserPublic {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  avatar: AvatarConfig;
  slot: number;
  createdAt: string;
}

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  position: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  position: number;
  color: string | null;
  assigneeId: string | null;
  assignee: UserPublic | null;
  assignedToAll: boolean;
  createdById: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  subtasks: Subtask[];
  commentCount: number;
  attachmentCount: number;
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  originalName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  storedBytes: number;
  isCompressed: boolean;
  isPreviewableImage: boolean;
  blobSha256: string;
  createdAt: string;
  uploadedBy: UserPublic | null;
}

export interface AttachmentUploadResponse {
  attachment: TaskAttachment;
  deduplicated: boolean;
  emailSent: boolean;
  emailWarning?: string;
}

export interface AttachmentStorageStats {
  logicalBytes: number;
  storedBytes: number;
  savedBytes: number;
  quotaBytes: number;
  uniqueBlobs: number;
  totalAttachments: number;
}

export interface Comment {
  id: string;
  taskId: string;
  content: string;
  createdAt: string;
  author: UserPublic;
}

export interface TaskDetail extends Task {
  comments: Comment[];
  attachments: TaskAttachment[];
}

export interface Activity {
  id: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
  user: UserPublic | null;
  taskId: string | null;
}

export interface UsersListResponse {
  users: UserPublic[];
  maxUsers: number;
}

export interface LoginResponse {
  token: string;
  user: UserPublic;
}

export interface HealthResponse {
  status: string;
  db: boolean;
  time: string;
}

export interface ColumnMeta {
  status: TaskStatus;
  label: string;
  color: string;
  description: string;
}

export const KANBAN_COLUMNS: ColumnMeta[] = [
  {
    status: 'TODO',
    label: 'POR HACER',
    color: '#1E88E5',
    description: 'Tareas planificadas listas para iniciar',
  },
  {
    status: 'IN_PROGRESS',
    label: 'EN PROCESO',
    color: '#FFA726',
    description: 'Trabajo activo en curso por el equipo',
  },
  {
    status: 'DONE',
    label: 'HECHO',
    color: '#7E57C2',
    description: 'Terminadas y pendientes de revisión del líder',
  },
  {
    status: 'APPROVED',
    label: 'APROBADO',
    color: '#2E9E5B',
    description: 'Validadas y cerradas por el líder del proyecto',
  },
];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: 'POR HACER',
  IN_PROGRESS: 'EN PROCESO',
  DONE: 'HECHO',
  APPROVED: 'APROBADO',
};

export interface PriorityMeta {
  value: Priority;
  label: string;
  color: string;
  badgeClass: string;
}

export const PRIORITY_OPTIONS: PriorityMeta[] = [
  {
    value: 'LOW',
    label: 'Baja',
    color: '#64748B',
    badgeClass:
      'bg-slate-100 text-slate-700 ring-1 ring-slate-300/70 dark:bg-slate-700/60 dark:text-slate-200 dark:ring-slate-600',
  },
  {
    value: 'MEDIUM',
    label: 'Media',
    color: '#1E88E5',
    badgeClass:
      'bg-sky-100 text-sky-800 ring-1 ring-sky-300/70 dark:bg-sky-500/20 dark:text-sky-200 dark:ring-sky-400/40',
  },
  {
    value: 'HIGH',
    label: 'Alta',
    color: '#F59E0B',
    badgeClass:
      'bg-amber-100 text-amber-800 ring-1 ring-amber-300/80 dark:bg-amber-500/20 dark:text-amber-200 dark:ring-amber-400/40',
  },
  {
    value: 'URGENT',
    label: 'Urgente',
    color: '#EF4444',
    badgeClass:
      'bg-rose-100 text-rose-800 ring-1 ring-rose-300/80 dark:bg-rose-500/20 dark:text-rose-200 dark:ring-rose-400/40',
  },
];

export const PRIORITY_MAP: Record<Priority, PriorityMeta> = {
  LOW: PRIORITY_OPTIONS[0],
  MEDIUM: PRIORITY_OPTIONS[1],
  HIGH: PRIORITY_OPTIONS[2],
  URGENT: PRIORITY_OPTIONS[3],
};

export interface StatusPastelTheme {
  strip: string;
  lightCardBg: string;
  lightCardBorder: string;
  darkCardBg: string;
  darkCardBorder: string;
  lightColBg: string;
  lightColBorder: string;
  darkColBg: string;
  darkColBorder: string;
}

export const STATUS_PASTEL_THEME: Record<TaskStatus, StatusPastelTheme> = {
  TODO: {
    strip: '#93C5FD',
    lightCardBg: '#EFF6FF',
    lightCardBorder: '#BFDBFE',
    darkCardBg: '#162338',
    darkCardBorder: 'rgba(96, 165, 250, 0.34)',
    lightColBg: 'rgba(219, 234, 254, 0.55)',
    lightColBorder: 'rgba(147, 197, 253, 0.75)',
    darkColBg: 'rgba(30, 136, 229, 0.08)',
    darkColBorder: 'rgba(96, 165, 250, 0.24)',
  },
  IN_PROGRESS: {
    strip: '#FCD34D',
    lightCardBg: '#FFFBEB',
    lightCardBorder: '#FDE68A',
    darkCardBg: '#271F14',
    darkCardBorder: 'rgba(251, 191, 36, 0.34)',
    lightColBg: 'rgba(254, 243, 199, 0.52)',
    lightColBorder: 'rgba(252, 211, 77, 0.75)',
    darkColBg: 'rgba(255, 167, 38, 0.08)',
    darkColBorder: 'rgba(251, 191, 36, 0.24)',
  },
  DONE: {
    strip: '#C4B5FD',
    lightCardBg: '#F5F3FF',
    lightCardBorder: '#DDD6FE',
    darkCardBg: '#1E1A33',
    darkCardBorder: 'rgba(167, 139, 250, 0.34)',
    lightColBg: 'rgba(237, 233, 254, 0.55)',
    lightColBorder: 'rgba(196, 181, 253, 0.78)',
    darkColBg: 'rgba(126, 87, 194, 0.09)',
    darkColBorder: 'rgba(167, 139, 250, 0.25)',
  },
  APPROVED: {
    strip: '#86EFAC',
    lightCardBg: '#ECFDF5',
    lightCardBorder: '#A7F3D0',
    darkCardBg: '#122620',
    darkCardBorder: 'rgba(52, 211, 153, 0.34)',
    lightColBg: 'rgba(220, 252, 231, 0.55)',
    lightColBorder: 'rgba(134, 239, 172, 0.78)',
    darkColBg: 'rgba(46, 158, 91, 0.09)',
    darkColBorder: 'rgba(52, 211, 153, 0.25)',
  },
};

export interface PostItColorOption {
  hex: string;
  label: string;
  accent: string;
}

export const POSTIT_COLORS: PostItColorOption[] = [
  { hex: '#FFF59D', label: 'Mantequilla Pastel', accent: '#FBC02D' },
  { hex: '#F8BBD0', label: 'Rosa Pastel', accent: '#EC407A' },
  { hex: '#B3E5FC', label: 'Azul Cielo Pastel', accent: '#29B6F6' },
  { hex: '#C8E6C9', label: 'Verde Menta Pastel', accent: '#66BB6A' },
  { hex: '#FFE0B2', label: 'Durazno Pastel', accent: '#FFA726' },
  { hex: '#FFCCBC', label: 'Coral Pastel', accent: '#FF7043' },
  { hex: '#D1C4E9', label: 'Lavanda Pastel', accent: '#7E57C2' },
  { hex: '#E0F7FA', label: 'Aqua Pastel', accent: '#26C6DA' },
  { hex: '#E9D5FF', label: 'Lila Suave', accent: '#A855F7' },
  { hex: '#CCFBF1', label: 'Turquesa Pastel', accent: '#14B8A6' },
];

export const DEFAULT_POSTIT_COLOR = '#FFF59D';
