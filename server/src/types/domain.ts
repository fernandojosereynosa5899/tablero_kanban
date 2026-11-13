import type {
  ActivityLog as PrismaActivityLog,
  Comment as PrismaComment,
  Priority,
  Role,
  Subtask as PrismaSubtask,
  Task as PrismaTask,
  TaskStatus,
  User as PrismaUser,
} from '@prisma/client';

export const MAX_USERS = 6;

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

export type TaskWithRelations = PrismaTask & {
  assignee: PrismaUser | null;
  subtasks: PrismaSubtask[];
  _count: {
    comments: number;
    attachments: number;
  };
};

export interface AttachmentRecordMeta {
  id: string;
  taskId: string;
  originalName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  blobSha256: string;
  createdAt: Date;
  uploadedBy: PrismaUser | null;
  blob?: {
    storedBytes: number;
    isCompressed: boolean;
  } | null;
}

export type CommentWithAuthor = PrismaComment & {
  author: PrismaUser | null;
};

export type ActivityWithUser = PrismaActivityLog & {
  user: PrismaUser | null;
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function parseAvatar(raw: unknown): AvatarConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_AVATAR };
  }
  const obj = raw as Record<string, unknown>;
  const preset =
    typeof obj.preset === 'string' && obj.preset.trim().length > 0 && obj.preset.trim().length <= 30
      ? obj.preset.trim()
      : DEFAULT_AVATAR.preset;
  const bg = typeof obj.bg === 'string' && HEX_COLOR_RE.test(obj.bg) ? obj.bg : DEFAULT_AVATAR.bg;
  const color = typeof obj.color === 'string' && HEX_COLOR_RE.test(obj.color) ? obj.color : DEFAULT_AVATAR.color;
  const accessory =
    typeof obj.accessory === 'string' && (AVATAR_ACCESSORIES as readonly string[]).includes(obj.accessory)
      ? (obj.accessory as AvatarAccessory)
      : DEFAULT_AVATAR.accessory;

  return { preset, bg, color, accessory };
}

/** Convierte un registro User de Prisma en su representación pública (sin passwordHash ni tokenVersion). */
export function toUserPublic(user: PrismaUser): UserPublic {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    avatar: parseAvatar(user.avatar),
    slot: user.slot,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toSubtaskDTO(subtask: PrismaSubtask): Subtask {
  return {
    id: subtask.id,
    taskId: subtask.taskId,
    title: subtask.title,
    done: subtask.done,
    position: subtask.position,
  };
}

export function toTaskDTO(task: TaskWithRelations): Task {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    position: task.position,
    color: task.color,
    assigneeId: task.assigneeId,
    assignee: task.assignee ? toUserPublic(task.assignee) : null,
    assignedToAll: task.assignedToAll,
    createdById: task.createdById,
    approvedAt: task.approvedAt ? task.approvedAt.toISOString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    subtasks: task.subtasks.map(toSubtaskDTO),
    commentCount: task._count.comments,
    attachmentCount: task._count.attachments,
  };
}

export function toAttachmentDTO(att: AttachmentRecordMeta): TaskAttachment {
  const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp']);
  return {
    id: att.id,
    taskId: att.taskId,
    originalName: att.originalName,
    extension: att.extension,
    mimeType: att.mimeType,
    sizeBytes: att.sizeBytes,
    storedBytes: att.blob?.storedBytes ?? att.sizeBytes,
    isCompressed: Boolean(att.blob?.isCompressed),
    isPreviewableImage: imageExts.has(att.extension.toLowerCase()),
    blobSha256: att.blobSha256,
    createdAt: att.createdAt.toISOString(),
    uploadedBy: att.uploadedBy ? toUserPublic(att.uploadedBy) : null,
  };
}

export function toCommentDTO(comment: CommentWithAuthor): Comment {
  const author: UserPublic = comment.author
    ? toUserPublic(comment.author)
    : {
        id: comment.authorId ?? 'deleted',
        username: 'eliminado',
        displayName: 'Usuario eliminado',
        role: 'MEMBER',
        avatar: { ...DEFAULT_AVATAR },
        slot: 0,
        createdAt: comment.createdAt.toISOString(),
      };

  return {
    id: comment.id,
    taskId: comment.taskId,
    content: comment.content,
    createdAt: comment.createdAt.toISOString(),
    author,
  };
}

export function toActivityDTO(activity: ActivityWithUser): Activity {
  const details =
    activity.details && typeof activity.details === 'object' && !Array.isArray(activity.details)
      ? (activity.details as Record<string, unknown>)
      : {};

  return {
    id: activity.id,
    action: activity.action,
    details,
    createdAt: activity.createdAt.toISOString(),
    user: activity.user ? toUserPublic(activity.user) : null,
    taskId: activity.taskId,
  };
}
