/**
 * Seed idempotente del Tablero Kanban.
 *
 * - Tabla User vacía      → crea los 6 usuarios + tareas de ejemplo (subtareas, comentarios, actividad).
 * - Ya existen usuarios   → no toca nada ("Seed omitido: ya existen N usuarios"), código de salida 0.
 * - `--force` o SEED_FORCE=1 → upsert por slot restaurando username/contraseña/displayName/rol por defecto
 *                              (no borra tareas; incrementa tokenVersion para invalidar sesiones previas).
 *
 * Se ejecuta con `tsx prisma/seed.ts` en desarrollo y como `node dist/prisma/seed.js` en producción.
 */
import 'dotenv/config';
import { PrismaClient, Prisma, Role, TaskStatus, Priority } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { getSeedInitialPassword } from '../scripts/lib/testCredentials';

const prisma = new PrismaClient();
const BCRYPT_COST = 10;

type Accessory = 'none' | 'glasses' | 'headphones' | 'crown' | 'cap' | 'bow' | 'star' | 'earring';

interface AvatarConfig {
  preset: string;
  bg: string;
  color: string;
  accessory: Accessory;
}

interface DefaultUser {
  slot: number;
  username: string;
  displayName: string;
  role: Role;
  avatar: AvatarConfig;
}

// Credenciales iniciales por cupo (la contraseña se lee de SEED_INITIAL_PASSWORD en .env)
const DEFAULT_USERS: DefaultUser[] = [
  {
    slot: 1,
    username: 'lider',
    displayName: 'Reynosa Vidal Fernando Jose',
    role: Role.LEADER,
    avatar: { preset: 'astronauta', bg: '#1E88E5', color: '#FFD54F', accessory: 'crown' },
  },
  {
    slot: 2,
    username: 'integrante1',
    displayName: 'Eunice Thamar Zeferino Espinosa',
    role: Role.MEMBER,
    avatar: { preset: 'gato', bg: '#F48FB1', color: '#6A1B9A', accessory: 'bow' },
  },
  {
    slot: 3,
    username: 'integrante2',
    displayName: 'Kuri Mauricio Villanueva Cabrera',
    role: Role.MEMBER,
    avatar: { preset: 'robot', bg: '#4DB6AC', color: '#263238', accessory: 'headphones' },
  },
  {
    slot: 4,
    username: 'integrante3',
    displayName: 'Velazquez García Luis Eduardo',
    role: Role.MEMBER,
    avatar: { preset: 'zorro', bg: '#FFB74D', color: '#BF360C', accessory: 'glasses' },
  },
  {
    slot: 5,
    username: 'integrante4',
    displayName: 'López García Carlos Alan',
    role: Role.MEMBER,
    avatar: { preset: 'piloto', bg: '#7E57C2', color: '#EDE7F6', accessory: 'cap' },
  },
  {
    slot: 6,
    username: 'integrante5',
    displayName: 'David Alejandro Velázquez Gutierrez',
    role: Role.SUBLEADER,
    avatar: { preset: 'artista', bg: '#81C784', color: '#1B5E20', accessory: 'star' },
  },
];

interface SampleTask {
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  dueInDays: number | null;
  color: string | null;
  assigneeSlot: number;
  subtasks: Array<{ title: string; done: boolean }>;
  comments: Array<{ authorSlot: number; content: string }>;
}

