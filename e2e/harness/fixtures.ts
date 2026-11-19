import fs from 'node:fs';
import { Page } from '@playwright/test';
import { apiRequest, getRuntimeState } from './api-client';
import { RoleSession, RUNTIME_STATE_PATH } from './env';

export type SeededUsername =
  | 'lider'
  | 'integrante1'
  | 'integrante2'
  | 'integrante3'
  | 'integrante4'
  | 'integrante5';

export function isStrictM2M3(): boolean {
  return process.env.E2E_STRICT_M2_M3 === '1';
}

export function getRoleSession(username: SeededUsername): RoleSession {
  const state = getRuntimeState();
  const session = state.sessions[username];
  if (!session) {
    throw new Error(`Missing cached session for ${username}`);
  }
  return session;
}

export async function refreshRoleSession(username: SeededUsername, password?: string): Promise<RoleSession> {
  const state = getRuntimeState();
  const res = await apiRequest<RoleSession>('/api/auth/login', {
    method: 'POST',
    body: {
      username,
      password: password ?? state.testPassword,
    },
  });
  if (res.status !== 200) {
    throw new Error(`Failed to refresh session for ${username}: ${res.status} ${res.rawText}`);
  }
  state.sessions[username] = res.data;
  fs.writeFileSync(RUNTIME_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  return res.data;
}

export async function seedBrowserAuth(
  page: Page,
  sessionOrUsername: RoleSession | SeededUsername,
  opts: { dismissTutorial?: boolean; theme?: 'light' | 'dark' } = {},
): Promise<RoleSession> {
  const session =
    typeof sessionOrUsername === 'string' ? getRoleSession(sessionOrUsername) : sessionOrUsername;
  const dismissTutorial = opts.dismissTutorial ?? true;
  const theme = opts.theme ?? 'light';

  await page.addInitScript(
    ({ token, userId, dismiss }) => {
      window.localStorage.setItem('kanban_token', token);
      if (dismiss) {
        window.localStorage.setItem(`kanban_tutorial_v1_${userId}`, '1');
      }
    },
    {
      token: session.token,
      userId: session.user.id,
      dismiss: dismissTutorial,
    },
  );

  if (opts.theme) {
    await page.addInitScript(
      (preferredTheme) => {
        if (!window.sessionStorage.getItem('__e2e_theme_seeded__')) {
          window.localStorage.setItem('kanban_theme', preferredTheme);
          window.sessionStorage.setItem('__e2e_theme_seeded__', '1');
        }
      },
      theme,
    );
  }

  return session;
}

export interface TestTaskPayload {
  title?: string;
  description?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  dueDate?: string;
  status?: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'APPROVED';
  subtasks?: string[];
  assigneeId?: string | null;
  assignedToAll?: boolean;
  color?: string | null;
}

export interface TaskDto {
  id: string;
  title: string;
  description: string;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'APPROVED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  dueDate: string | null;
  position: number;
  color: string | null;
  assigneeId: string | null;
  assignedToAll: boolean;
  approvedAt: string | null;
  subtasks: Array<{ id: string; title: string; done: boolean; position: number }>;
}

export async function createTestTask(
  token: string,
  overrides: TestTaskPayload = {},
): Promise<TaskDto> {
  const leader = getRoleSession('lider');
  const payload: TestTaskPayload = {
    title: overrides.title ?? `E2E Task ${Date.now()}`,
    description: overrides.description ?? 'Automated E2E test task description',
    priority: overrides.priority ?? 'MEDIUM',
    dueDate: overrides.dueDate ?? '2026-12-10T12:00:00.000Z',
    status: overrides.status ?? 'TODO',
    subtasks: overrides.subtasks ?? ['Subtask A'],
    assignedToAll: overrides.assignedToAll ?? false,
    assigneeId: overrides.assignedToAll ? null : (overrides.assigneeId ?? leader.user.id),
    color: overrides.color ?? '#FFF59D',
  };

  const res = await apiRequest<TaskDto>('/api/tasks', {
    method: 'POST',
    token,
    body: payload,
  });
  if (res.status !== 201) {
    throw new Error(`createTestTask failed (${res.status}): ${res.rawText}`);
  }
  return res.data;
}

export async function deleteTestTask(taskId: string): Promise<void> {
  const leader = getRoleSession('lider');
  await apiRequest(`/api/tasks/${taskId}`, {
    method: 'DELETE',
    token: leader.token,
  });
}

export async function cleanupExtraTasks(): Promise<void> {
  const state = getRuntimeState();
  const leader = getRoleSession('lider');
  const res = await apiRequest<TaskDto[]>('/api/tasks', { token: leader.token });
  if (res.status !== 200 || !Array.isArray(res.data)) return;

  const seededSet = new Set(state.seededTaskIds);
  for (const task of res.data) {
    if (!seededSet.has(task.id)) {
      await apiRequest(`/api/tasks/${task.id}`, {
        method: 'DELETE',
        token: leader.token,
      });
    }
  }
}

export async function ensureMaintenanceDisabled(): Promise<void> {
  const leader = getRoleSession('lider');
  await apiRequest('/api/maintenance', {
    method: 'PATCH',
    token: leader.token,
    body: { enabled: false },
  });
}
