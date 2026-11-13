import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  Download,
  Eye,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  HardDrive,
  Loader2,
  MailCheck,
  Paperclip,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '../../lib/api';
import type { AttachmentStorageStats, Task, TaskAttachment } from '../../types/kanban';
import {
  ALLOWED_ATTACHMENT_ACCEPT,
  ALLOWED_ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TASK,
  formatBytes,
  isAllowedAttachmentExtension,
  optimizeFileBeforeUpload,
} from '../../utils/imageOptimizer';

interface TaskAttachmentsSectionProps {
  task: Task;
  attachments: TaskAttachment[];
  loading: boolean;
  storageStats: AttachmentStorageStats | null;
  canUpload: boolean;
  isLeader: boolean;
  currentUserId: string;
  onAttachmentAdded: (attachment: TaskAttachment) => void;
  onAttachmentRemoved: (attachmentId: string) => void;
  onStorageStatsRefresh: () => void;
}

function getExtensionVisual(ext: string) {
  const lower = ext.toLowerCase();
  if (lower === '.png' || lower === '.jpg' || lower === '.jpeg' || lower === '.webp') {
    return {
      icon: FileImage,
      badgeClass: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
    };
  }
  if (lower === '.pdf') {
    return {
      icon: FileText,
      badgeClass: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
    };
  }
  if (lower === '.pptx') {
    return {
      icon: File,
      badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
    };
  }
  if (lower === '.docx' || lower === '.txt') {
    return {
      icon: FileText,
      badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
    };
  }
  if (lower === '.xlsx' || lower === '.csv') {
    return {
      icon: FileSpreadsheet,
      badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    };
  }
  return {
    icon: File,
    badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  };
}

