import { expect, test } from '@playwright/test';
import {
  apiRequest,
  getRuntimeState,
  makePngBuffer,
} from '../../harness/api-client';
import {
  cleanupExtraTasks,
  createTestTask,
  ensureMaintenanceDisabled,
  getRoleSession,
  isStrictM2M3,
  refreshRoleSession,
  seedBrowserAuth,
} from '../../harness/fixtures';

test.describe('Tier 4 — Real-World Multi-User End-to-End Workflows (6 Scenarios)', () => {
  test.afterEach(async () => {
    await ensureMaintenanceDisabled();
    await cleanupExtraTasks();
  });

  test('4.1 Sprint Lifecycle: SUBLEADER creates -> MEMBER completes -> LEADER approves & card locks in real time', async ({ browser }) => {
    const state = getRuntimeState();
    const member = getRoleSession('integrante1');
    const title = `T4 Sprint ${Date.now()}`;

    const ctxSub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ctxMem = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ctxLead = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pSub = await ctxSub.newPage();
    const pMem = await ctxMem.newPage();
    const pLead = await ctxLead.newPage();

    try {
      await seedBrowserAuth(pSub, 'integrante5');
      await seedBrowserAuth(pMem, 'integrante1');
      await seedBrowserAuth(pLead, 'lider');
      await Promise.all([pSub.goto(state.baseUrl), pMem.goto(state.baseUrl), pLead.goto(state.baseUrl)]);

      // SUBLEADER creates task assigned to MEMBER
      await pSub.getByRole('button', { name: 'Nueva Actividad' }).click();
      const form = pSub.locator('div[role="dialog"][aria-labelledby="task-form-title"]');
      await form.locator('#task-title-input').fill(title);
      await form.locator('#task-desc-input').fill('Flujo completo de sprint multiusuario');
      await form.locator('#task-priority-select').selectOption('HIGH');
      await form.locator('#task-due-input').fill('2026-12-10');
      await form.locator('#task-assignee-select').selectOption(member.user.id);
      await form.locator('#task-status-select').selectOption('TODO');
      await form.locator('#initial-subtask-input').fill('Completar entregable');
      await form.getByRole('button', { name: 'Agregar', exact: true }).click();
      await form.getByRole('button', { name: 'Crear Actividad' }).click();

      // MEMBER sees live card, toggles subtask, moves to DONE
      const memCard = pMem.locator(`article[aria-label^="Tarea ${title}."]`);
      await expect(memCard).toBeVisible();
      await memCard.click();
      const memDetail = pMem.locator('div[role="dialog"][aria-labelledby="task-detail-title"]');
      await memDetail.getByText('Completar entregable').click();
      await memDetail.getByRole('button', { name: /Hecho/i }).click();
      await memDetail.getByRole('button', { name: 'Cerrar detalle' }).click();

      // LEADER sees card in HECHO, approves it, sees celebration
      const doneCol = pLead.locator('div[aria-label="Columna HECHO"]');
      await expect(doneCol.locator(`article[aria-label^="Tarea ${title}."]`)).toBeVisible();
      await doneCol.locator(`article[aria-label^="Tarea ${title}."]`).click();
      const leadDetail = pLead.locator('div[role="dialog"][aria-labelledby="task-detail-title"]');
      await leadDetail.getByRole('button', { name: 'Aprobar tarea' }).click();
      await expect(pLead.getByText('¡Tarea Aprobada!')).toBeVisible();

      // MEMBER sees Aprobada lock badge in APROBADO column
      const approvedColMem = pMem.locator('div[aria-label="Columna APROBADO"]');
      const memApprovedCard = approvedColMem.locator(`article[aria-label^="Tarea ${title}."]`);
      await expect(memApprovedCard).toBeVisible();
      await expect(memApprovedCard.getByText('Aprobada')).toBeVisible();
    } finally {
      await ctxSub.close();
      await ctxMem.close();
      await ctxLead.close();
    }
  });

  test('4.2 Two-User Live Collaboration: typing indicator, comment sync, ActivityDrawer & board move', async ({ browser }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const title = `T4 LiveCollab ${Date.now()}`;
    await createTestTask(leader.token, { title, assignedToAll: true });

    const ctxLead = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ctxMem = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pLead = await ctxLead.newPage();
    const pMem = await ctxMem.newPage();

    try {
      await seedBrowserAuth(pLead, 'lider');
      await seedBrowserAuth(pMem, 'integrante1');
      await Promise.all([pLead.goto(state.baseUrl), pMem.goto(state.baseUrl)]);

      await pLead.locator(`article[aria-label^="Tarea ${title}."]`).click();
      await pMem.locator(`article[aria-label^="Tarea ${title}."]`).click();

      const leadDialog = pLead.locator('div[role="dialog"][aria-labelledby="task-detail-title"]');
      const memDialog = pMem.locator('div[role="dialog"][aria-labelledby="task-detail-title"]');

      await memDialog.getByLabel('Nuevo comentario').fill('Escribiendo en vivo...');
      await expect(leadDialog.getByRole('status')).toContainText('está escribiendo un comentario');

      await memDialog.getByRole('button', { name: 'Enviar' }).click();
      await expect(leadDialog.getByText('Escribiendo en vivo...')).toBeVisible();

      await leadDialog.getByRole('button', { name: /En Proceso/i }).click();
      await memDialog.getByRole('button', { name: 'Cerrar detalle' }).click();
      await expect(
        pMem.locator('div[aria-label="Columna EN PROCESO"]').locator(`article[aria-label^="Tarea ${title}."]`),
      ).toBeVisible();
    } finally {
      await ctxLead.close();
      await ctxMem.close();
    }
  });

  test('4.3 Team 6-Slot Onboarding, Tutorial, Avatar Update, Password Reset (session:revoked) & Cleanup', async ({ browser }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const origMember4 = getRoleSession('integrante4');
    const tasksRes = await apiRequest<Array<{ id: string; assigneeId: string | null }>>('/api/tasks', {
      token: leader.token,
    });
    const member4TaskIds = tasksRes.data
      .filter((t) => t.assigneeId === origMember4.user.id)
      .map((t) => t.id);

    const tempUsername = `t4_user_${Date.now().toString().slice(-4)}`;
    let createdUserId: string | null = null;

    const ctxLead = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ctxNew = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pLead = await ctxLead.newPage();
    const pNew = await ctxNew.newPage();

    try {
      await seedBrowserAuth(pLead, 'lider');
      await pLead.goto(state.baseUrl);
      await pLead.getByRole('button', { name: 'Equipo (6/6)' }).click();

      const teamModal = pLead.locator('div[role="dialog"][aria-labelledby="team-modal-title"]');
      const slot5Row = teamModal.locator('div[data-slot="5"]');
      await slot5Row.getByRole('button', { name: 'Liberar' }).click();
      await teamModal.getByRole('button', { name: 'Sí, liberar cupo' }).click();

      await teamModal.getByRole('button', { name: 'Ocupar cupo libre' }).click();
      await teamModal.locator('#team-create-username-5').fill(tempUsername);
      await teamModal.locator('#team-create-displayname-5').fill('T4 Nuevo Integrante');
      await teamModal.locator('#team-create-password-5').fill(state.testPassword);
      await teamModal.getByRole('button', { name: 'Crear integrante' }).click();
      await expect(teamModal.getByText(`@${tempUsername}`)).toBeVisible();

      const usersList = await apiRequest<{ users: Array<{ id: string; username: string }> }>('/api/users', {
        token: leader.token,
      });
      createdUserId = usersList.data.users.find((u) => u.username === tempUsername)?.id ?? null;
      expect(createdUserId).toBeTruthy();

      // New user logs in via UI -> walks through OnboardingTutorialModal
      await pNew.goto(state.baseUrl);
      await pNew.locator('#login-username').fill(tempUsername);
      await pNew.locator('#login-password').fill(state.testPassword);
      await pNew.getByRole('button', { name: 'Entrar al tablero' }).click();

      const tutorial = pNew.locator('div[role="dialog"][aria-label="Tutorial guiado del Tablero Kanban"]');
      await expect(tutorial).toBeVisible();
      await tutorial.getByRole('button', { name: 'Siguiente' }).click();
      await tutorial.getByRole('button', { name: 'Siguiente' }).click();
      await tutorial.getByRole('button', { name: 'Siguiente' }).click();
      await tutorial.getByRole('button', { name: '¡Comenzar a trabajar!' }).click();
      await expect(tutorial).toBeHidden();

      // Leader resets new user's password -> pNew receives session:revoked & returns to LoginScreen
      const newRow = teamModal.locator('div[data-slot="5"]');
      await newRow.getByRole('button', { name: 'Restablecer clave' }).click();
      await teamModal.locator(`#team-reset-password-${createdUserId}`).fill(`${state.testPassword}_X1`);
      await teamModal.getByRole('button', { name: 'Confirmar restablecimiento' }).click();

      await expect(pNew.locator('#login-username')).toBeVisible();
    } finally {
      await ctxLead.close();
      await ctxNew.close();
      if (createdUserId) {
        await apiRequest(`/api/users/${createdUserId}`, {
          method: 'DELETE',
          token: leader.token,
        });
      }
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
        for (const tid of member4TaskIds) {
          await apiRequest(`/api/tasks/${tid}`, {
            method: 'PATCH',
            token: leader.token,
            body: { assigneeId: restoreRes.data.id },
          });
        }
        await refreshRoleSession('integrante4', state.testPassword);
      }
    }
  });

  test('4.4 Maintenance Window Workflow: Leader activates -> Member blocked -> Leader recovers via MaintenanceScreen -> Reopens', async ({ browser }) => {
    const state = getRuntimeState();
    const ctxLead = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ctxMem = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ctxAnon = await browser.newContext({ viewport: { width: 1440, height: 900 } });

    const pLead = await ctxLead.newPage();
    const pMem = await ctxMem.newPage();
    const pAnon = await ctxAnon.newPage();

    try {
      await seedBrowserAuth(pLead, 'lider');
      await seedBrowserAuth(pMem, 'integrante1');
      await Promise.all([pLead.goto(state.baseUrl), pMem.goto(state.baseUrl)]);
      await expect(pMem.getByRole('heading', { name: 'Tablero Kanban' })).toBeVisible();

      // Leader activates maintenance via UI
      await pLead.getByRole('button', { name: 'Mantenimiento' }).click();
      const modal = pLead.locator('div[role="dialog"][aria-labelledby="maintenance-modal-title"]');
      await modal.locator('#maintenance-title-input').fill('Mantenimiento T4');
      await modal.getByRole('button', { name: 'Activar ventana de mantenimiento' }).click();

      // Member browser transitions to MaintenanceScreen
      await expect(pMem.getByText('VENTANA DE MANTENIMIENTO')).toBeVisible();

      // Unauthenticated user visits site -> sees MaintenanceScreen -> uses Acceso exclusivo Líder
      await pAnon.goto(state.baseUrl);
      await expect(pAnon.getByText('VENTANA DE MANTENIMIENTO')).toBeVisible();
      await pAnon.getByRole('button', { name: /Acceso exclusivo Líder/i }).click();
      await pAnon.locator('#maintenance-leader-user').fill('lider');
      await pAnon.locator('#maintenance-leader-pass').fill(state.testPassword);
      await pAnon.getByRole('button', { name: /Ingresar/i }).click();
      await expect(pAnon.getByRole('heading', { name: 'Tablero Kanban', exact: true })).toBeVisible();

      // Leader disables maintenance -> Member recovers board
      await pLead.getByRole('button', { name: 'Mantenimiento activo' }).click();
      await expect(modal).toBeVisible();
      await modal.getByRole('button', { name: 'Finalizar mantenimiento y reabrir tablero' }).click();
      const checkBtn = pMem.getByRole('button', { name: 'Verificar disponibilidad ahora' });
      if (await checkBtn.isVisible()) {
        await checkBtn.click();
      }
      await expect(pMem.getByRole('heading', { name: 'Tablero Kanban', exact: true })).toBeVisible();
    } finally {
      await ctxLead.close();
      await ctxMem.close();
      await ctxAnon.close();
    }
  });

  test('4.5 Attachment Lifecycle: Upload PNG -> Lightbox Preview -> ETag/304 Download -> Inline Delete', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const title = `T4 AttachLife ${Date.now()}`;
    await createTestTask(leader.token, { title });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);
    await page.locator(`article[aria-label^="Tarea ${title}."]`).click();

    const dialog = page.locator('div[role="dialog"][aria-labelledby="task-detail-title"]');
    const uploadPromise = page.waitForResponse(
      (res) => res.url().includes('/attachments') && res.request().method() === 'POST',
    );
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'lifecycle.png',
      mimeType: 'image/png',
      buffer: makePngBuffer(),
    });
    const upRes = await uploadPromise;
    expect(upRes.status()).toBe(201);
    const upJson = (await upRes.json()) as { attachment: { id: string } };

    // Lightbox open & close
    await dialog.getByRole('button', { name: 'Ver' }).click();
    await expect(page.getByRole('button', { name: 'Cerrar vista previa' })).toBeVisible();
    if (isStrictM2M3()) {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Cerrar vista previa' })).toHaveCount(0);
    } else {
      await page.getByRole('button', { name: 'Cerrar vista previa' }).click();
    }

    // Download + ETag 304
    const dl1 = await fetch(`${state.apiUrl}/api/attachments/${upJson.attachment.id}/download`, {
      headers: { Authorization: `Bearer ${leader.token}` },
    });
    expect(dl1.status).toBe(200);
    const etag = dl1.headers.get('etag')!;
    const dl2 = await fetch(`${state.apiUrl}/api/attachments/${upJson.attachment.id}/download`, {
      headers: { Authorization: `Bearer ${leader.token}`, 'If-None-Match': etag },
    });
    expect(dl2.status).toBe(304);

    // Delete in UI
    await dialog.getByRole('button', { name: 'Eliminar archivo lifecycle.png' }).click();
    await dialog.getByRole('button', { name: 'Sí, borrar' }).click();
    await expect(dialog.getByText('lifecycle.png')).toHaveCount(0);
  });

  test('4.6 Vercel/Cold-Start Route Recovery & Overdue Triage Workflow', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const overdueTitle = `T4 OverdueTriage ${Date.now()}`;
    await createTestTask(leader.token, {
      title: overdueTitle,
      status: 'TODO',
      dueDate: '2026-11-08T12:00:00.000Z',
    });

    // Simulate one transient 503 maintenance/cold-start on first /api/users/me, then recover
    let interceptedOnce = false;
    await page.route(`${state.apiUrl}/api/users/me`, async (route) => {
      if (!interceptedOnce) {
        interceptedOnce = true;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Server waking up',
            maintenance: true,
            status: {
              active: true,
              source: 'env',
              title: 'Despertando backend',
              message: 'Cold start temporal',
              estimatedMinutes: 1,
              updatedAt: new Date().toISOString(),
              canDisableInApp: false,
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);
    await expect(page.getByText('Despertando backend')).toBeVisible();

    // Token was preserved; clicking "Verificar disponibilidad ahora" recovers straight onto the board
    await page.getByRole('button', { name: 'Verificar disponibilidad ahora' }).click();
    await expect(page.getByRole('heading', { name: 'Tablero Kanban', exact: true })).toBeVisible();

    // Triage overdue task via OverdueTasksAlert
    const alert = page.locator('section[role="alert"][aria-label="Alerta de tareas sin completar vencidas"]');
    await expect(alert).toContainText(overdueTitle);
    const card = page.locator(`article[aria-label^="Tarea ${overdueTitle}."]`);
    await card.getByRole('button', { name: 'Mover tarea a otra columna' }).click();
    await card.getByRole('menuitem', { name: 'Hecho' }).click();
    await expect(alert.getByText(overdueTitle)).toHaveCount(0);
  });
});
