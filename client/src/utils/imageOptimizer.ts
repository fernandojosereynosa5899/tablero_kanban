export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.txt',
  '.csv',
] as const;

export const ALLOWED_ATTACHMENT_ACCEPT = ALLOWED_ATTACHMENT_EXTENSIONS.join(',');
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TASK = 10;

const IMAGE_MAX_DIMENSION = 1600;
const OPTIMIZABLE_IMAGE_MIMES = new Set(['image/jpeg', 'image/webp', 'image/png']);

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx < 0) return '';
  return filename.slice(idx).toLowerCase();
}

export function isAllowedAttachmentExtension(filename: string): boolean {
  const ext = getFileExtension(filename);
  return (ALLOWED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext);
}

function loadBitmapFromFile(file: File): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close?: () => void }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
        close: () => URL.revokeObjectURL(objectUrl),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('No se pudo leer la imagen para optimizarla'));
    };
    img.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

export interface OptimizedUploadResult {
  file: File;
  originalBytes: number;
  finalBytes: number;
  savedBytes: number;
  wasOptimized: boolean;
}

/**
 * Reduce resolución excesiva (>1600px) y recomprime JPEG/WEBP/PNG antes de subir
 * para proteger la cuota de 1 GB en PostgreSQL, conservando siempre la extensión original
 * y el archivo original si la recompresión no reduce al menos 8%.
 */
export async function optimizeFileBeforeUpload(file: File): Promise<OptimizedUploadResult> {
  const originalBytes = file.size;
  const fallback: OptimizedUploadResult = {
    file,
    originalBytes,
    finalBytes: originalBytes,
    savedBytes: 0,
    wasOptimized: false,
  };

  const ext = getFileExtension(file.name);
  const mime =
    file.type ||
    (ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : '');

  if (!OPTIMIZABLE_IMAGE_MIMES.has(mime) || originalBytes < 90 * 1024) {
    return fallback;
  }

  let bitmap: Awaited<ReturnType<typeof loadBitmapFromFile>> | null = null;
  try {
    bitmap = await loadBitmapFromFile(file);
    const maxDim = Math.max(bitmap.width, bitmap.height);
    if (!maxDim || (maxDim <= IMAGE_MAX_DIMENSION && mime === 'image/png' && originalBytes < 450 * 1024)) {
      return fallback;
    }

    const scale = maxDim > IMAGE_MAX_DIMENSION ? IMAGE_MAX_DIMENSION / maxDim : 1;
    const targetW = Math.max(1, Math.round(bitmap.width * scale));
    const targetH = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallback;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    bitmap.draw(ctx, targetW, targetH);

    const quality = mime === 'image/png' ? undefined : 0.82;
    const blob = await canvasToBlob(canvas, mime, quality);
    if (!blob || blob.size >= Math.floor(originalBytes * 0.92)) {
      return fallback;
    }

    const optimizedFile = new File([blob], file.name, {
      type: mime,
      lastModified: file.lastModified,
    });

    return {
      file: optimizedFile,
      originalBytes,
      finalBytes: optimizedFile.size,
      savedBytes: Math.max(0, originalBytes - optimizedFile.size),
      wasOptimized: true,
    };
  } catch {
    return fallback;
  } finally {
    bitmap?.close?.();
  }
}
