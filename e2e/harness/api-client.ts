import fs from 'node:fs';
import { io, Socket } from 'socket.io-client';
import { RUNTIME_STATE_PATH, RuntimeState } from './env';

let cachedState: RuntimeState | null = null;

export function getRuntimeState(): RuntimeState {
  cachedState = JSON.parse(fs.readFileSync(RUNTIME_STATE_PATH, 'utf8')) as RuntimeState;
  return cachedState;
}

export interface ApiResponse<T = unknown> {
  status: number;
  headers: Headers;
  data: T;
  rawText: string;
}

export async function apiRequest<T = unknown>(
  endpoint: string,
  opts: {
    baseUrl?: string;
    token?: string;
    method?: string;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResponse<T>> {
  const state = getRuntimeState();
  const baseUrl = opts.baseUrl ?? state.apiUrl;
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };

  if (opts.token) {
    headers['Authorization'] = `Bearer ${opts.token}`;
  }

  let body: string | undefined;
  if (opts.rawBody !== undefined) {
    body = opts.rawBody;
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: opts.method ?? 'GET',
    headers,
    body,
  });

  const rawText = await res.text();
  let data: unknown = rawText;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json') && rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = rawText;
    }
  } else if (rawText.startsWith('{') || rawText.startsWith('[')) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = rawText;
    }
  }

  return {
    status: res.status,
    headers: res.headers,
    data: data as T,
    rawText,
  };
}

export async function apiUpload<T = unknown>(
  endpoint: string,
  opts: {
    baseUrl?: string;
    token?: string;
    fieldName?: string;
    filename: string;
    mimeType: string;
    buffer: Buffer;
  },
): Promise<ApiResponse<T>> {
  const state = getRuntimeState();
  const baseUrl = opts.baseUrl ?? state.apiUrl;
  const form = new FormData();
  const blob = new Blob([new Uint8Array(opts.buffer)], { type: opts.mimeType });
  form.append(opts.fieldName ?? 'file', blob, opts.filename);

  const headers: Record<string, string> = {};
  if (opts.token) {
    headers['Authorization'] = `Bearer ${opts.token}`;
  }

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: form,
  });

  const rawText = await res.text();
  let data: unknown = rawText;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = rawText;
  }

  return {
    status: res.status,
    headers: res.headers,
    data: data as T,
    rawText,
  };
}

export function connectSocket(
  token?: string,
  opts: {
    baseUrl?: string;
    extraHeaders?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<Socket> {
  const state = getRuntimeState();
  const baseUrl = opts.baseUrl ?? state.apiUrl;
  const timeoutMs = opts.timeoutMs ?? 8000;

  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      auth: token ? { token } : {},
      extraHeaders: opts.extraHeaders,
      transports: ['websocket', 'polling'],
      reconnection: false,
      forceNew: true,
    });

    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error(`Socket connection timed out after ${timeoutMs}ms`));
    }, timeoutMs);

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

export function waitForSocketEvent<T = unknown>(
  socket: Socket,
  event: string,
  predicate?: (payload: T) => boolean,
  timeoutMs = 8000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for socket event "${event}"`));
    }, timeoutMs);

    const handler = (payload: T) => {
      if (!predicate || predicate(payload)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(payload);
      }
    };

    socket.on(event, handler);
  });
}

export function emitSocketAck<T = unknown>(
  socket: Socket,
  event: string,
  payload: unknown,
  timeoutMs = 8000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ack on "${event}"`));
    }, timeoutMs);

    socket.emit(event, payload, (res: T) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

// Canonical 67-byte valid 1x1 transparent RGBA PNG
const BASE_1X1_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
);

export function makePngBuffer(extraTrailingBytes = 0): Buffer {
  if (extraTrailingBytes <= 0) return Buffer.from(BASE_1X1_PNG);
  return Buffer.concat([BASE_1X1_PNG, Buffer.alloc(extraTrailingBytes, 0x41)]);
}

export function makeJpegBuffer(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
}

export function makeWebpBuffer(): Buffer {
  const buf = Buffer.alloc(16, 0x00);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(8, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8 ', 12, 'ascii');
  return buf;
}

export function makePdfBuffer(text = 'E2E Kanban PDF'): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${text}\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n`, 'utf8');
}

export function makeXlsxZipBuffer(): Buffer {
  const header = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const markers = Buffer.from('0000000000000000000000000000[Content_Types].xml xl/workbook.xml', 'utf8');
  return Buffer.concat([header, markers]);
}

export function makeInvalidZipBuffer(): Buffer {
  const header = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const markers = Buffer.from('0000000000000000000000000000[Content_Types].xml generic/file.txt', 'utf8');
  return Buffer.concat([header, markers]);
}
