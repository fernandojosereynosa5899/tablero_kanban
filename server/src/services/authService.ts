import bcrypt from 'bcryptjs';
import jwt, { type JwtPayload as BaseJwtPayload } from 'jsonwebtoken';
import type { Role, User } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../prisma';
import { AuthError } from '../utils/errors';

const BCRYPT_COST = 10;
const JWT_EXPIRES_IN = '7d';
const JWT_ISSUER = 'tablero-kanban';
const JWT_AUDIENCE = 'tablero-kanban-app';
const DUMMY_PASSWORD_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8u1q7Y2t3XqvL3K5w8R9a0B1c2D3e4';

export interface AuthJwtPayload {
  sub: string;
  role: Role;
  tv: number;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export async function verifyDummyPassword(password: string): Promise<void> {
  await bcrypt.compare(password, DUMMY_PASSWORD_HASH).catch(() => false);
}

export function signAuthToken(user: Pick<User, 'id' | 'role' | 'tokenVersion'>): string {
  const payload: AuthJwtPayload = {
    sub: user.id,
    role: user.role,
    tv: user.tokenVersion,
  };
  return jwt.sign(payload, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

function isValidJwtPayload(decoded: string | BaseJwtPayload): decoded is BaseJwtPayload & AuthJwtPayload {
  if (typeof decoded !== 'object' || decoded === null) {
    return false;
  }
  return (
    typeof decoded.sub === 'string' &&
    decoded.sub.length > 0 &&
    typeof decoded.tv === 'number' &&
    Number.isInteger(decoded.tv) &&
    (decoded.role === 'LEADER' || decoded.role === 'SUBLEADER' || decoded.role === 'MEMBER')
  );
}

/**
 * Verifica la firma JWT, algoritmo HS256, issuer/audience y `tokenVersion` en BD.
 * Reutilizable desde HTTP (Express) y WebSockets (Socket.IO).
 */
export async function verifyJwtAndLoadUser(token: string): Promise<User> {
  if (token.length > 2048) {
    throw new AuthError('Token inválido o expirado');
  }

  let decoded: string | BaseJwtPayload;
  try {
    decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  } catch {
    throw new AuthError('Token inválido o expirado');
  }

  if (!isValidJwtPayload(decoded)) {
    throw new AuthError('Token inválido o expirado');
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
  if (!user || user.tokenVersion !== decoded.tv) {
    throw new AuthError('Sesión inválida o expirada');
  }

  return user;
}
