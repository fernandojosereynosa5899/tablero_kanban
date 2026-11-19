import './setup-env';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Priority, Role, TaskStatus, type User } from '@prisma/client';
import { prisma } from '../src/prisma';
import { registerRealtimeHooks, resetRealtimeHooks } from '../src/realtime/bus';
import { deleteTaskAttachment, uploadTaskAttachment } from '../src/services/attachmentService';
import { setGoogleDriveAdapterForTests } from '../src/services/googleDriveService';
import { setMailDispatcherForTests } from '../src/services/mailService';
import { createTask, moveTask, updateSubtask } from '../src/services/taskService';
import { DEFAULT_AVATAR } from '../src/types/domain';
import { HttpError } from '../src/utils/errors';

function makeUser(overrides: Partial<User> & { id: string; role: Role }): User {
  return {
    id: overrides.id,
    slot: overrides.slot ?? 1,
    username: overrides.username ?? `user_${overrides.id}`,
    displayName: overrides.displayName ?? `User ${overrides.id}`,
    passwordHash: 'hash',
    role: overrides.role,
    avatar: overrides.avatar ?? { ...DEFAULT_AVATAR },
    tokenVersion: 1,
    createdAt: new Date('2026-11-10T00:00:00Z'),
    updatedAt: new Date('2026-11-10T00:00:00Z'),
  };
}

const leader = makeUser({ id: 'leader-1', role: Role.LEADER, username: 'lider', displayName: 'Líder' });
const subleader = makeUser({ id: 'subleader-1', role: Role.SUBLEADER, username: 'integrante5', displayName: 'Sublíder' });
const memberA = makeUser({ id: 'member-a', role: Role.MEMBER, username: 'integrante1', displayName: 'Integrante 1' });
const memberB = makeUser({ id: 'member-b', role: Role.MEMBER, username: 'integrante2', displayName: 'Integrante 2' });

function makeTaskRow(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-11-15T12:00:00Z');
  return {
    id: 'task-1',
    title: 'Tarea de prueba',
    description: 'Descripción',
    status: TaskStatus.TODO,
    priority: Priority.MEDIUM,
    dueDate: new Date('2026-11-20T00:00:00Z'),
    position: 1000,
    color: null,
    assigneeId: null as string | null,
    assignedToAll: false,
    createdById: leader.id,
    driveFolderId: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
    assignee: null,
    subtasks: [],
    _count: { comments: 0, attachments: 0 },
    ...overrides,
  };
}

function makeActivityRow(user: User, action: string, taskId: string | null = 'task-1') {
  return {
    id: `act-${Math.random().toString(36).slice(2, 8)}`,
    userId: user.id,
    taskId,
    action,
    details: {},
    createdAt: new Date('2026-11-15T12:00:00Z'),
    user,
  };
}

