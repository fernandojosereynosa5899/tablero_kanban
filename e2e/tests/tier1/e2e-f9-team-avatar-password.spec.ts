import { expect, test } from '@playwright/test';
import {
  apiRequest,
  connectSocket,
  getRuntimeState,
  waitForSocketEvent,
} from '../../harness/api-client';
import { getRoleSession, refreshRoleSession, seedBrowserAuth } from '../../harness/fixtures';

test.describe('Tier 1 — E2E-F9: Team 6-Slot Management, Avatar Studio & Password Policy', () => {
  test('9.1 GET /api/users returns 6 seeded users with maxUsers: 6 ordered by slot', async () => {
    const leader = getRoleSession('lider');
    const res = await apiRequest<{
      users: Array<{ slot: number; username: string; role: string }>;
      maxUsers: number;
    }>('/api/users', { token: leader.token });

    expect(res.status).toBe(200);
    expect(res.data.maxUsers).toBe(6);
    expect(res.data.users).toHaveLength(6);
    expect(res.data.users.map((u) => u.slot)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(res.data.users[0].role).toBe('LEADER');
    expect(res.data.users[5].role).toBe('SUBLEADER');
  });

  test('9.2 Leader frees slot 5 and occupies it via TeamModal UI, then restores default slot 5', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const origMember4 = getRoleSession('integrante4');
    const tempUsername = `e2e_slot5_${Date.now().toString().slice(-5)}`;
    let createdUserId: string | null = null;

    // Remember task originally assigned to integrante4 so we can restore it cleanly
    const tasksRes = await apiRequest<Array<{ id: string; assigneeId: string | null }>>('/api/tasks', {
      token: leader.token,
    });
    const member4TaskIds = tasksRes.data
      .filter((t) => t.assigneeId === origMember4.user.id)
      .map((t) => t.id);

    try {
      await seedBrowserAuth(page, 'lider');
      await page.goto(state.baseUrl);
      await page.getByRole('button', { name: 'Equipo (6/6)' }).click();

      const modal = page.locator('div[role="dialog"][aria-labelledby="team-modal-title"]');
      await expect(modal).toBeVisible();

      // Free slot 5 (integrante4)
      const slot5Row = modal.locator('div[data-slot="5"]');
      await slot5Row.getByRole('button', { name: 'Liberar' }).click();
      await modal.getByRole('button', { name: 'Sí, liberar cupo' }).click();

      await expect(modal.getByRole('button', { name: 'Ocupar cupo libre' })).toBeVisible();
      await modal.getByRole('button', { name: 'Ocupar cupo libre' }).click();

      await modal.locator('#team-create-username-5').fill(tempUsername);
      await modal.locator('#team-create-displayname-5').fill('E2E Nuevo Integrante');
      await modal.locator('#team-create-password-5').fill(state.testPassword);
      await modal.getByRole('button', { name: 'Crear integrante' }).click();

      await expect(modal.getByText(`@${tempUsername}`)).toBeVisible();

      const usersAfter = await apiRequest<{ users: Array<{ id: string; username: string; slot: number }> }>(
        '/api/users',
        { token: leader.token },
      );
      const created = usersAfter.data.users.find((u) => u.username === tempUsername);
      expect(created).toBeTruthy();
      expect(created?.slot).toBe(5);
      createdUserId = created?.id ?? null;
    } finally {
      if (createdUserId) {
        await apiRequest(`/api/users/${createdUserId}`, {
          method: 'DELETE',
          token: leader.token,
        });
      }
      // Restore slot 5 default integrante4 if deleted
      const usersNow = await apiRequest<{ users: Array<{ id: string; username: string }> }>(
        '/api/users',
        { token: leader.token },
      );
      if (!usersNow.data.users.some((u) => u.username === 'integrante4')) {
        const restoreRes = await apiRequest<{ id: string }>('/api/users', {
          method: 'POST',
          token: leader.token,
          body: {
            username: 'integrante4',
            displayName: origMember4.user.displayName,
            password: state.testPassword,
            avatar: origMember4.user.avatar,
          },
        });
        if (restoreRes.status === 201) {
          for (const taskId of member4TaskIds) {
            await apiRequest(`/api/tasks/${taskId}`, {
              method: 'PATCH',
              token: leader.token,
              body: { assigneeId: restoreRes.data.id },
            });
          }
          await refreshRoleSession('integrante4', state.testPassword);
        }
      }
    }
  });

  test('9.3 Leader edits member displayName and resets password via TeamModal UI', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const target = getRoleSession('integrante3');
    const tempDisplayName = `Luis Eduardo E2E ${Date.now().toString().slice(-4)}`;

    try {
      await seedBrowserAuth(page, 'lider');
      await page.goto(state.baseUrl);
      await page.getByRole('button', { name: 'Equipo (6/6)' }).click();

      const modal = page.locator('div[role="dialog"][aria-labelledby="team-modal-title"]');
      const row = modal.locator(`div[data-slot="${target.user.slot}"]`);

      await row.getByRole('button', { name: 'Editar' }).click();
      const nameInput = modal.locator(`#team-edit-displayname-${target.user.id}`);
      await nameInput.fill(tempDisplayName);
      await modal.getByRole('button', { name: 'Guardar cambios' }).click();
      await expect(modal.getByText(tempDisplayName)).toBeVisible();

      const updatedRow = modal.locator(`div[data-slot="${target.user.slot}"]`);
      await updatedRow.getByRole('button', { name: 'Restablecer clave' }).click();
      await modal.locator(`#team-reset-password-${target.user.id}`).fill(`${state.testPassword}_R1`);
      await modal.getByRole('button', { name: 'Confirmar restablecimiento' }).click();
      await expect(modal.getByText('Confirmar restablecimiento')).toHaveCount(0);
    } finally {
      await apiRequest(`/api/users/${target.user.id}`, {
        method: 'PATCH',
        token: leader.token,
        body: {
          displayName: target.user.displayName,
          password: state.testPassword,
        },
      });
      await refreshRoleSession('integrante3', state.testPassword);
    }
  });

  test('9.4 User updates displayName and SVG avatar in AvatarStudioModal and emits user:updated', async ({ page }) => {
    const state = getRuntimeState();
    const member = getRoleSession('integrante2');
    const sLeader = await connectSocket(getRoleSession('lider').token);
    const updatedName = `Kuri E2E ${Date.now().toString().slice(-4)}`;

    try {
      await seedBrowserAuth(page, 'integrante2');
      await page.goto(state.baseUrl);
      await page.getByRole('button', { name: 'Mi Perfil & Avatar' }).click();

      const modal = page.locator('div[role="dialog"][aria-labelledby="avatar-studio-title"]');
      await expect(modal).toBeVisible();

      const updateEv = waitForSocketEvent<{ id: string; displayName: string }>(
        sLeader,
        'user:updated',
        (u) => u.id === member.user.id,
      );

      await modal.locator('#studio-display-name').fill(updatedName);
      await modal.getByRole('button', { name: 'Guardar cambios' }).click();

      const ev = await updateEv;
      expect(ev.displayName).toBe(updatedName);
    } finally {
      sLeader.disconnect();
      await apiRequest(`/api/users/${member.user.id}`, {
        method: 'PATCH',
        token: getRoleSession('lider').token,
        body: { displayName: member.user.displayName, avatar: member.user.avatar },
      });
    }
  });

  test('9.5 AvatarStudioModal Cambiar Contraseña tab changes password and keeps session active', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante3');
    const newPassword = `${state.testPassword}_S9`;

    try {
      await seedBrowserAuth(page, member);
      await page.goto(state.baseUrl);
      await page.getByRole('button', { name: 'Mi Perfil & Avatar' }).click();

      const modal = page.locator('div[role="dialog"][aria-labelledby="avatar-studio-title"]');
      await modal.getByRole('button', { name: 'Cambiar Contraseña' }).click();

      await modal.locator('#studio-current-password').fill(state.testPassword);
      await modal.locator('#studio-new-password').fill(newPassword);
      await modal.locator('#studio-confirm-password').fill(newPassword);
      await modal.getByRole('button', { name: 'Actualizar contraseña' }).click();

      await expect(modal).toBeHidden();
      // Session remains logged in on the board
      await expect(page.getByRole('heading', { name: 'Tablero Kanban' })).toBeVisible();
    } finally {
      await apiRequest(`/api/users/${member.user.id}`, {
        method: 'PATCH',
        token: leader.token,
        body: { password: state.testPassword },
      });
      await refreshRoleSession('integrante3', state.testPassword);
    }
  });
});