const SAMPLE_TASKS: SampleTask[] = [
  {
    title: 'Definir requisitos del módulo de reportes',
    description: 'Reunir con el equipo los indicadores que debe mostrar el módulo de reportes y documentarlos.',
    status: TaskStatus.TODO,
    priority: Priority.HIGH,
    dueInDays: 6,
    color: '#FFF59D',
    assigneeSlot: 2,
    subtasks: [
      { title: 'Listar indicadores clave', done: false },
      { title: 'Validar con el líder', done: false },
      { title: 'Redactar documento final', done: false },
    ],
    comments: [{ authorSlot: 1, content: 'Prioricemos los indicadores de avance por integrante.' }],
  },
  {
    title: 'Diseñar iconografía del tablero',
    description: 'Crear un set de iconos SVG coherente con la paleta de colores de las columnas.',
    status: TaskStatus.TODO,
    priority: Priority.LOW,
    dueInDays: 12,
    color: '#F8BBD0',
    assigneeSlot: 6,
    subtasks: [
      { title: 'Bocetos iniciales', done: false },
      { title: 'Versión final en SVG', done: false },
    ],
    comments: [],
  },
  {
    title: 'Implementar autenticación con JWT',
    description: 'Inicio de sesión, middleware de verificación de token y revocación por cambio de contraseña.',
    status: TaskStatus.IN_PROGRESS,
    priority: Priority.URGENT,
    dueInDays: 2,
    color: '#B3E5FC',
    assigneeSlot: 3,
    subtasks: [
      { title: 'Endpoint de login', done: true },
      { title: 'Middleware de autorización', done: true },
      { title: 'Pruebas automatizadas', done: false },
    ],
    comments: [
      { authorSlot: 3, content: 'El login ya funciona; me faltan las pruebas.' },
      { authorSlot: 1, content: '¡Excelente avance! Revisa también la expiración del token.' },
    ],
  },
  {
    title: 'Maquetar vista responsive del tablero',
    description: 'Adaptar las columnas para escritorio, tableta y móvil (1440px, 768px y 375px).',
    status: TaskStatus.IN_PROGRESS,
    priority: Priority.MEDIUM,
    dueInDays: 4,
    color: '#C8E6C9',
    assigneeSlot: 4,
    subtasks: [
      { title: 'Vista de escritorio', done: true },
      { title: 'Vista de tableta', done: false },
      { title: 'Vista móvil', done: false },
    ],
    comments: [],
  },
  {
    title: 'Configurar base de datos PostgreSQL',
    description: 'Crear la instancia en Render, definir el esquema con Prisma y cargar los datos iniciales.',
    status: TaskStatus.DONE,
    priority: Priority.HIGH,
    dueInDays: -1,
    color: '#FFE0B2',
    assigneeSlot: 5,
    subtasks: [
      { title: 'Crear instancia en Render', done: true },
      { title: 'Definir esquema Prisma', done: true },
      { title: 'Ejecutar seed', done: true },
    ],
    comments: [{ authorSlot: 5, content: 'Lista para revisión del líder.' }],
  },
  {
    title: 'Pruebas de sincronización en tiempo real',
    description: 'Verificar que los movimientos de tarjetas se reflejen al instante en todos los navegadores.',
    status: TaskStatus.DONE,
    priority: Priority.MEDIUM,
    dueInDays: 1,
    color: '#FFCCBC',
    assigneeSlot: 3,
    subtasks: [
      { title: 'Dos navegadores simultáneos', done: true },
      { title: 'Reconexión tras pérdida de red', done: true },
    ],
    comments: [],
  },
  {
    title: 'Redactar documento de alcance del proyecto',
    description: 'Objetivos, entregables, roles del equipo y cronograma general.',
    status: TaskStatus.APPROVED,
    priority: Priority.MEDIUM,
    dueInDays: -5,
    color: '#D1C4E9',
    assigneeSlot: 2,
    subtasks: [
      { title: 'Objetivos y entregables', done: true },
      { title: 'Cronograma', done: true },
    ],
    comments: [{ authorSlot: 1, content: 'Aprobado. ¡Buen trabajo, Eunice!' }],
  },
];

function daysFromNow(days: number): Date {
  const minMs = Date.parse('2026-11-07T12:00:00.000Z');
  const maxMs = Date.parse('2026-12-19T12:00:00.000Z');
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(12, 0, 0, 0);
  const clamped = Math.min(maxMs, Math.max(minMs, d.getTime()));
  return new Date(clamped);
}