function formatShortDateEs(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function TaskAttachmentsSection({
  task,
  attachments,
  loading,
  storageStats,
  canUpload,
  isLeader,
  currentUserId,
  onAttachmentAdded,
  onAttachmentRemoved,
  onStorageStatsRefresh,
}: TaskAttachmentsSectionProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewModal, setPreviewModal] = useState<{
    attachment: TaskAttachment;
    url: string;
  } | null>(null);

  // Revocar objectURL al cerrar o cambiar la vista previa
  useEffect(() => {
    return () => {
      if (previewModal?.url) {
        URL.revokeObjectURL(previewModal.url);
      }
    };
  }, [previewModal]);

  const closePreview = () => {
    setPreviewModal(null);
  };

  const quotaPct = storageStats && storageStats.quotaBytes > 0
    ? Math.min(100, Math.round((storageStats.storedBytes / storageStats.quotaBytes) * 100))
    : 0;

  const limitReached = attachments.length >= MAX_ATTACHMENTS_PER_TASK;

  const processSelectedFile = async (rawFile: File) => {
    if (!canUpload) return;

    if (!isAllowedAttachmentExtension(rawFile.name)) {
      toast.error(
        `Formato no permitido. Usa: ${ALLOWED_ATTACHMENT_EXTENSIONS.join(', ')}`
      );
      return;
    }

    if (limitReached) {
      toast.error(`Máximo ${MAX_ATTACHMENTS_PER_TASK} archivos por actividad.`);
      return;
    }

    setUploading(true);
    try {
      const optimized = await optimizeFileBeforeUpload(rawFile);

      if (optimized.file.size === 0) {
        toast.error('El archivo seleccionado está vacío.');
        return;
      }

      if (optimized.file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(
          `El archivo pesa ${formatBytes(optimized.file.size)} y el límite máximo es ${formatBytes(MAX_ATTACHMENT_BYTES)}.`
        );
        return;
      }

      const response = await api.uploadTaskAttachment(task.id, optimized.file);
      onAttachmentAdded(response.attachment);
      onStorageStatsRefresh();

      const notes: string[] = [];
      if (optimized.wasOptimized && optimized.savedBytes > 0) {
        notes.push(`optimizado (-${formatBytes(optimized.savedBytes)})`);
      }
      if (response.deduplicated) {
        notes.push('deduplicado en DB (0 B extra)');
      } else if (response.attachment.isCompressed) {
        notes.push(
          `comprimido gzip (${formatBytes(response.attachment.storedBytes)})`
        );
      }

      const suffix = notes.length > 0 ? ` · ${notes.join(', ')}` : '';
      if (response.emailSent) {
        toast.success(`Archivo subido y enviado por correo al líder${suffix}`);
      } else {
        toast.success(`Archivo subido correctamente${suffix}`);
        if (response.emailWarning) {
          toast.warning(`Aviso de correo: ${response.emailWarning}`);
        }
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo subir el archivo';
      toast.error(msg);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void processSelectedFile(file);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    if (!canUpload || uploading || limitReached) return;
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void processSelectedFile(file);
    }
  };

  const handleDownload = async (attachment: TaskAttachment) => {
    setDownloadingId(attachment.id);
    try {
      const blob = await api.fetchAttachmentBlob(attachment.id, false);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.originalName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo descargar el archivo';
      toast.error(msg);
    } finally {
      setDownloadingId(null);
    }
  };

  const handlePreview = async (attachment: TaskAttachment) => {
    if (!attachment.isPreviewableImage) return;
    setPreviewingId(attachment.id);
    try {
      const blob = await api.fetchAttachmentBlob(attachment.id, true);
      const url = URL.createObjectURL(blob);
      setPreviewModal({ attachment, url });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo previsualizar la imagen';
      toast.error(msg);
    } finally {
      setPreviewingId(null);
    }
  };

  const handleDelete = async (attachment: TaskAttachment) => {
    setDeletingId(attachment.id);
    try {
      const res = await api.deleteTaskAttachment(attachment.id);
      onAttachmentRemoved(attachment.id);
      onStorageStatsRefresh();
      setConfirmDeleteId(null);
      const freedText =
        res.removedBlob && res.freedBytes > 0
          ? ` (${formatBytes(res.freedBytes)} liberados de la DB)`
          : '';
      toast.success(`Archivo eliminado${freedText}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo eliminar el archivo';
      toast.error(msg);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            Archivos adjuntos ({attachments.length}/{MAX_ATTACHMENTS_PER_TASK})
          </h3>
        </div>

        {storageStats ? (
          <div
            title={`Uso real en DB: ${formatBytes(storageStats.storedBytes)} de ${formatBytes(storageStats.quotaBytes)} (${storageStats.uniqueBlobs} bloques únicos). Ahorro acumulado por dedup/gzip: ${formatBytes(storageStats.savedBytes)}`}
            className="inline-flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            <HardDrive className="h-3.5 w-3.5 text-slate-500" />
            <span>
              DB: <strong className="font-semibold">{formatBytes(storageStats.storedBytes)}</strong> /{' '}
              {formatBytes(storageStats.quotaBytes)} ({quotaPct}%)
            </span>
            {storageStats.savedBytes > 0 ? (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                -{formatBytes(storageStats.savedBytes)} ahorrados
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Zona de carga */}
      {canUpload ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!uploading && !limitReached) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`rounded-xl border border-dashed p-3 transition ${
            dragging
              ? 'border-blue-500 bg-blue-50/70 dark:border-blue-400 dark:bg-blue-500/10'
              : 'border-slate-300 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/40'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_ATTACHMENT_ACCEPT}
            onChange={handleFileInputChange}
            disabled={uploading || limitReached}
            className="hidden"
          />

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-0.5">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {limitReached
                  ? 'Límite de 10 archivos alcanzado en esta actividad'
                  : 'Arrastra un archivo aquí o selecciónalo desde tu dispositivo'}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Soporta .pdf, .docx, .pptx, .xlsx, .png, .jpg, .webp, .txt, .csv (máx. 5 MB)
              </p>
              <p className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                <MailCheck className="h-3 w-3 shrink-0" />
                Optimización automática + respaldo por correo al líder
              </p>
            </div>

            <button
              type="button"
              disabled={uploading || limitReached}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Subiendo...
                </>
              ) : (
                <>
                  <Upload className="h-3.5 w-3.5" />
                  Subir archivo
                </>
              )}
            </button>
          </div>
        </div>
      ) : null}

      {/* Lista de archivos */}
      {loading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          Cargando archivos adjuntos...
        </div>
      ) : attachments.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          No hay archivos adjuntos en esta actividad todavía.
        </p>
      ) : (
        <ul className="space-y-2">
          {attachments.map((att) => {
            const visual = getExtensionVisual(att.extension);
            const IconComponent = visual.icon;
            const canDelete =
              (isLeader || att.uploadedBy?.id === currentUserId) &&
              (task.status !== 'APPROVED' || isLeader);
            const isConfirming = confirmDeleteId === att.id;
            const isDeleting = deletingId === att.id;
            const isDownloading = downloadingId === att.id;
            const isPreviewing = previewingId === att.id;

            return (
              <li
                key={att.id}
                className="flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-2xs dark:border-slate-700/80 dark:bg-slate-800/50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${visual.badgeClass}`}
                  >
                    <IconComponent className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      title={att.originalName}
                      className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100"
                    >
                      {att.originalName}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-mono uppercase">{att.extension.replace('.', '')}</span>
                      <span>· {formatBytes(att.sizeBytes)}</span>
                      {att.isCompressed && att.storedBytes < att.sizeBytes ? (
                        <span className="rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                          {formatBytes(att.storedBytes)} DB
                        </span>
                      ) : null}
                      <span>
                        · por <strong className="font-medium text-slate-700 dark:text-slate-200">{att.uploadedBy?.displayName ?? 'Usuario'}</strong>
                      </span>
                      <span>· {formatShortDateEs(att.createdAt)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                  {att.isPreviewableImage ? (
                    <button
                      type="button"
                      onClick={() => handlePreview(att)}
                      disabled={isPreviewing}
                      title="Ver imagen"
                      className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      {isPreviewing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                      Ver
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => handleDownload(att)}
                    disabled={isDownloading}
                    title="Descargar archivo"
                    className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-50 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300 dark:hover:bg-blue-500/25"
                  >
                    {isDownloading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    Descargar
                  </button>

                  {canDelete ? (
                    isConfirming ? (
                      <div className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-1.5 py-0.5 ring-1 ring-rose-300 dark:bg-rose-950/50 dark:ring-rose-500/40">
                        <button
                          type="button"
                          onClick={() => handleDelete(att)}
                          disabled={isDeleting}
                          className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-900/60"
                        >
                          {isDeleting ? 'Borrando...' : 'Sí, borrar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={isDeleting}
                          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(att.id)}
                        title="Eliminar archivo"
                        aria-label={`Eliminar archivo ${att.originalName}`}
                        className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Lightbox de vista previa de imagen */}
      {previewModal ? (
        <div
          onClick={closePreview}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 text-white">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{previewModal.attachment.originalName}</p>
                <p className="text-[11px] text-slate-400">
                  {formatBytes(previewModal.attachment.sizeBytes)} · Subido por{' '}
                  {previewModal.attachment.uploadedBy?.displayName ?? 'Usuario'}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleDownload(previewModal.attachment)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <Download className="h-3.5 w-3.5" />
                  Descargar
                </button>
                <button
                  type="button"
                  onClick={closePreview}
                  aria-label="Cerrar vista previa"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-center overflow-auto bg-slate-950 p-3">
              <img
                src={previewModal.url}
                alt={previewModal.attachment.originalName}
                className="max-h-[75vh] w-auto rounded-lg object-contain"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
