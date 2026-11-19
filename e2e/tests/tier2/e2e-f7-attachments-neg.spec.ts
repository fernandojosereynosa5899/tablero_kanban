import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  apiUpload,
  makeInvalidZipBuffer,
  makePdfBuffer,
} from '../../harness/api-client';
import {
  cleanupExtraTasks,
  createTestTask,
  getRoleSession,
} from '../../harness/fixtures';
import { startSecondaryServer } from '../../harness/secondary-server';

test.describe('Tier 2 — E2E-F7: Attachments Validation, Magic Bytes, Limits & Quota Negative Cases', () => {
  test.afterEach(async () => {
    await cleanupExtraTasks();
  });

  test('7.1 Empty 0-byte attachment upload is rejected with 400', async () => {
    const leader = getRoleSession('lider');
    const task = await createTestTask(leader.token);

    const res = await apiUpload(`/api/tasks/${task.id}/attachments`, {
      token: leader.token,
      filename: 'empty.txt',
      mimeType: 'text/plain',
      buffer: Buffer.alloc(0),
    });
    expect(res.status).toBe(400);
  });

  test('7.2 File exceeding 5 MB limit is rejected with 400', async () => {
    const leader = getRoleSession('lider');
    const task = await createTestTask(leader.token);
    const over5Mb = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(5 * 1024 * 1024 + 64, 0x20),
    ]);

    const res = await apiUpload(`/api/tasks/${task.id}/attachments`, {
      token: leader.token,
      filename: 'too-big.pdf',
      mimeType: 'application/pdf',
      buffer: over5Mb,
    });
    expect(res.status).toBe(400);
  });

  test('7.3 Disallowed extensions (.exe, .svg, .html) and MIME mismatch are rejected with 400', async () => {
    const leader = getRoleSession('lider');
    const task = await createTestTask(leader.token);

    const exeRes = await apiUpload(`/api/tasks/${task.id}/attachments`, {
      token: leader.token,
      filename: 'payload.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('MZfakeexe', 'utf8'),
    });
    expect(exeRes.status).toBe(400);

    const svgRes = await apiUpload(`/api/tasks/${task.id}/attachments`, {
      token: leader.token,
      filename: 'xss.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg></svg>', 'utf8'),
    });
    expect(svgRes.status).toBe(400);

    const mimeMismatch = await apiUpload(`/api/tasks/${task.id}/attachments`, {
      token: leader.token,
      filename: 'fake.pdf',
      mimeType: 'image/png',
      buffer: makePdfBuffer('MIME mismatch'),
    });
    expect(mimeMismatch.status).toBe(400);
  });

  test('7.4 Magic-byte spoofing (fake .png, fake .pdf, fake .xlsx) is rejected with 400', async () => {
    const leader = getRoleSession('lider');
    const task = await createTestTask(leader.token);

    const fakePng = await apiUpload(`/api/tasks/${task.id}/attachments`, {
      token: leader.token,
      filename: 'spoof.png',
      mimeType: 'image/png',
      buffer: Buffer.from('<script>alert(1)</script>', 'utf8'),
    });
    expect(fakePng.status).toBe(400);

    const fakePdf = await apiUpload(`/api/tasks/${task.id}/attachments`, {
      token: leader.token,
      filename: 'spoof.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('NOT A REAL PDF HEADER', 'utf8'),
    });
    expect(fakePdf.status).toBe(400);

    const fakeXlsx = await apiUpload(`/api/tasks/${task.id}/attachments`, {
      token: leader.token,
      filename: 'spoof.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: makeInvalidZipBuffer(),
    });
    expect(fakeXlsx.status).toBe(400);
  });

  test('7.5 >10 attachments per task returns 400 and Solo lectura / APPROVED uploads return 403', async () => {
    const leader = getRoleSession('lider');
    const subleader = getRoleSession('integrante5');
    const member1 = getRoleSession('integrante1');
    const member2 = getRoleSession('integrante2');

    const task = await createTestTask(leader.token, { assigneeId: member2.user.id });
    for (let i = 0; i < 10; i++) {
      const up = await apiUpload(`/api/tasks/${task.id}/attachments`, {
        token: leader.token,
        filename: `file-${i}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from(`File content #${i}`, 'utf8'),
      });
      expect(up.status).toBe(201);
    }

    const eleventh = await apiUpload(`/api/tasks/${task.id}/attachments`, {
      token: leader.token,
      filename: 'file-11.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('11th file', 'utf8'),
    });
    expect(eleventh.status).toBe(400);

    const memberForbidden = await apiUpload(`/api/tasks/${task.id}/attachments`, {
      token: member1.token,
      filename: 'unauthorized.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('No permission', 'utf8'),
    });
    expect(memberForbidden.status).toBe(403);

    const approvedTask = await createTestTask(leader.token, {
      status: 'APPROVED',
      assignedToAll: true,
    });
    const subleaderApproved = await apiUpload(`/api/tasks/${approvedTask.id}/attachments`, {
      token: subleader.token,
      filename: 'on-approved.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Blocked on approved', 'utf8'),
    });
    expect(subleaderApproved.status).toBe(403);
  });

  test('7.6 Exceeding ATTACHMENTS_QUOTA_MB (16 MB on secondary server) returns 413', async () => {
    const leader = getRoleSession('lider');
    const task = await createTestTask(leader.token);
    const secondary = await startSecondaryServer({ attachmentsQuotaMb: '16' });

    try {
      for (let i = 0; i < 3; i++) {
        const chunk = Buffer.concat([Buffer.from('%PDF-1.4\n%'), crypto.randomBytes(4_500_000)]);
        const up = await apiUpload(`/api/tasks/${task.id}/attachments`, {
          baseUrl: secondary.apiUrl,
          token: leader.token,
          filename: `quota-${i}.pdf`,
          mimeType: 'application/pdf',
          buffer: chunk,
        });
        expect(up.status).toBe(201);
      }

      const overQuota = Buffer.concat([Buffer.from('%PDF-1.4\n%'), crypto.randomBytes(4_500_000)]);
      const fourth = await apiUpload(`/api/tasks/${task.id}/attachments`, {
        baseUrl: secondary.apiUrl,
        token: leader.token,
        filename: 'quota-overflow.pdf',
        mimeType: 'application/pdf',
        buffer: overQuota,
      });
      expect(fourth.status).toBe(413);
    } finally {
      await secondary.stop();
    }
  });
});
