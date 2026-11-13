import nodemailer, { type Transporter } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import type { TaskStatus } from '@prisma/client';
import { config } from '../config';
import type { TaskAttachment, UserPublic } from '../types/domain';
import {
  fetchWithGoogleAuth,
  getGoogleAccessToken,
  isGoogleOAuthConfigured,
} from './googleAuthService';

export interface AttachmentEmailPayload {
  attachment: TaskAttachment;
  task: {
    id: string;
    title: string;
    status: TaskStatus;
  };
  uploader: UserPublic;
  buffer: Buffer;
  driveWebViewLink?: string | null;
  storageProvider?: 'gdrive' | 'db';
}

export interface EmailDispatchResult {
  sent: boolean;
  skipped?: boolean;
  provider?: 'gmail_api' | 'smtp';
  error?: string;
}

type MailDispatcher = (payload: AttachmentEmailPayload) => Promise<EmailDispatchResult>;

const GMAIL_UPLOAD_SEND_URL =
  'https://www.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media';

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

function resolveRecipient(): string {
  return (config.mailNotifyTo || config.smtpUser).trim();
}

function getTransporter(): Transporter | null {
  if (process.env.MAIL_DISABLED === '1') {
    return null;
  }
  const recipient = resolveRecipient();
  if (!config.smtpUser || !config.smtpPass || !recipient) {
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

/**
 * Verifica el transporte de correo activo (Gmail REST API OAuth2 si está configurado
 * o respaldo SMTP con Nodemailer).
 */
export async function verifyMailConnection(): Promise<boolean> {
  if (process.env.MAIL_DISABLED === '1') {
    return false;
  }
  if (!resolveRecipient()) {
    return false;
  }
  if (isGoogleOAuthConfigured()) {
    await getGoogleAccessToken();
    return true;
  }
  return verifySmtpConnection();
}

function sanitizeSafeHttpsUrl(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^https:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function resolveStorageProvider(payload: AttachmentEmailPayload): 'gdrive' | 'db' {
  if (payload.storageProvider === 'gdrive' || payload.storageProvider === 'db') {
    return payload.storageProvider;
  }
  const attachmentProvider = (
    payload.attachment as { storageProvider?: 'gdrive' | 'db' }
  ).storageProvider;
  if (attachmentProvider === 'gdrive' || attachmentProvider === 'db') {
    return attachmentProvider;
  }
  return payload.driveWebViewLink ? 'gdrive' : 'db';
}

interface AttachmentMailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

function buildAttachmentMailMessage(
  payload: AttachmentEmailPayload,
  fromAddress: string,
  recipient: string
): AttachmentMailMessage {
  const { attachment, task, uploader, buffer } = payload;
  const storageProvider = resolveStorageProvider(payload);
  const safeDriveLink = sanitizeSafeHttpsUrl(payload.driveWebViewLink);

  const statusLabel = STATUS_LABELS[task.status] ?? task.status;
  const roleLabel = ROLE_LABELS[uploader.role] ?? uploader.role;
  const rawSizeLabel = formatBytesCompact(attachment.sizeBytes);
  const storedSizeLabel = formatBytesCompact(attachment.storedBytes);
  const dateLabel = new Date(attachment.createdAt).toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const storageTextLabel =
    storageProvider === 'gdrive'
      ? 'Google Drive privado (0 B binarios en PostgreSQL)'
      : `Base de datos local (${storedSizeLabel}${
          attachment.isCompressed ? ', comprimido gzip' : ''
        })`;

  const storageHtmlLabel =
    storageProvider === 'gdrive'
      ? 'Google Drive privado <span style="color: #64748b;">(0 B en PostgreSQL)</span>'
      : `Base de datos local (${escapeHtml(storedSizeLabel)}${
          attachment.isCompressed ? ' · gzip' : ''
        })`;

  const subject = `[Tablero Kanban] Nuevo archivo de ${uploader.displayName}: ${attachment.originalName}`;

  const textLines = [
    'Nuevo archivo subido al Tablero Kanban',
    '',
    `Subido por: ${uploader.displayName} (@${uploader.username}) — ${roleLabel}`,
    `Actividad: ${task.title}`,
    `Columna / Estado actual: ${statusLabel}`,
    `ID de actividad: ${task.id}`,
    `Archivo: ${attachment.originalName}`,
    `Extensión: ${attachment.extension}`,
    `Tamaño original: ${rawSizeLabel}`,
    `Almacenamiento: ${storageTextLabel}`,
    ...(safeDriveLink ? [`Enlace en Google Drive: ${safeDriveLink}`] : []),
    `Fecha: ${dateLabel}`,
    '',
    `El archivo binario original (${attachment.originalName}) se incluye adjunto en este correo automáticamente.`,
  ];

  const driveLinkRowHtml = safeDriveLink
    ? `
          <tr>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; color: #475569;">Enlace Drive</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0;">
              <a href="${escapeHtml(safeDriveLink)}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background: #1d4ed8; color: #ffffff; text-decoration: none; padding: 5px 10px; border-radius: 6px; font-size: 12px; font-weight: bold;">
                Abrir en Google Drive
              </a>
            </td>
          </tr>`
    : '';

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
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; color: #475569;">Columna / Estado</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0;">${escapeHtml(statusLabel)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; color: #475569;">Archivo</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">${escapeHtml(attachment.originalName)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; color: #475569;">Extensión</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0;">${escapeHtml(attachment.extension)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; color: #475569;">Tamaño</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0;">${escapeHtml(rawSizeLabel)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; color: #475569;">Almacenamiento</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0;">${storageHtmlLabel}</td>
          </tr>${driveLinkRowHtml}
          <tr>
            <td style="padding: 6px 8px; color: #475569;">Fecha</td>
            <td style="padding: 6px 8px;">${escapeHtml(dateLabel)}</td>
          </tr>
        </table>
        <p style="margin-bottom: 0; font-size: 12px; color: #64748b;">
          El archivo binario original viene adjunto en este correo automáticamente.
        </p>
      </div>
    </div>
  `.trim();

  return {
    from: `"Tablero Kanban Maestría" <${fromAddress}>`,
    to: recipient,
    subject,
    text: textLines.join('\n'),
    html,
    attachments: [
      {
        filename: attachment.originalName,
        content: buffer,
        contentType: attachment.mimeType,
      },
    ],
  };
}

async function buildRfc2822Buffer(message: AttachmentMailMessage): Promise<Buffer> {
  const composer = new MailComposer(message);
  return composer.compile().build();
}

async function readGmailErrorDetail(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '');
  if (!raw) return `HTTP ${response.status}`;

  try {
    const parsed = JSON.parse(raw) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    if (typeof message === 'string' && message.trim()) {
      return `HTTP ${response.status}: ${message.trim()}`;
    }
  } catch {
    // Respuesta no JSON
  }

  return `HTTP ${response.status}`;
}

async function sendViaGmailApi(mimeBuffer: Buffer): Promise<EmailDispatchResult> {
  const response = await fetchWithGoogleAuth(GMAIL_UPLOAD_SEND_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'message/rfc822',
    },
    body: new Uint8Array(mimeBuffer),
    timeoutMs: 45_000,
  });

  if (!response.ok) {
    const detail = await readGmailErrorDetail(response);
    console.error('[mailService] Gmail REST API rechazó el envío:', detail);
    return {
      sent: false,
      provider: 'gmail_api',
      error: `Gmail REST API rechazó el envío (${detail})`,
    };
  }

  await response.body?.cancel().catch(() => undefined);
  return { sent: true, provider: 'gmail_api' };
}

export async function sendAttachmentNotificationEmail(
  payload: AttachmentEmailPayload
): Promise<EmailDispatchResult> {
  if (customTestDispatcher) {
    return customTestDispatcher(payload);
  }

  if (process.env.MAIL_DISABLED === '1') {
    return {
      sent: false,
      skipped: true,
      error: 'Envío de correo deshabilitado (MAIL_DISABLED=1)',
    };
  }

  const recipient = resolveRecipient();
  if (!recipient) {
    return {
      sent: false,
      skipped: true,
      error: 'Destinatario de correo no configurado (MAIL_NOTIFY_TO / SMTP_USER)',
    };
  }

  const fromAddress = config.smtpUser || recipient;
  const mailMessage = buildAttachmentMailMessage(payload, fromAddress, recipient);

  if (isGoogleOAuthConfigured()) {
    try {
      const mimeBuffer = await buildRfc2822Buffer(mailMessage);
      return await sendViaGmailApi(mimeBuffer);
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : 'Error desconocido al enviar por Gmail API';
      console.error('[mailService] Error al enviar notificación vía Gmail API:', reason);
      return {
        sent: false,
        provider: 'gmail_api',
        error: reason,
      };
    }
  }

  const transporter = getTransporter();
  if (!transporter) {
    return {
      sent: false,
      skipped: true,
      error: 'Configuración de correo incompleta (Google OAuth 2.0 o SMTP)',
    };
  }

  try {
    await transporter.sendMail(mailMessage);
    return { sent: true, provider: 'smtp' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Error SMTP desconocido';
    console.error('[mailService] Error al enviar notificación de adjunto por SMTP:', reason);
    return { sent: false, provider: 'smtp', error: reason };
  }
}
