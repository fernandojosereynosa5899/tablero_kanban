import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

let envLoaded = false;

/** Carga variables desde server/.env o .env sin sobrescribir las ya definidas en el entorno. */
export function loadEnvFiles(): void {
  if (envLoaded) return;
  envLoaded = true;

  const candidates = [
    path.resolve(process.cwd(), 'server/.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../.env'),
  ];

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
    }
  }
}

/**
 * Obtiene la contraseña inicial compartida para inicializar o sincronizar cuentas desde variables de entorno.
 * Nunca se incluye como literal en el repositorio para evitar exposición de credenciales.
 */
export function getSeedInitialPassword(): string {
  loadEnvFiles();
  const value = (
    process.env.SEED_INITIAL_PASSWORD ??
    process.env.TEST_USER_PASSWORD ??
    ''
  ).trim();

  if (!value) {
    throw new Error(
      'Falta definir SEED_INITIAL_PASSWORD (o TEST_USER_PASSWORD) en server/.env o en las variables del servidor.',
    );
  }
  return value;
}

/** Obtiene la contraseña configurada localmente para ejecutar scripts de verificación y pruebas. */
export function getTestUserPassword(): string {
  loadEnvFiles();
  const value = (
    process.env.TEST_USER_PASSWORD ??
    process.env.SEED_INITIAL_PASSWORD ??
    ''
  ).trim();

  if (!value) {
    throw new Error(
      'Falta definir TEST_USER_PASSWORD o SEED_INITIAL_PASSWORD en server/.env antes de ejecutar las pruebas.',
    );
  }
  return value;
}

/** Genera una credencial efímera y aleatoria por ejecución para pruebas sintéticas o negativas. */
export function generateEphemeralSecret(tag = 'Test'): string {
  return `${tag}_${crypto.randomBytes(6).toString('hex')}!A9`;
}
