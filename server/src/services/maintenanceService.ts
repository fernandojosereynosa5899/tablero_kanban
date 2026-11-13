import fs from 'node:fs';
import path from 'node:path';
import type { Prisma, SystemConfig, User } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../prisma';
import { emitEvent } from '../realtime/bus';
import type { MaintenanceStatus } from '../types/domain';

export const DEFAULT_MAINTENANCE_TITLE = 'Tablero Kanban en mantenimiento';
export const DEFAULT_MAINTENANCE_MESSAGE =
  'Estamos aplicando mejoras y actualizaciones en la plataforma. En unos minutos todo volverá a estar disponible automáticamente.';

const GLOBAL_CONFIG_KEY = 'global';
const DB_CACHE_TTL_MS = 4000;

export interface MaintenanceEnvOverride {
  enabled: boolean;
  title?: string;
  message?: string;
  estimatedMinutes?: number | null;
}

export interface UpdateDatabaseMaintenanceInput {
  enabled: boolean;
  title?: string;
  message?: string;
  estimatedMinutes?: number | null;
}

interface ParsedMaintenanceFile {
  enabled: boolean;
  title: string;
  message: string;
  estimatedMinutes: number | null;
}

let testFilePathOverride: string | null = null;
let testEnvOverride: MaintenanceEnvOverride | null = null;
let dbConfigCache: { value: SystemConfig | null; expiresAt: number } | null = null;

/** Permite fijar una ruta temporal de `maintenance.json` durante pruebas automatizadas. */
export function setMaintenanceFilePathForTests(pathOrNull: string | null): void {
  testFilePathOverride = pathOrNull;
}

/** Permite simular variables de entorno de mantenimiento durante pruebas automatizadas. */
export function setMaintenanceEnvOverrideForTests(overrideOrNull: MaintenanceEnvOverride | null): void {
  testEnvOverride = overrideOrNull;
}

/** Limpia la caché en memoria de `SystemConfig` para pruebas o recarga inmediata. */
export function resetMaintenanceCacheForTests(): void {
  dbConfigCache = null;
}

