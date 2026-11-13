import path from 'node:path';
import { TextDecoder } from 'node:util';
import { HttpError } from './errors';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB por archivo
export const MAX_ATTACHMENTS_PER_TASK = 10;

export interface AllowedAttachmentSpec {
  extension: string;
  canonicalMime: string;
  acceptedMimes: ReadonlySet<string>;
  kind: 'pdf' | 'ooxml' | 'png' | 'jpg' | 'webp' | 'text';
  ooxmlMarker?: string;
  isPreviewableImage: boolean;
}

const SPECS: Record<string, AllowedAttachmentSpec> = {
  '.pdf': {
    extension: '.pdf',
    canonicalMime: 'application/pdf',
    acceptedMimes: new Set(['application/pdf', 'application/x-pdf']),
    kind: 'pdf',
    isPreviewableImage: false,
  },
  '.docx': {
    extension: '.docx',
    canonicalMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    acceptedMimes: new Set([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ]),
    kind: 'ooxml',
    ooxmlMarker: 'word/',
    isPreviewableImage: false,
  },
  '.pptx': {
    extension: '.pptx',
    canonicalMime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    acceptedMimes: new Set([
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
    ]),
    kind: 'ooxml',
    ooxmlMarker: 'ppt/',
    isPreviewableImage: false,
  },
  '.xlsx': {
    extension: '.xlsx',
    canonicalMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    acceptedMimes: new Set([
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ]),
    kind: 'ooxml',
    ooxmlMarker: 'xl/',
    isPreviewableImage: false,
  },
  '.png': {
    extension: '.png',
    canonicalMime: 'image/png',
    acceptedMimes: new Set(['image/png']),
    kind: 'png',
    isPreviewableImage: true,
  },
  '.jpg': {
    extension: '.jpg',
    canonicalMime: 'image/jpeg',
    acceptedMimes: new Set(['image/jpeg', 'image/jpg', 'image/pjpeg']),
    kind: 'jpg',
    isPreviewableImage: true,
  },
  '.jpeg': {
    extension: '.jpeg',
    canonicalMime: 'image/jpeg',
    acceptedMimes: new Set(['image/jpeg', 'image/jpg', 'image/pjpeg']),
    kind: 'jpg',
    isPreviewableImage: true,
  },
  '.webp': {
    extension: '.webp',
    canonicalMime: 'image/webp',
    acceptedMimes: new Set(['image/webp']),
    kind: 'webp',
    isPreviewableImage: true,
  },
  '.txt': {
    extension: '.txt',
    canonicalMime: 'text/plain; charset=utf-8',
    acceptedMimes: new Set(['text/plain']),
    kind: 'text',
    isPreviewableImage: false,
  },
  '.csv': {
    extension: '.csv',
    canonicalMime: 'text/csv; charset=utf-8',
    acceptedMimes: new Set(['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain']),
    kind: 'text',
    isPreviewableImage: false,
  },
};

export const ALLOWED_EXTENSIONS_LABEL = Object.keys(SPECS).join(', ');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ZIP_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const utf8FatalDecoder = new TextDecoder('utf-8', { fatal: true });

export function sanitizeAttachmentFilename(rawName: string, fallbackExt: string): string {
  const baseName = path.basename(rawName || 'archivo').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_');
  const parsed = path.parse(baseName);
  const cleanStem = parsed.name.replace(/\s+/g, ' ').trim().replace(/^\.+/, '') || 'archivo';
  const safeStem = cleanStem.slice(0, 96);
  const ext = (parsed.ext || fallbackExt).toLowerCase();
  return `${safeStem}${ext}`;
}

export function buildContentDisposition(filename: string, inline: boolean): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\;]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  const mode = inline ? 'inline' : 'attachment';
  return `${mode}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function hasValidMagicBytes(buffer: Buffer, spec: AllowedAttachmentSpec): boolean {
  if (buffer.length === 0) return false;

  switch (spec.kind) {
    case 'pdf': {
      let start = 0;
      if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        start = 3;
      }
      const head = buffer.subarray(start, start + 32).toString('latin1').trimStart();
      return head.startsWith('%PDF-');
    }
    case 'png':
      return buffer.length >= PNG_SIG.length && buffer.subarray(0, PNG_SIG.length).equals(PNG_SIG);
    case 'jpg':
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'webp':
      return (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    case 'ooxml': {
      if (buffer.length < 30 || !buffer.subarray(0, 4).equals(ZIP_SIG)) {
        return false;
      }
      const hasContentTypes = buffer.includes('[Content_Types].xml');
      const hasModuleMarker = spec.ooxmlMarker ? buffer.includes(spec.ooxmlMarker) : true;
      return hasContentTypes && hasModuleMarker;
    }
    case 'text': {
      if (buffer.includes(0x00)) return false;
      try {
        utf8FatalDecoder.decode(buffer);
        return true;
      } catch {
        return false;
      }
    }
  }
}

export interface ValidatedAttachmentInput {
  originalName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
  isPreviewableImage: boolean;
}

export function validateAttachmentUpload(file: {
  originalname: string;
  mimetype?: string;
  buffer: Buffer;
}): ValidatedAttachmentInput {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new HttpError(400, 'Archivo adjunto inválido o ausente');
  }
  if (file.buffer.length === 0) {
    throw new HttpError(400, 'El archivo está vacío');
  }
  if (file.buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new HttpError(400, 'El archivo supera el límite máximo de 5 MB');
  }

  const ext = path.extname(file.originalname || '').toLowerCase();
  const spec = SPECS[ext];
  if (!spec) {
    throw new HttpError(
      400,
      `Formato no permitido (${ext || 'sin extensión'}). Formatos aceptados: ${ALLOWED_EXTENSIONS_LABEL}`
    );
  }

  const normalizedMime = (file.mimetype || '').split(';')[0].trim().toLowerCase();
  if (
    normalizedMime &&
    normalizedMime !== 'application/octet-stream' &&
    normalizedMime !== 'binary/octet-stream' &&
    !spec.acceptedMimes.has(normalizedMime)
  ) {
    throw new HttpError(
      400,
      `El tipo MIME recibido (${normalizedMime}) no coincide con la extensión ${spec.extension}`
    );
  }

  if (!hasValidMagicBytes(file.buffer, spec)) {
    throw new HttpError(
      400,
      `El contenido real del archivo no corresponde a un archivo ${spec.extension.toUpperCase()} válido`
    );
  }

  return {
    originalName: sanitizeAttachmentFilename(file.originalname, spec.extension),
    extension: spec.extension,
    mimeType: spec.canonicalMime,
    sizeBytes: file.buffer.length,
    buffer: file.buffer,
    isPreviewableImage: spec.isPreviewableImage,
  };
}

export function isPreviewableImageExtension(ext: string): boolean {
  return Boolean(SPECS[ext.toLowerCase()]?.isPreviewableImage);
}