describe('RBAC Solo lectura / APPROVED & attachment delete ordering', () => {
  const restorers: Array<() => void> = [];

  afterEach(() => {
    while (restorers.length > 0) {
      restorers.pop()?.();
    }
    setGoogleDriveAdapterForTests(null);
    setMailDispatcherForTests(null);
    resetRealtimeHooks();
  });

  function stubMock(target: object, key: string, impl: (...args: any[]) => any) {
    const rec = target as Record<string, unknown>;
    const original = rec[key];
    rec[key] = impl;
    restorers.push(() => {
      rec[key] = original;
    });
  }

  describe('deleteTaskAttachment DB-before-Drive ordering', () => {
    it('commits DB transaction BEFORE calling Drive delete and emits realtime events', async () => {
      const sequence: string[] = [];
      const attachmentRow = {
        id: 'att-1',
        taskId: 'task-1',
        uploadedById: memberA.id,
        storageProvider: 'gdrive',
        driveFileId: 'drive-file-123',
        blobSha256: null,
        originalName: 'doc.pdf',
        task: { id: 'task-1', title: 'Tarea', status: TaskStatus.IN_PROGRESS },
      };

      stubMock(prisma, '$transaction', async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          taskAttachment: {
            findUnique: async () => attachmentRow,
            deleteMany: async () => {
              sequence.push('tx.deleteMany');
              return { count: 1 };
            },
          },
          activityLog: {
            create: async () => {
              sequence.push('tx.activityLog');
              return makeActivityRow(memberA, 'attachment.deleted');
            },
          },
        };
        const out = await fn(tx);
        sequence.push('tx.committed');
        return out;
      });

      setGoogleDriveAdapterForTests({
        isEnabled: () => true,
        uploadFile: async () => {
          throw new Error('unused');
        },
        downloadFile: async () => Buffer.alloc(0),
        deleteFile: async (fileId: string) => {
          assert.equal(fileId, 'drive-file-123');
          sequence.push('drive.deleteFile');
        },
        deleteFolder: async () => {},
        getStorageQuota: async () => null,
      });

      registerRealtimeHooks({
        emitEvent: (ev) => {
          sequence.push(`emit:${ev}`);
        },
      });

      const result = await deleteTaskAttachment(memberA, 'att-1');
      assert.equal(result.ok, true);
      assert.equal(result.removedFromDrive, true);
      assert.deepEqual(sequence, [
        'tx.deleteMany',
        'tx.activityLog',
        'tx.committed',
        'drive.deleteFile',
        'emit:attachment:deleted',
        'emit:activity:new',
      ]);
    });

    it('never calls Drive delete if DB transaction fails or attachment is missing', async () => {
      let driveDeletes = 0;
      const emitted: string[] = [];

      stubMock(prisma, '$transaction', async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          taskAttachment: {
            findUnique: async () => ({
              id: 'att-1',
              taskId: 'task-1',
              uploadedById: memberA.id,
              storageProvider: 'gdrive',
              driveFileId: 'drive-file-123',
              blobSha256: null,
              originalName: 'doc.pdf',
              task: { id: 'task-1', title: 'Tarea', status: TaskStatus.IN_PROGRESS },
            }),
            deleteMany: async () => {
              throw new Error('DB connection lost');
            },
          },
          activityLog: { create: async () => makeActivityRow(memberA, 'attachment.deleted') },
        };
        return fn(tx);
      });

      setGoogleDriveAdapterForTests({
        isEnabled: () => true,
        uploadFile: async () => {
          throw new Error('unused');
        },
        downloadFile: async () => Buffer.alloc(0),
        deleteFile: async () => {
          driveDeletes += 1;
        },
        deleteFolder: async () => {},
        getStorageQuota: async () => null,
      });

      registerRealtimeHooks({
        emitEvent: (ev) => emitted.push(ev),
      });

      await assert.rejects(() => deleteTaskAttachment(memberA, 'att-1'), /DB connection lost/);
      assert.equal(driveDeletes, 0);
      assert.deepEqual(emitted, []);
    });

    it('returns removedFromDrive: false and emits events when post-commit Drive delete fails', async () => {
      const emitted: string[] = [];
      const originalWarn = console.warn;
      console.warn = () => {};
      restorers.push(() => {
        console.warn = originalWarn;
      });

      stubMock(prisma, '$transaction', async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          taskAttachment: {
            findUnique: async () => ({
              id: 'att-1',
              taskId: 'task-1',
              uploadedById: memberA.id,
              storageProvider: 'gdrive',
              driveFileId: 'drive-file-123',
              blobSha256: null,
              originalName: 'doc.pdf',
              task: { id: 'task-1', title: 'Tarea', status: TaskStatus.IN_PROGRESS },
            }),
            deleteMany: async () => ({ count: 1 }),
          },
          activityLog: { create: async () => makeActivityRow(memberA, 'attachment.deleted') },
        };
        return fn(tx);
      });

      setGoogleDriveAdapterForTests({
        isEnabled: () => true,
        uploadFile: async () => {
          throw new Error('unused');
        },
        downloadFile: async () => Buffer.alloc(0),
        deleteFile: async () => {
          throw new HttpError(502, 'Drive timeout');
        },
        deleteFolder: async () => {},
        getStorageQuota: async () => null,
      });

      registerRealtimeHooks({
        emitEvent: (ev) => emitted.push(ev),
      });

      const result = await deleteTaskAttachment(memberA, 'att-1');
      assert.equal(result.ok, true);
      assert.equal(result.removedFromDrive, false);
      assert.deepEqual(emitted, ['attachment:deleted', 'activity:new']);
    });

    it('enforces uploader/LEADER and APPROVED lock on deleteTaskAttachment', async () => {
      let driveDeletes = 0;
      stubMock(prisma.activityLog, 'create', async () => makeActivityRow(memberB, 'security.alert', null));

      setGoogleDriveAdapterForTests({
        isEnabled: () => true,
        uploadFile: async () => {
          throw new Error('unused');
        },
        downloadFile: async () => Buffer.alloc(0),
        deleteFile: async () => {
          driveDeletes += 1;
        },
        deleteFolder: async () => {},
        getStorageQuota: async () => null,
      });

      // Non-uploader SUBLEADER -> 403
      stubMock(prisma, '$transaction', async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          taskAttachment: {
            findUnique: async () => ({
              id: 'att-1',
              taskId: 'task-1',
              uploadedById: memberA.id,
              storageProvider: 'gdrive',
              driveFileId: 'drive-file-123',
              blobSha256: null,
              originalName: 'doc.pdf',
              task: { id: 'task-1', title: 'Tarea', status: TaskStatus.IN_PROGRESS },
            }),
          },
        };
        return fn(tx);
      });

      await assert.rejects(
        () => deleteTaskAttachment(subleader, 'att-1'),
        (err: unknown) => err instanceof HttpError && err.statusCode === 403,
      );

      // Uploader on APPROVED task -> 403
      restorers.pop()?.();
      stubMock(prisma, '$transaction', async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          taskAttachment: {
            findUnique: async () => ({
              id: 'att-1',
              taskId: 'task-1',
              uploadedById: memberA.id,
              storageProvider: 'gdrive',
              driveFileId: 'drive-file-123',
              blobSha256: null,
              originalName: 'doc.pdf',
              task: { id: 'task-1', title: 'Tarea', status: TaskStatus.APPROVED },
            }),
          },
        };
        return fn(tx);
      });

      await assert.rejects(
        () => deleteTaskAttachment(memberA, 'att-1'),
        (err: unknown) => err instanceof HttpError && err.statusCode === 403,
      );
      assert.equal(driveDeletes, 0);

      // LEADER on APPROVED task -> allowed
      restorers.pop()?.();
      stubMock(prisma, '$transaction', async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          taskAttachment: {
            findUnique: async () => ({
              id: 'att-1',
              taskId: 'task-1',
              uploadedById: memberA.id,
              storageProvider: 'gdrive',
              driveFileId: 'drive-file-123',
              blobSha256: null,
              originalName: 'doc.pdf',
              task: { id: 'task-1', title: 'Tarea', status: TaskStatus.APPROVED },
            }),
            deleteMany: async () => ({ count: 1 }),
          },
          activityLog: { create: async () => makeActivityRow(leader, 'attachment.deleted') },
        };
        return fn(tx);
      });

      const res = await deleteTaskAttachment(leader, 'att-1');
      assert.equal(res.ok, true);
      assert.equal(res.removedFromDrive, true);
      assert.equal(driveDeletes, 1);
    });
  });

  describe('Solo lectura & APPROVED RBAC matrix', () => {
    it('moveTask enforces unassigned, other-user, assignedToAll, and APPROVED rules', async () => {
      stubMock(prisma.activityLog, 'create', async () => makeActivityRow(memberA, 'security.alert', null));

      const setupTx = (taskOverrides: Record<string, unknown>) => {
        const row = makeTaskRow(taskOverrides);
        return stubMock(prisma, '$transaction', async (fn: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            task: {
              findUnique: async () => row,
              aggregate: async () => ({ _max: { position: 1000 } }),
              update: async ({ data }: { data: Record<string, unknown> }) => ({
                ...row,
                status: data.status ?? row.status,
                position: data.position ?? row.position,
                approvedAt: data.approvedAt ?? row.approvedAt,
              }),
            },
            activityLog: {
              create: async () => makeActivityRow(leader, 'task.moved'),
            },
          };
          return fn(tx);
        });
      };

      // Unassigned task -> MEMBER & SUBLEADER blocked (403), LEADER allowed
      setupTx({ assigneeId: null, assignedToAll: false, status: TaskStatus.TODO });
      await assert.rejects(
        () => moveTask(memberA, 'task-1', { status: TaskStatus.IN_PROGRESS }),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      await assert.rejects(
        () => moveTask(subleader, 'task-1', { status: TaskStatus.IN_PROGRESS }),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      const leaderMovedUnassigned = await moveTask(leader, 'task-1', { status: TaskStatus.IN_PROGRESS });
      assert.equal(leaderMovedUnassigned.toStatus, TaskStatus.IN_PROGRESS);
      restorers.pop()?.();

      // Task assigned to memberA -> memberB & subleader blocked (403); memberA allowed to DONE, blocked to APPROVED
      setupTx({ assigneeId: memberA.id, assignedToAll: false, status: TaskStatus.IN_PROGRESS });
      await assert.rejects(
        () => moveTask(memberB, 'task-1', { status: TaskStatus.DONE }),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      await assert.rejects(
        () => moveTask(subleader, 'task-1', { status: TaskStatus.DONE }),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      const memberAMoved = await moveTask(memberA, 'task-1', { status: TaskStatus.DONE });
      assert.equal(memberAMoved.toStatus, TaskStatus.DONE);
      await assert.rejects(
        () => moveTask(memberA, 'task-1', { status: TaskStatus.APPROVED }),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      const leaderApproved = await moveTask(leader, 'task-1', { status: TaskStatus.APPROVED });
      assert.equal(leaderApproved.toStatus, TaskStatus.APPROVED);
      restorers.pop()?.();

      // assignedToAll -> memberB & subleader allowed to DONE, blocked to APPROVED
      setupTx({ assigneeId: null, assignedToAll: true, status: TaskStatus.TODO });
      assert.equal((await moveTask(memberB, 'task-1', { status: TaskStatus.DONE })).toStatus, TaskStatus.DONE);
      assert.equal((await moveTask(subleader, 'task-1', { status: TaskStatus.DONE })).toStatus, TaskStatus.DONE);
      await assert.rejects(
        () => moveTask(subleader, 'task-1', { status: TaskStatus.APPROVED }),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      restorers.pop()?.();

      // Already APPROVED -> memberA & subleader blocked (403) even if assigned/assignedToAll; LEADER allowed
      setupTx({ assigneeId: memberA.id, assignedToAll: true, status: TaskStatus.APPROVED });
      await assert.rejects(
        () => moveTask(memberA, 'task-1', { status: TaskStatus.DONE }),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      await assert.rejects(
        () => moveTask(subleader, 'task-1', { status: TaskStatus.DONE }),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      assert.equal((await moveTask(leader, 'task-1', { status: TaskStatus.DONE })).toStatus, TaskStatus.DONE);
    });

    it('updateSubtask enforces Solo lectura AND blocks non-LEADER when task is APPROVED', async () => {
      stubMock(prisma.activityLog, 'create', async () => makeActivityRow(memberA, 'security.alert', null));

      const setupSubtaskTx = (taskOverrides: Record<string, unknown>) => {
        const parentTask = makeTaskRow({
          ...taskOverrides,
          subtasks: [{ id: 'sub-1', taskId: 'task-1', title: 'Sub', done: false, position: 0, createdAt: new Date() }],
        });
        return stubMock(prisma, '$transaction', async (fn: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            subtask: {
              findUnique: async () => ({
                id: 'sub-1',
                taskId: 'task-1',
                title: 'Sub',
                done: false,
                task: {
                  id: 'task-1',
                  title: parentTask.title,
                  status: parentTask.status,
                  assigneeId: parentTask.assigneeId,
                  assignedToAll: parentTask.assignedToAll,
                },
              }),
              update: async ({ data }: { data: Record<string, unknown> }) => ({
                id: 'sub-1',
                taskId: 'task-1',
                title: (data.title as string) ?? 'Sub',
                done: (data.done as boolean) ?? false,
              }),
            },
            activityLog: { create: async () => makeActivityRow(memberA, 'subtask.toggled') },
            task: { findUniqueOrThrow: async () => parentTask },
          };
          return fn(tx);
        });
      };

      // Unassigned non-APPROVED -> MEMBER & SUBLEADER blocked
      setupSubtaskTx({ assigneeId: null, assignedToAll: false, status: TaskStatus.TODO });
      await assert.rejects(
        () => updateSubtask(memberA, 'sub-1', { done: true }),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      await assert.rejects(
        () => updateSubtask(subleader, 'sub-1', { done: true }),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      restorers.pop()?.();

      // Assigned non-APPROVED -> assignee toggles done (200), cannot rename title (403)
      setupSubtaskTx({ assigneeId: memberA.id, assignedToAll: false, status: TaskStatus.DONE });
      const toggled = await updateSubtask(memberA, 'sub-1', { done: true });
      assert.equal(toggled.id, 'task-1');
      await assert.rejects(
        () => updateSubtask(memberA, 'sub-1', { title: 'New' }),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      restorers.pop()?.();

      // Assigned / assignedToAll APPROVED -> MEMBER & SUBLEADER blocked (403), LEADER allowed (200)
      setupSubtaskTx({ assigneeId: memberA.id, assignedToAll: true, status: TaskStatus.APPROVED });
      await assert.rejects(
        () => updateSubtask(memberA, 'sub-1', { done: true }),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      await assert.rejects(
        () => updateSubtask(subleader, 'sub-1', { done: true }),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      const leaderUpdated = await updateSubtask(leader, 'sub-1', { done: true, title: 'Approved edit' });
      assert.equal(leaderUpdated.id, 'task-1');
    });

    it('createTask enforces MEMBER 403, SUBLEADER non-APPROVED only, LEADER full access', async () => {
      stubMock(prisma.activityLog, 'create', async () => makeActivityRow(memberA, 'security.alert', null));
      stubMock(prisma, '$transaction', async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          task: {
            aggregate: async () => ({ _max: { position: 0 } }),
            create: async ({ data }: { data: Record<string, unknown> }) =>
              makeTaskRow({ status: data.status as TaskStatus, title: data.title as string }),
          },
          activityLog: { create: async () => makeActivityRow(subleader, 'task.created') },
        };
        return fn(tx);
      });

      const baseInput = {
        title: 'Nueva actividad',
        description: 'Detalles',
        status: TaskStatus.TODO,
        priority: Priority.MEDIUM,
        dueDate: '2026-11-25',
        assignedToAll: true,
        subtasks: [] as string[],
      };

      await assert.rejects(
        () => createTask(memberA, baseInput),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      await assert.rejects(
        () => createTask(subleader, { ...baseInput, status: TaskStatus.APPROVED }),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      const subCreated = await createTask(subleader, baseInput);
      assert.equal(subCreated.status, TaskStatus.TODO);
      const leaderCreated = await createTask(leader, { ...baseInput, status: TaskStatus.APPROVED });
      assert.equal(leaderCreated.status, TaskStatus.APPROVED);
    });

    it('uploadTaskAttachment enforces Solo lectura and APPROVED rules', async () => {
      stubMock(prisma.activityLog, 'create', async () => makeActivityRow(memberA, 'security.alert', null));
      setMailDispatcherForTests(async () => ({ sent: false, skipped: true }));

      const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
      const fakeFile = { originalname: 'archivo.pdf', mimetype: 'application/pdf', buffer: pdfBytes };

      // Unassigned non-APPROVED -> MEMBER 403, SUBLEADER succeeds
      stubMock(prisma, '$transaction', async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          task: {
            findUnique: async () => ({
              id: 'task-1',
              title: 'Tarea',
              status: TaskStatus.TODO,
              assigneeId: null,
              assignedToAll: false,
              driveFolderId: null,
              _count: { attachments: 0 },
            }),
          },
          attachmentBlob: {
            findUnique: async () => ({ sha256: 'abc', storedBytes: pdfBytes.length, isCompressed: false }),
          },
          taskAttachment: {
            create: async () => ({
              id: 'att-1',
              taskId: 'task-1',
              uploadedById: subleader.id,
              storageProvider: 'db',
              originalName: 'archivo.pdf',
              extension: '.pdf',
              mimeType: 'application/pdf',
              sizeBytes: pdfBytes.length,
              createdAt: new Date(),
              uploadedBy: subleader,
              blob: { storedBytes: pdfBytes.length, isCompressed: false },
            }),
          },
          activityLog: { create: async () => makeActivityRow(subleader, 'attachment.uploaded') },
        };
        return fn(tx);
      });

      await assert.rejects(
        () => uploadTaskAttachment(memberA, 'task-1', fakeFile),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      const subUploaded = await uploadTaskAttachment(subleader, 'task-1', fakeFile);
      assert.equal(subUploaded.attachment.id, 'att-1');
      restorers.pop()?.();

      // APPROVED task -> MEMBER & SUBLEADER 403, LEADER succeeds
      stubMock(prisma, '$transaction', async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          task: {
            findUnique: async () => ({
              id: 'task-1',
              title: 'Tarea',
              status: TaskStatus.APPROVED,
              assigneeId: memberA.id,
              assignedToAll: true,
              driveFolderId: null,
              _count: { attachments: 0 },
            }),
          },
          attachmentBlob: {
            findUnique: async () => ({ sha256: 'abc', storedBytes: pdfBytes.length, isCompressed: false }),
          },
          taskAttachment: {
            create: async () => ({
              id: 'att-2',
              taskId: 'task-1',
              uploadedById: leader.id,
              storageProvider: 'db',
              originalName: 'archivo.pdf',
              extension: '.pdf',
              mimeType: 'application/pdf',
              sizeBytes: pdfBytes.length,
              createdAt: new Date(),
              uploadedBy: leader,
              blob: { storedBytes: pdfBytes.length, isCompressed: false },
            }),
          },
          activityLog: { create: async () => makeActivityRow(leader, 'attachment.uploaded') },
        };
        return fn(tx);
      });

      await assert.rejects(
        () => uploadTaskAttachment(memberA, 'task-1', fakeFile),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      await assert.rejects(
        () => uploadTaskAttachment(subleader, 'task-1', fakeFile),
        (e: unknown) => e instanceof HttpError && e.statusCode === 403,
      );
      const leaderUploaded = await uploadTaskAttachment(leader, 'task-1', fakeFile);
      assert.equal(leaderUploaded.attachment.id, 'att-2');
    });
  });
});