/** Resuelve la ruta de `maintenance.json` tanto con `tsx src/` como compilado en `dist/src/`. */
export function resolveMaintenanceFilePath(): string | null {
  if (testFilePathOverride !== null) {
    return fs.existsSync(testFilePathOverride) ? testFilePathOverride : null;
  }

  const candidates = [
    path.resolve(process.cwd(), 'maintenance.json'),
    path.resolve(process.cwd(), '../maintenance.json'),
    path.resolve(__dirname, '../../../maintenance.json'),
    path.resolve(__dirname, '../../../../maintenance.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function readMaintenanceFile(): ParsedMaintenanceFile | null {
  const filePath = resolveMaintenanceFilePath();
  if (!filePath) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const enabled = record.enabled === true;
    const title =
      typeof record.title === 'string' && record.title.trim().length > 0
        ? record.title.trim()
        : DEFAULT_MAINTENANCE_TITLE;
    const message =
      typeof record.message === 'string' && record.message.trim().length > 0
        ? record.message.trim()
        : DEFAULT_MAINTENANCE_MESSAGE;
    const rawEta = record.estimatedMinutes;
    const estimatedMinutes =
      typeof rawEta === 'number' && Number.isInteger(rawEta) && rawEta > 0 ? rawEta : null;

    return {
      enabled,
      title,
      message,
      estimatedMinutes,
    };
  } catch {
    return null;
  }
}

async function readDatabaseConfig(): Promise<SystemConfig | null> {
  const now = Date.now();
  if (dbConfigCache && now < dbConfigCache.expiresAt) {
    return dbConfigCache.value;
  }

  try {
    const row = await prisma.systemConfig.findUnique({
      where: { key: GLOBAL_CONFIG_KEY },
    });
    dbConfigCache = {
      value: row,
      expiresAt: Date.now() + DB_CACHE_TTL_MS,
    };
    return row;
  } catch {
    // Si la tabla o la BD aún no están listas, falla de forma segura sin tumbar la app.
    return null;
  }
}

/**
 * Calcula el estado efectivo de la ventana de mantenimiento con precedencia estricta:
 * 1) Variables de entorno (`MAINTENANCE_MODE`), 2) Archivo `maintenance.json`,
 * 3) Base de datos (`SystemConfig`), 4) Desactivado (`none`).
 */
export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  const envEnabled = testEnvOverride?.enabled ?? config.maintenanceMode;
  if (envEnabled) {
    return {
      active: true,
      source: 'env',
      canDisableInApp: false,
      title:
        testEnvOverride?.title?.trim() ||
        config.maintenanceTitle ||
        DEFAULT_MAINTENANCE_TITLE,
      message:
        testEnvOverride?.message?.trim() ||
        config.maintenanceMessage ||
        DEFAULT_MAINTENANCE_MESSAGE,
      estimatedMinutes:
        testEnvOverride?.estimatedMinutes !== undefined
          ? testEnvOverride.estimatedMinutes
          : config.maintenanceEtaMinutes,
      updatedByName: null,
      updatedAt: null,
    };
  }

  const fileConfig = readMaintenanceFile();
  if (fileConfig?.enabled) {
    return {
      active: true,
      source: 'file',
      canDisableInApp: false,
      title: fileConfig.title,
      message: fileConfig.message,
      estimatedMinutes: fileConfig.estimatedMinutes,
      updatedByName: null,
      updatedAt: null,
    };
  }

  const dbConfig = await readDatabaseConfig();
  if (dbConfig?.maintenanceEnabled) {
    return {
      active: true,
      source: 'database',
      canDisableInApp: true,
      title: dbConfig.maintenanceTitle?.trim() || DEFAULT_MAINTENANCE_TITLE,
      message: dbConfig.maintenanceMessage?.trim() || DEFAULT_MAINTENANCE_MESSAGE,
      estimatedMinutes: dbConfig.estimatedMinutes ?? null,
      updatedByName: dbConfig.updatedByName ?? null,
      updatedAt: dbConfig.updatedAt.toISOString(),
    };
  }

  return {
    active: false,
    source: 'none',
    canDisableInApp: true,
    title: dbConfig?.maintenanceTitle?.trim() || DEFAULT_MAINTENANCE_TITLE,
    message: dbConfig?.maintenanceMessage?.trim() || DEFAULT_MAINTENANCE_MESSAGE,
    estimatedMinutes: null,
    updatedByName: dbConfig?.updatedByName ?? null,
    updatedAt: dbConfig?.updatedAt ? dbConfig.updatedAt.toISOString() : null,
  };
}

/**
 * Activa o desactiva la ventana de mantenimiento almacenada en base de datos,
 * registra la acción en ActivityLog, invalida caché y emite `maintenance:updated`.
 */
export async function updateDatabaseMaintenanceMode(
  actor: User,
  input: UpdateDatabaseMaintenanceInput,
): Promise<MaintenanceStatus> {
  const cleanTitle = input.title?.trim();
  const cleanMessage = input.message?.trim();

  await prisma.$transaction(async (tx) => {
    const saved = await tx.systemConfig.upsert({
      where: { key: GLOBAL_CONFIG_KEY },
      create: {
        key: GLOBAL_CONFIG_KEY,
        maintenanceEnabled: input.enabled,
        maintenanceTitle: cleanTitle || DEFAULT_MAINTENANCE_TITLE,
        maintenanceMessage: cleanMessage || DEFAULT_MAINTENANCE_MESSAGE,
        estimatedMinutes: input.estimatedMinutes ?? null,
        updatedById: actor.id,
        updatedByName: actor.displayName,
      },
      update: {
        maintenanceEnabled: input.enabled,
        ...(cleanTitle ? { maintenanceTitle: cleanTitle } : {}),
        ...(cleanMessage ? { maintenanceMessage: cleanMessage } : {}),
        ...(input.estimatedMinutes !== undefined ? { estimatedMinutes: input.estimatedMinutes } : {}),
        updatedById: actor.id,
        updatedByName: actor.displayName,
      },
    });

    await tx.activityLog.create({
      data: {
        userId: actor.id,
        taskId: null,
        action: input.enabled ? 'maintenance.enabled' : 'maintenance.disabled',
        details: {
          source: 'database',
          title: saved.maintenanceTitle,
          message: saved.maintenanceMessage,
          estimatedMinutes: saved.estimatedMinutes,
        } as Prisma.InputJsonValue,
      },
    });
  });

  dbConfigCache = null;
  const effective = await getMaintenanceStatus();
  emitEvent('maintenance:updated', effective);
  return effective;
}
