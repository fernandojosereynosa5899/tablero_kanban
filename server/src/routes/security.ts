import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getClientIp, securityReportLimiter } from '../middleware/rateLimit';
import {
  buildTamperWarningMessage,
  isKuriUser,
  recordSecurityEvent,
} from '../services/securityService';

const securityReportSchema = z.object({
  eventType: z.enum([
    'devtools_opened',
    'inspect_shortcut',
    'context_menu_blocked',
    'storage_tamper',
    'dom_tamper',
  ]),
  detail: z.string().trim().max(200).optional(),
});

export const securityRouter = Router();

securityRouter.use(requireAuth);

securityRouter.post('/report', securityReportLimiter, async (req, res, next) => {
  try {
    const actor = req.user!;
    const parsed = securityReportSchema.parse(req.body);
    const ip = getClientIp(req);

    await recordSecurityEvent({
      userId: actor.id,
      username: actor.username,
      eventType: parsed.eventType,
      details: parsed.detail ? { detail: parsed.detail } : undefined,
      ip,
    });

    res.status(200).json({
      ok: true,
      isMonitoredTarget: isKuriUser(actor),
      warning: buildTamperWarningMessage(actor),
    });
  } catch (err) {
    next(err);
  }
});
