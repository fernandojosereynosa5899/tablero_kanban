import type {
  Activity,
  AttachmentStorageStats,
  AttachmentUploadResponse,
  AvatarConfig,
  Comment,
  HealthResponse,
  LoginResponse,
  MaintenanceStatus,
  Priority,
  Task,
  TaskAttachment,
  TaskDetail,
  TaskStatus,
  UserPublic,
  UsersListResponse,
} from '../types/kanban';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type UnauthorizedHandler = () => void;
type MaintenanceHandler = (status?: MaintenanceStatus) => void;

let authToken: string | null = null;
let unauthorizedHandler: UnauthorizedHandler | null = null;
let maintenanceHandler: MaintenanceHandler | null = null;

export function setApiAuthToken(token: string | null): void {
  authToken = token;
}

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

export function setMaintenanceHandler(handler: MaintenanceHandler | null): void {
  maintenanceHandler = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  skipAuth?: boolean;
  skipUnauthorizedCallback?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, skipAuth = false, skipUnauthorizedCallback = false } = options;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (body !== undefined && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  if (!skipAuth && authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor');
  }

  let payload: unknown = null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const isMaintenancePayload =
      response.status === 503 &&
      payload !== null &&
      typeof payload === 'object' &&
      (payload as { maintenance?: unknown }).maintenance === true;

    if (isMaintenancePayload) {
      maintenanceHandler?.((payload as { status?: MaintenanceStatus }).status);
    }

    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `Error ${response.status} al comunicarse con el servidor`;

    if (response.status === 401 && !skipUnauthorizedCallback && !isMaintenancePayload) {
      unauthorizedHandler?.();
    }

    throw new ApiError(response.status, message);
  }

  return payload as T;
}

export interface UpdateMeInput {
  displayName?: string;
  avatar?: AvatarConfig;
}

export interface ChangeMyPasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface CreateUserInput {
  username: string;
  displayName: string;
  password: string;
  avatar?: AvatarConfig;
}

export interface UpdateUserInput {
  username?: string;
  displayName?: string;
  avatar?: AvatarConfig;
  password?: string;
}

export interface CreateTaskInput {
  title: string;
  description: string;
  priority: Priority;
  dueDate: string;
  assigneeId: string | null;
  assignedToAll: boolean;
  color?: string | null;
  status: TaskStatus;
  subtasks: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  priority?: Priority;
  dueDate?: string | null;
  assigneeId?: string | null;
  assignedToAll?: boolean;
  color?: string | null;
}

export interface MoveTaskInput {
  status: TaskStatus;
  position?: number;
}

export interface UpdateSubtaskInput {
  done?: boolean;
  title?: string;
}

export interface UpdateMaintenanceInput {
  enabled: boolean;
  title?: string;
  message?: string;
  estimatedMinutes?: number | null;
}

