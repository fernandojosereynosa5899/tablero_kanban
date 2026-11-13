import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { validateIdParam } from '../middleware/security';
import * as attachmentService from '../services/attachmentService';
import { buildContentDisposition, isPreviewableImageExtension } from '../utils/fileValidation';

export const attachmentsRouter = Router();

attachmentsRouter.use(requireAuth);

attachmentsRouter.get('/storage', async (_req, res, next) => {
  try {
    const stats = await attachmentService.getAttachmentStorageStats();
    res.status(200).json(stats);
  } catch (err) {
    next(err);
  }
});

attachmentsRouter.param('id', validateIdParam('id'));

attachmentsRouter.get('/:id/download', async (req, res, next) => {
  try {
    const { attachment, buffer } = await attachmentService.getAttachmentBinary(String(req.params.id));

    if (req.headers['if-none-match'] === `"${attachment.blobSha256}"`) {
      res.status(304).end();
      return;
    }

    const wantsInline = req.query.inline === '1';
    const allowInline = wantsInline && isPreviewableImageExtension(attachment.extension);

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('ETag', `"${attachment.blobSha256}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; sandbox; img-src 'self' data: blob:"
    );
    res.setHeader(
      'Content-Disposition',
      buildContentDisposition(attachment.originalName, allowInline)
    );
    res.status(200).send(buffer);
  } catch (err) {
    next(err);
  }
});

attachmentsRouter.delete('/:id', async (req, res, next) => {
  try {
    const result = await attachmentService.deleteTaskAttachment(req.user!, String(req.params.id));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
