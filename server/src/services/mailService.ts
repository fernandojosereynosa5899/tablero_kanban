import nodemailer, { type Transporter } from 'nodemailer';
import type { TaskStatus } from '@prisma/client';
import { config } from '../config';
import type { TaskAttachment, UserPublic } from '../types/domain';

export interface AttachmentEmailPayload {
  attachment: TaskAttachment;
  task: {
    id: string;
    title: string;
    status: TaskStatus;
  };
  uploader: UserPublic;
  buffer: Buffer;
}

export interface EmailDispatchResult {
  sent: boolean;
  skipped?: boolean;
  error?: string;
}

type MailDispatcher = (payload: AttachmentEmailPayload) => Promise<EmailDispatchResult>;

let customTestDispatcher: MailDispatcher | null = null;
let cachedTransporter: Transporter | null = null;

export function setMailDispatcherForTests(dispatcher: MailDispatcher | null): void {
  customTestDispatcher = dispatcher;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: 'Por hacer',
  IN_PROGRESS: 'En proceso',
  DONE: 'Hecho',
  APPROVED: 'Aprobado',
};

const ROLE_LABELS: Record<UserPublic['role'], string> = {
  LEADER: 'Líder',
  SUBLEADER: 'Sub-líder',
  MEMBER: 'Integrante',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatBytesCompact(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getTransporter(): Transporter | null {
  if (process.env.MAIL_DISABLED === '1') {
    return null;
  }
  if (!config.smtpUser || !config.smtpPass || !config.mailNotifyTo) {
    return null;
  }
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    });
  }
  return cachedTransporter;
}

export async function verifySmtpConnection(): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) return false;
  await transporter.verify();
  return true;
}

export async function sendAttachmentNotificationEmail(
  payload: AttachmentEmailPayload
): Promise<EmailDispatchResult> {
  if (customTestDispatcher) {
    return customTestDispatcher(payload);
  }

  const transporter = getTransporter();
  if (!transporter) {
    return {
      sent: false,
      skipped: true,
      error: 'Configuración SMTP incompleta o deshabilitada',
    };
  }

  const { attachment, task, uploader, buffer } = payload;
  const statusLabel = STATUS_LABELS[task.status] ?? task.status;
  const roleLabel = ROLE_LABELS[uploader.role] ?? uploader.role;
  const rawSizeLabel = formatBytesCompact(attachment.sizeBytes);
  const storedSizeLabel = formatBytesCompact(attachment.storedBytes);
  const dateLabel = new Date(attachment.createdAt).toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const subject = `[Tablero Kanban] Nuevo archivo de ${uploader.displayName}: ${attachment.originalName}`;

  const text = [
    `Nuevo archivo subido al Tablero Kanban`,
    ``,
    `Subido por: ${uploader.displayName} (@${uploader.username}) — ${roleLabel}`,
    `Actividad: ${task.title}`,
    `Estado actual: ${statusLabel}`,
    `ID de actividad: ${task.id}`,
    `Archivo: ${attachment.originalName}`,
    `Tamaño original: ${rawSizeLabel}`,
    `Tamaño optimizado en DB: ${storedSizeLabel}${attachment.isCompressed ? ' (comprimido gzip)' : ''}`,
    `Fecha: ${dateLabel}`,
    ``,
    `El archivo adjunto se incluye en este correo automáticamente.`,
  ].join('\n');

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #0f172a; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: #1e3a8a; color: #ffffff; padding: 16px 20px;">
        <h2 style="margin: 0; font-size: 16px;">Nuevo archivo adjunto en Tablero Kanban</h2>
        <p style="margin: 4px 0 0; font-size: 12px; color: #bfdbfe;">Respaldo automático de actividad</p>
      </div>
      <div style="padding: 18px 20px; font-size: 14px; line-height: 1.5;">
        <p style="margin-top: 0;">
          <strong>${escapeHtml(uploader.displayName)}</strong>
          (<span style="color: #475569;">@${escapeHtml(uploader.username)} · ${escapeHtml(roleLabel)}</span>)
          subió un archivo a la siguiente actividad:
        </p>
        <table style="width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px;">
          <tr>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; color: #475569; width: 150px;">Actividad</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">${escapeHtml(task.title)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; color: #475569;">Estado</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0;">${escapeHtml(statusLabel)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; color: #475569;">Archivo</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">${escapeHtml(attachment.originalName)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; color: #475569;">Tamaño original</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0;">${escapeHtml(rawSizeLabel)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; color: #475569;">Guardado en DB</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0;">${escapeHtml(storedSizeLabel)}${attachment.isCompressed ? ' (gzip)' : ''}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; color: #475569;">Fecha</td>
            <td style="padding: 6px 8px;">${escapeHtml(dateLabel)}</td>
          </tr>
        </table>
        <p style="margin-bottom: 0; font-size: 12px; color: #64748b;">
          El archivo original viene adjunto en este correo.
        </p>
      </div>
    </div>
  `.trim();

  try {
    await transporter.sendMail({
      from: `"Tablero Kanban Maestría" <${config.smtpUser}>`,
      to: config.mailNotifyTo,
      subject,
      text,
      html,
      attachments: [
        {
          filename: attachment.originalName,
          content: buffer,
          contentType: attachment.mimeType,
        },
      ],
    });
    return { sent: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Error SMTP desconocido';
    console.error('[mailService] Error al enviar notificación de adjunto:', reason);
    return { sent: false, error: reason };
  }
}