export const api = {
  health(): Promise<HealthResponse> {
    return request<HealthResponse>('/api/health', {
      skipAuth: true,
      skipUnauthorizedCallback: true,
    });
  },

  getMaintenanceStatus(): Promise<MaintenanceStatus> {
    return request<MaintenanceStatus>('/api/maintenance/status', {
      skipAuth: true,
      skipUnauthorizedCallback: true,
    });
  },

  updateMaintenanceStatus(input: UpdateMaintenanceInput): Promise<MaintenanceStatus> {
    return request<MaintenanceStatus>('/api/maintenance', {
      method: 'PATCH',
      body: input,
    });
  },

  login(username: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      skipAuth: true,
      skipUnauthorizedCallback: true,
    });
  },

  getMe(): Promise<UserPublic> {
    return request<UserPublic>('/api/users/me');
  },

  updateMe(input: UpdateMeInput): Promise<UserPublic> {
    return request<UserPublic>('/api/users/me', {
      method: 'PATCH',
      body: input,
    });
  },

  changeMyPassword(input: ChangeMyPasswordInput): Promise<{ ok: boolean; token: string }> {
    return request<{ ok: boolean; token: string }>('/api/users/me/password', {
      method: 'PATCH',
      body: input,
    });
  },

  listUsers(): Promise<UsersListResponse> {
    return request<UsersListResponse>('/api/users');
  },

  createUser(input: CreateUserInput): Promise<UserPublic> {
    return request<UserPublic>('/api/users', {
      method: 'POST',
      body: input,
    });
  },

  updateUser(id: string, input: UpdateUserInput): Promise<UserPublic> {
    return request<UserPublic>(`/api/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    });
  },

  deleteUser(id: string): Promise<{ ok: boolean; id: string }> {
    return request<{ ok: boolean; id: string }>(`/api/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  listTasks(assigneeId?: string): Promise<Task[]> {
    const query = assigneeId ? `?assigneeId=${encodeURIComponent(assigneeId)}` : '';
    return request<Task[]>(`/api/tasks${query}`);
  },

  getTask(id: string): Promise<TaskDetail> {
    return request<TaskDetail>(`/api/tasks/${encodeURIComponent(id)}`);
  },

  createTask(input: CreateTaskInput): Promise<Task> {
    return request<Task>('/api/tasks', {
      method: 'POST',
      body: input,
    });
  },

  updateTask(id: string, input: UpdateTaskInput): Promise<Task> {
    return request<Task>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    });
  },

  deleteTask(id: string): Promise<{ ok: boolean; id: string }> {
    return request<{ ok: boolean; id: string }>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  moveTask(id: string, input: MoveTaskInput): Promise<Task> {
    return request<Task>(`/api/tasks/${encodeURIComponent(id)}/move`, {
      method: 'PATCH',
      body: input,
    });
  },

  createSubtask(taskId: string, title: string): Promise<Task> {
    return request<Task>(`/api/tasks/${encodeURIComponent(taskId)}/subtasks`, {
      method: 'POST',
      body: { title },
    });
  },

  updateSubtask(subtaskId: string, input: UpdateSubtaskInput): Promise<Task> {
    return request<Task>(`/api/subtasks/${encodeURIComponent(subtaskId)}`, {
      method: 'PATCH',
      body: input,
    });
  },

  deleteSubtask(subtaskId: string): Promise<Task> {
    return request<Task>(`/api/subtasks/${encodeURIComponent(subtaskId)}`, {
      method: 'DELETE',
    });
  },

  listComments(taskId: string): Promise<Comment[]> {
    return request<Comment[]>(`/api/tasks/${encodeURIComponent(taskId)}/comments`);
  },

  createComment(taskId: string, content: string): Promise<Comment> {
    return request<Comment>(`/api/tasks/${encodeURIComponent(taskId)}/comments`, {
      method: 'POST',
      body: { content },
    });
  },

  deleteComment(commentId: string): Promise<{ ok: boolean; id: string; taskId: string }> {
    return request<{ ok: boolean; id: string; taskId: string }>(
      `/api/comments/${encodeURIComponent(commentId)}`,
      {
        method: 'DELETE',
      },
    );
  },

  listActivity(limit = 30): Promise<Activity[]> {
    return request<Activity[]>(`/api/activity?limit=${encodeURIComponent(String(limit))}`);
  },

  getAttachmentStorageStats(): Promise<AttachmentStorageStats> {
    return request<AttachmentStorageStats>('/api/attachments/storage');
  },

  listTaskAttachments(taskId: string): Promise<TaskAttachment[]> {
    return request<TaskAttachment[]>(`/api/tasks/${encodeURIComponent(taskId)}/attachments`);
  },

  uploadTaskAttachment(taskId: string, file: File): Promise<AttachmentUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    return request<AttachmentUploadResponse>(
      `/api/tasks/${encodeURIComponent(taskId)}/attachments`,
      {
        method: 'POST',
        body: formData,
      },
    );
  },

  deleteTaskAttachment(
    attachmentId: string,
  ): Promise<{
    ok: boolean;
    id: string;
    taskId: string;
    removedBlob: boolean;
    freedBytes: number;
    removedFromDrive?: boolean;
  }> {
    return request<{
      ok: boolean;
      id: string;
      taskId: string;
      removedBlob: boolean;
      freedBytes: number;
      removedFromDrive?: boolean;
    }>(`/api/attachments/${encodeURIComponent(attachmentId)}`, {
      method: 'DELETE',
    });
  },

  async fetchAttachmentBlob(attachmentId: string, inline = false): Promise<Blob> {
    const headers: Record<string, string> = {};
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    let response: Response;
    try {
      const qs = inline ? '?inline=1' : '';
      response = await fetch(`/api/attachments/${encodeURIComponent(attachmentId)}/download${qs}`, {
        method: 'GET',
        headers,
      });
    } catch {
      throw new ApiError(0, 'No se pudo descargar el archivo desde el servidor');
    }

    if (!response.ok) {
      let message = `Error ${response.status} al descargar el archivo`;
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        try {
          const payload = (await response.json()) as {
            error?: unknown;
            maintenance?: unknown;
            status?: MaintenanceStatus;
          };
          if (response.status === 503 && payload.maintenance === true) {
            maintenanceHandler?.(payload.status);
          }
          if (typeof payload.error === 'string') message = payload.error;
        } catch {
          // Ignorar error de parseo
        }
      }
      if (response.status === 401) {
        unauthorizedHandler?.();
      }
      throw new ApiError(response.status, message);
    }

    return response.blob();
  },
};
