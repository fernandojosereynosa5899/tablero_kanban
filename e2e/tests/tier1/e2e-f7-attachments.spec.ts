import { expect, test } from '@playwright/test';
import {
  apiRequest,
  apiUpload,
  getRuntimeState,
  makePdfBuffer,
  makePngBuffer,
} from '../../harness/api-client';
import {
  cleanupExtraTasks,
  createTestTask,
  getRoleSession,
  seedBrowserAuth,
} from '../../harness/fixtures';

test.describe('Tier 1 — E2E-F7: Attachments, Storage Fallback, Preview & Deduplication', () => {
  test.afterEach(async () => {
    await cleanupExtraTasks();
  });

  test('7.1 Leader uploads PNG attachment via TaskAttachmentsSection UI with DB fallback & MAIL_DISABLED', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const title = `E2E UploadUI ${Date.now()}`;
    await createTestTask(leader.token, { title });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);
    await page.locator(`article[aria-label^="Tarea ${title}."]`).click();

    const dialog = page.locator('div[role="dialog"][aria-labelledby="task-detail-title"]');
    const uploadPromise = page.waitForResponse(
      (res) => res.url().includes('/attachments') && res.request().method() === 'POST',
    );
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'ui-sample.png',
      mimeType: 'image/png',
      buffer: makePngBuffer(),
    });

    const uploadRes = await uploadPromise;
    expect(uploadRes.status()).toBe(201);
    const body = (await uploadRes.json()) as {
      storageProvider: string;
      emailSent: boolean;
      attachment: { originalName: string };
    };
    expect(body.storageProvider).toBe('db');
    expect(body.emailSent).toBe(false);
    await expect(dialog.getByText('ui-sample.png')).toBeVisible();
  });

  test('7.2 Member uploads valid PDF attachment to own assigned non-APPROVED task', async () => {
    const leader = getRoleSession('lider');
    const member = getRoleSession('integrante1');
    const task = await createTestTask(leader.token, { assigneeId: member.user.id });

    const up = await apiUpload<{
      storageProvider: string;
      emailSent: boolean;
      attachment: { id: string; originalName: string };
    }>(`/api/tasks/${task.id}/attachments`, {
      token: member.token,
      filename: 'reporte.pdf',
      mimeType: 'application/pdf',
      buffer: makePdfBuffer('Member PDF'),
    });

    expect(up.status).toBe(201);
    expect(up.data.storageProvider).toBe('db');
    expect(up.data.emailSent).toBe(false);
    expect(up.data.attachment.originalName).toBe('reporte.pdf');
  });

  test('7.3 Image lightbox opens on Ver and authenticated download returns exact bytes + security headers', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const pngBytes = makePngBuffer();
    const title = `E2E Lightbox ${Date.now()}`;
    const task = await createTestTask(leader.token, { title });

    const up = await apiUpload<{ attachment: { id: string } }>(`/api/tasks/${task.id}/attachments`, {
      token: leader.token,
      filename: 'preview-check.png',
      mimeType: 'image/png',
      buffer: pngBytes,
    });
    expect(up.status).toBe(201);
    const attId = up.data.attachment.id;

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);
    await page.locator(`article[aria-label^="Tarea ${title}."]`).click();

    const dialog = page.locator('div[role="dialog"][aria-labelledby="task-detail-title"]');
    await dialog.getByRole('button', { name: 'Ver' }).click();
    await expect(page.getByRole('button', { name: 'Cerrar vista previa' })).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar vista previa' }).click();

    const dlRes = await fetch(`${state.apiUrl}/api/attachments/${attId}/download?inline=1`, {
      headers: { Authorization: `Bearer ${leader.token}` },
    });
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers.get('etag')).toBeTruthy();
    expect(dlRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(dlRes.headers.get('content-security-policy')).toContain('sandbox');
    expect(dlRes.headers.get('content-disposition')).toContain('inline');

    const downloaded = Buffer.from(await dlRes.arrayBuffer());
    expect(downloaded.equals(pngBytes)).toBe(true);
  });

  test('7.4 Conditional download with matching If-None-Match returns 304 Not Modified', async () => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const task = await createTestTask(leader.token);
    const up = await apiUpload<{ attachment: { id: string } }>(`/api/tasks/${task.id}/attachments`, {
      token: leader.token,
      filename: 'etag-test.pdf',
      mimeType: 'application/pdf',
      buffer: makePdfBuffer('ETag Check'),
    });
    const attId = up.data.attachment.id;

    const first = await fetch(`${state.apiUrl}/api/attachments/${attId}/download`, {
      headers: { Authorization: `Bearer ${leader.token}` },
    });
    expect(first.status).toBe(200);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const second = await fetch(`${state.apiUrl}/api/attachments/${attId}/download`, {
      headers: {
        Authorization: `Bearer ${leader.token}`,
        'If-None-Match': etag!,
      },
    });
    expect(second.status).toBe(304);
  });

  test('7.5 Identical file uploaded to two tasks is SHA-256 deduplicated in DB storage', async () => {
    const leader = getRoleSession('lider');
    const taskA = await createTestTask(leader.token);
    const taskB = await createTestTask(leader.token);
    const sharedBuf = makePdfBuffer(`Unique Dedup Payload ${Date.now()}`);

    const upA = await apiUpload<{ deduplicated: boolean }>(`/api/tasks/${taskA.id}/attachments`, {
      token: leader.token,
      filename: 'dedup-a.pdf',
      mimeType: 'application/pdf',
      buffer: sharedBuf,
    });
    expect(upA.status).toBe(201);

    const upB = await apiUpload<{ deduplicated: boolean }>(`/api/tasks/${taskB.id}/attachments`, {
      token: leader.token,
      filename: 'dedup-b.pdf',
      mimeType: 'application/pdf',
      buffer: sharedBuf,
    });
    expect(upB.status).toBe(201);
    expect(upB.data.deduplicated).toBe(true);

    const stats = await apiRequest<{ uniqueBlobs: number; totalAttachments: number }>(
      '/api/attachments/storage',
      { token: leader.token },
    );
    expect(stats.status).toBe(200);
    expect(stats.data.totalAttachments).toBeGreaterThanOrEqual(2);
    expect(stats.data.uniqueBlobs).toBeLessThan(stats.data.totalAttachments);
  });

  test('7.6 Deleting attachment via TaskAttachmentsSection UI inline confirmation removes it', async ({ page }) => {
    const state = getRuntimeState();
    const leader = getRoleSession('lider');
    const title = `E2E DelAttach ${Date.now()}`;
    const task = await createTestTask(leader.token, { title });

    await apiUpload(`/api/tasks/${task.id}/attachments`, {
      token: leader.token,
      filename: 'delete-me.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Archivo temporal E2E', 'utf8'),
    });

    await seedBrowserAuth(page, 'lider');
    await page.goto(state.baseUrl);
    await page.locator(`article[aria-label^="Tarea ${title}."]`).click();

    const dialog = page.locator('div[role="dialog"][aria-labelledby="task-detail-title"]');
    await expect(dialog.getByText('delete-me.txt')).toBeVisible();
    await dialog.getByRole('button', { name: 'Eliminar archivo delete-me.txt' }).click();
    await dialog.getByRole('button', { name: 'Sí, borrar' }).click();

    await expect(dialog.getByText('delete-me.txt')).toHaveCount(0);
  });
});
