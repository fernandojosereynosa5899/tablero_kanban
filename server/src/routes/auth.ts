import { Router } from 'express';
import {
  clearFailedLoginAttempts,
  getClientIp,
  isLoginLocked,
  loginIpLimiter,
  recordFailedLoginAttempt,
} from '../middleware/rateLimit';
import { prisma } from '../prisma';
import { signAuthToken, verifyDummyPassword, verifyPassword } from '../services/authService';
import { getMaintenanceStatus } from '../services/maintenanceService';
import { recordSecurityEvent } from '../services/securityService';
import { toUserPublic } from '../types/domain';
import { loginSchema, normalizeUsername } from '../utils/validation';

export const authRouter = Router();

authRouter.post('/login', loginIpLimiter, async (req, res, next) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    const normalized = normalizeUsername(username);
    const ip = getClientIp(req);

    const lockState = isLoginLocked(ip, normalized);
    if (lockState.locked) {
      await recordSecurityEvent({
        username: normalized,
        eventType: 'failed_login_lockout',
        details: { retryAfterSec: lockState.retryAfterSec },
        ip,
      });
      res.setHeader('Retry-After', String(lockState.retryAfterSec));
      res.status(429).json({
        error: 'Demasiados intentos fallidos. Espera unos minutos antes de intentar de nuevo.',
      });
      return;
    }

    const user = await prisma.user.findFirst({
      where: { username: { equals: normalized, mode: 'insensitive' } },
    });

    if (!user) {
      await verifyDummyPassword(password);
      recordFailedLoginAttempt(ip, normalized);
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      recordFailedLoginAttempt(ip, normalized);
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    clearFailedLoginAttempts(ip, normalized);

    const maintenance = await getMaintenanceStatus();
    if (maintenance.active && user.role !== 'LEADER') {
      res.setHeader('Retry-After', '30');
      res.setHeader('Cache-Control', 'no-store');
      res.status(503).json({
        error: maintenance.message,
        maintenance: true,
        status: maintenance,
      });
      return;
    }

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'auth.login',
        details: { username: user.username },
      },
    });

    const token = signAuthToken(user);
    res.status(200).json({ token, user: toUserPublic(user) });
  } catch (err) {
    next(err);
  }
});