function hasForceFlag(): boolean {
  const env = (process.env.SEED_FORCE ?? '').toLowerCase();
  return process.argv.includes('--force') || env === '1' || env === 'true';
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/** Crea los 6 usuarios y las tareas de ejemplo (BD vacía). */
async function seedFresh(): Promise<void> {
  const initialPassword = getSeedInitialPassword();
  const initialPasswordHash = await hashPassword(initialPassword);

  await prisma.$transaction(
    async (tx) => {
      const userIdBySlot = new Map<number, string>();

      for (let i = 0; i < DEFAULT_USERS.length; i++) {
        const u = DEFAULT_USERS[i];
        const created = await tx.user.create({
          data: {
            slot: u.slot,
            username: u.username,
            passwordHash: initialPasswordHash,
            displayName: u.displayName,
            role: u.role,
            avatar: u.avatar as unknown as Prisma.InputJsonValue,
          },
        });
        userIdBySlot.set(u.slot, created.id);
      }

      const leaderId = userIdBySlot.get(1);
      if (!leaderId) throw new Error('No se pudo crear el líder');
      const idOf = (slot: number): string => {
        const id = userIdBySlot.get(slot);
        if (!id) throw new Error(`Slot ${slot} sin usuario`);
        return id;
      };

      await tx.activityLog.createMany({
        data: DEFAULT_USERS.filter((u) => u.slot !== 1).map((u) => ({
          userId: leaderId,
          action: 'user.created',
          details: { username: u.username, displayName: u.displayName, slot: u.slot },
        })),
      });

      const positionByStatus = new Map<TaskStatus, number>();

      for (const t of SAMPLE_TASKS) {
        const position = (positionByStatus.get(t.status) ?? 0) + 1000;
        positionByStatus.set(t.status, position);
        const assigneeId = idOf(t.assigneeSlot);

        const task = await tx.task.create({
          data: {
            title: t.title,
            description: t.description,
            status: t.status,
            priority: t.priority,
            dueDate: t.dueInDays === null ? null : daysFromNow(t.dueInDays),
            position,
            color: t.color,
            assigneeId,
            createdById: leaderId,
            approvedAt: t.status === TaskStatus.APPROVED ? new Date() : null,
            subtasks: {
              create: t.subtasks.map((s, idx) => ({ title: s.title, done: s.done, position: idx })),
            },
            comments: {
              create: t.comments.map((c) => ({ authorId: idOf(c.authorSlot), content: c.content })),
            },
          },
        });

        const logs: Prisma.ActivityLogCreateManyInput[] = [
          {
            userId: leaderId,
            taskId: task.id,
            action: 'task.created',
            details: { title: t.title, status: TaskStatus.TODO, assigneeId },
          },
        ];
        if (t.status !== TaskStatus.TODO) {
          const to = t.status === TaskStatus.APPROVED ? TaskStatus.DONE : t.status;
          logs.push({
            userId: assigneeId,
            taskId: task.id,
            action: 'task.moved',
            details: { title: t.title, fromStatus: TaskStatus.TODO, toStatus: to },
          });
        }
        if (t.status === TaskStatus.APPROVED) {
          logs.push({
            userId: leaderId,
            taskId: task.id,
            action: 'task.approved',
            details: { title: t.title, fromStatus: TaskStatus.DONE, toStatus: TaskStatus.APPROVED },
          });
        }
        for (const c of t.comments) {
          logs.push({
            userId: idOf(c.authorSlot),
            taskId: task.id,
            action: 'comment.created',
            details: { title: t.title, content: c.content },
          });
        }
        await tx.activityLog.createMany({ data: logs });
      }
    },
    { maxWait: 20_000, timeout: 120_000 },
  );

  console.log(
    `Seed completado: ${DEFAULT_USERS.length} usuarios (1 líder + ${DEFAULT_USERS.length - 1} integrantes) y ${SAMPLE_TASKS.length} tareas de ejemplo.`,
  );
}

/** Restaura por slot las credenciales por defecto sin borrar tareas. */
async function seedForce(): Promise<void> {
  const initialPasswordHash = await hashPassword(getSeedInitialPassword());

  for (const u of DEFAULT_USERS) {
    const passwordHash = initialPasswordHash;

    // Si otro slot usa este username, se renombra para liberar la restricción única.
    const clash = await prisma.user.findUnique({ where: { username: u.username } });
    if (clash && clash.slot !== u.slot) {
      await prisma.user.update({
        where: { id: clash.id },
        data: { username: `${clash.username}_slot${clash.slot}`, tokenVersion: { increment: 1 } },
      });
    }

    await prisma.user.upsert({
      where: { slot: u.slot },
      update: {
        username: u.username,
        passwordHash,
        displayName: u.displayName,
        role: u.role,
        tokenVersion: { increment: 1 },
      },
      create: {
        slot: u.slot,
        username: u.username,
        passwordHash,
        displayName: u.displayName,
        role: u.role,
        avatar: u.avatar as unknown as Prisma.InputJsonValue,
      },
    });
  }
  console.log(`Seed forzado: credenciales por defecto restauradas para ${DEFAULT_USERS.length} usuarios (tareas intactas).`);
}

async function main(): Promise<void> {
  const userCount = await prisma.user.count();

  if (userCount === 0) {
    await seedFresh();
    return;
  }
  if (hasForceFlag()) {
    await seedForce();
    return;
  }
  console.log(`Seed omitido: ya existen ${userCount} usuarios`);
}

main()
  .catch((err: unknown) => {
    console.error('Error en el seed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
