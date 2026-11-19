import { expect, test } from '@playwright/test';
import { apiRequest } from '../../harness/api-client';
import { getRoleSession, isStrictM2M3 } from '../../harness/fixtures';

test.describe('Tier 2 — E2E-F9: Team Slots, RBAC, Avatar & Password Policy Negative Cases', () => {
  test('9.1 POST /api/users when all 6 team slots are occupied returns 409', async () => {
    const leader = getRoleSession('lider');
    const res = await apiRequest('/api/users', {
      method: 'POST',
      token: leader.token,
      body: {
        username: 'slot7_overflow',
        displayName: 'Seventh User',
        password: 'ValidPassword1!',
      },
    });
    expect(res.status).toBe(409);
  });

  test('9.2 POST /api/users rejects duplicate username (409) and invalid username characters (400)', async () => {
    const leader = getRoleSession('lider');
    const dup = await apiRequest('/api/users', {
      method: 'POST',
      token: leader.token,
      body: {
        username: 'LIDER',
        displayName: 'Duplicate Leader',
        password: 'ValidPassword1!',
      },
    });
    expect(dup.status).toBe(409);

    const invalidChars = await apiRequest('/api/users', {
      method: 'POST',
      token: leader.token,
      body: {
        username: 'Invalid User!',
        displayName: 'Bad Username',
        password: 'ValidPassword1!',
      },
    });
    expect(invalidChars.status).toBe(400);
  });

  test('9.3 SUBLEADER and MEMBER cannot create, update, or delete team users (403)', async () => {
    const subleader = getRoleSession('integrante5');
    const member = getRoleSession('integrante1');
    const target = getRoleSession('integrante2');

    for (const actor of [subleader, member]) {
      const createRes = await apiRequest('/api/users', {
        method: 'POST',
        token: actor.token,
        body: {
          username: 'unauth_user',
          displayName: 'Unauthorized',
          password: 'Password123',
        },
      });
      expect(createRes.status).toBe(403);

      const patchRes = await apiRequest(`/api/users/${target.user.id}`, {
        method: 'PATCH',
        token: actor.token,
        body: { displayName: 'Tampered Name' },
      });
      expect(patchRes.status).toBe(403);

      const delRes = await apiRequest(`/api/users/${target.user.id}`, {
        method: 'DELETE',
        token: actor.token,
      });
      expect(delRes.status).toBe(403);
    }
  });

  test('9.4 LEADER cannot delete themselves via DELETE /api/users/:id (403)', async () => {
    const leader = getRoleSession('lider');
    const res = await apiRequest(`/api/users/${leader.user.id}`, {
      method: 'DELETE',
      token: leader.token,
    });
    expect(res.status).toBe(403);
  });

  test('9.5 Password & avatar policy rejects wrong currentPassword, weak passwords, and invalid avatar colors', async () => {
    const member = getRoleSession('integrante1');

    const wrongCur = await apiRequest('/api/users/me/password', {
      method: 'PATCH',
      token: member.token,
      body: {
        currentPassword: 'NotTheRealPassword1!',
        newPassword: 'NewValidPassword9!',
      },
    });
    expect(wrongCur.status).toBe(400);

    const tooShort = await apiRequest('/api/users/me/password', {
      method: 'PATCH',
      token: member.token,
      body: {
        currentPassword: 'ignored',
        newPassword: 'Ab1',
      },
    });
    expect(tooShort.status).toBe(400);

    const noDigit = await apiRequest('/api/users/me/password', {
      method: 'PATCH',
      token: member.token,
      body: {
        currentPassword: 'ignored',
        newPassword: 'OnlyLettersPassword',
      },
    });
    expect(noDigit.status).toBe(400);

    const badAvatar = await apiRequest('/api/users/me', {
      method: 'PATCH',
      token: member.token,
      body: {
        avatar: {
          preset: 'gato',
          bg: 'not-a-hex',
          color: '#FFFFFF',
          accessory: 'invalid-accessory',
        },
      },
    });
    expect(badAvatar.status).toBe(400);

    if (isStrictM2M3()) {
      // M2/M3 unified password policy: createUser also rejects <8 char or weak password if unified
      const leader = getRoleSession('lider');
      const weakCreate = await apiRequest('/api/users', {
        method: 'POST',
        token: leader.token,
        body: {
          username: 'weak_pw_check',
          displayName: 'Weak Pw',
          password: '123',
        },
      });
      expect(weakCreate.status).toBe(400);
    }
  });
});
