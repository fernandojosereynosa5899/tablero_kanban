import './setup-env';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { Role, TaskStatus, type User } from '@prisma/client';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import { prisma } from '../src/prisma';
import { emitEvent, resetRealtimeHooks, revokeUserSession } from '../src/realtime/bus';
import { setupSocketIO } from '../src/realtime/socket';
import { signAuthToken } from '../src/services/authService';
import { resetMaintenanceCacheForTests, setMaintenanceEnvOverrideForTests } from '../src/services/maintenanceService';
import { DEFAULT_AVATAR } from '../src/types/domain';

function makeUser(id: string, role: Role, username: string): User {
  return {
    id,
    slot: role === Role.LEADER ? 1 : 2,
    username,
    displayName: username,
    passwordHash: 'hash',
    role,
    avatar: { ...DEFAULT_AVATAR },
    tokenVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function signToken(user: User): string {
  return signAuthToken(user);
}

function connectSocket(baseUrl: string, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createSocketClient(baseUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Socket connect timeout'));
    }, 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(err);
    });
  });
}

describe('Socket.IO maintenance & revocation hardening', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
    setMaintenanceEnvOverrideForTests(null);
    resetMaintenanceCacheForTests();
    resetRealtimeHooks();
  });

  function setupTestServer(users: User[]) {
    const userMap = new Map(users.map((u) => [u.id, u]));
    const origUserFindUnique = prisma.user.findUnique;
    const origCfgFindUnique = prisma.systemConfig.findUnique;
    (prisma.user as { findUnique: unknown }).findUnique = async ({ where }: { where: { id: string } }) =>
      userMap.get(where.id) ?? null;
    (prisma.systemConfig as { findUnique: unknown }).findUnique = async () => null;
    cleanups.push(() => {
      (prisma.user as { findUnique: unknown }).findUnique = origUserFindUnique;
      (prisma.systemConfig as { findUnique: unknown }).findUnique = origCfgFindUnique;
    });

    const httpServer = http.createServer();
    const io = setupSocketIO(httpServer);

    cleanups.push(async () => {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      if (httpServer.listening) {
        httpServer.closeIdleConnections?.();
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      }
    });

    return { httpServer, io };
  }

  it('blocks comment:typing for non-LEADER when maintenance is active', async () => {
    const leader = makeUser('leader-1', Role.LEADER, 'lider');
    const member = makeUser('member-1', Role.MEMBER, 'integrante1');
    setMaintenanceEnvOverrideForTests({ enabled: false });
    resetMaintenanceCacheForTests();

    const { httpServer } = setupTestServer([leader, member]);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

    const leaderSock = await connectSocket(baseUrl, signToken(leader));
    const memberSock = await connectSocket(baseUrl, signToken(member));
    cleanups.push(() => {
      leaderSock.disconnect();
      memberSock.disconnect();
    });

    let typingReceivedCount = 0;
    leaderSock.on('comment:typing', () => {
      typingReceivedCount += 1;
    });

    // Enable maintenance via env override -> member comment:typing must be ignored
    setMaintenanceEnvOverrideForTests({ enabled: true, message: 'En mantenimiento' });
    resetMaintenanceCacheForTests();

    memberSock.emit('comment:typing', { taskId: 'task_1234', isTyping: true });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(typingReceivedCount, 0);
  });

  it('delivers session:revoked before disconnecting socket and removes user from presence', async () => {
    const leader = makeUser('leader-1', Role.LEADER, 'lider');
    const member = makeUser('member-1', Role.MEMBER, 'integrante1');
    setMaintenanceEnvOverrideForTests({ enabled: false });
    resetMaintenanceCacheForTests();

    const { httpServer } = setupTestServer([leader, member]);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

    const leaderSock = await connectSocket(baseUrl, signToken(leader));
    const memberSock = await connectSocket(baseUrl, signToken(member));
    cleanups.push(() => {
      leaderSock.disconnect();
      memberSock.disconnect();
    });

    const events: string[] = [];
    let revokedPayload: { reason?: string } | null = null;

    const memberDisconnected = new Promise<void>((resolve) => {
      memberSock.once('disconnect', () => {
        events.push('disconnect');
        resolve();
      });
    });

    memberSock.on('session:revoked', (payload: { reason?: string }) => {
      events.push('session:revoked');
      revokedPayload = payload;
    });

    const presenceUpdated = new Promise<string[]>((resolve) => {
      leaderSock.on('presence:update', (payload: { onlineUserIds: string[] }) => {
        if (!payload.onlineUserIds.includes(member.id)) {
          resolve(payload.onlineUserIds);
        }
      });
    });

    revokeUserSession(member.id, 'Contraseña actualizada');

    // Also verify task:move during the 100ms flush window is rejected immediately
    const moveAck = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      memberSock.emit('task:move', { taskId: 'task_1234', status: TaskStatus.DONE }, resolve);
    });
    assert.equal(moveAck.ok, false);
    assert.match(moveAck.error ?? '', /revocada/i);

    await Promise.all([memberDisconnected, presenceUpdated]);
    assert.deepEqual(events, ['session:revoked', 'disconnect']);
    assert.deepEqual(revokedPayload, { reason: 'Contraseña actualizada' });
    assert.equal(memberSock.connected, false);
  });

  it('maintenance activation emits maintenance:updated, suppresses board events to non-LEADER, and disconnects non-LEADER cleanly', async () => {
    const leader = makeUser('leader-1', Role.LEADER, 'lider');
    const member = makeUser('member-1', Role.MEMBER, 'integrante1');
    setMaintenanceEnvOverrideForTests({ enabled: false });
    resetMaintenanceCacheForTests();

    const { httpServer } = setupTestServer([leader, member]);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

    const leaderSock = await connectSocket(baseUrl, signToken(leader));
    const memberSock = await connectSocket(baseUrl, signToken(member));
    cleanups.push(() => {
      leaderSock.disconnect();
      memberSock.disconnect();
    });

    let memberReceivedMaint = false;
    let memberReceivedBoardTask = false;
    let leaderReceivedBoardTask = false;

    const memberMaintPromise = new Promise<void>((resolve) => {
      memberSock.on('maintenance:updated', (payload: { active: boolean }) => {
        if (payload.active) {
          memberReceivedMaint = true;
          resolve();
        }
      });
    });
    const memberDisconnected = new Promise<void>((resolve) => {
      memberSock.once('disconnect', () => resolve());
    });
    memberSock.on('task:deleted', () => {
      memberReceivedBoardTask = true;
    });
    const leaderTaskPromise = new Promise<void>((resolve) => {
      leaderSock.on('task:deleted', () => {
        leaderReceivedBoardTask = true;
        resolve();
      });
    });

    emitEvent('maintenance:updated', {
      active: true,
      source: 'database',
      canDisableInApp: true,
      title: 'Mantenimiento',
      message: 'En progreso',
      estimatedMinutes: 5,
      updatedByName: 'Líder',
      updatedAt: new Date().toISOString(),
    });

    // Emit board event immediately after maintenance:updated (during the 100ms flush window)
    emitEvent('task:deleted', { id: 'task-999' });

    await Promise.all([memberMaintPromise, memberDisconnected, leaderTaskPromise]);
    assert.equal(memberReceivedMaint, true);
    assert.equal(memberReceivedBoardTask, false);
    assert.equal(leaderReceivedBoardTask, true);
    assert.equal(memberSock.connected, false);
    assert.equal(leaderSock.connected, true);
  });
});
