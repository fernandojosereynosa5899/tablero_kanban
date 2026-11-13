import 'dotenv/config';
import { PrismaClient, TaskStatus, Priority } from '@prisma/client';

const prisma = new PrismaClient();

function daysFromNow(days: number): Date {
  const minMs = Date.parse('2026-11-07T12:00:00.000Z');
  const maxMs = Date.parse('2026-12-19T12:00:00.000Z');
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(12, 0, 0, 0);
  const clamped = Math.min(maxMs, Math.max(minMs, d.getTime()));
  return new Date(clamped);
}

const SAMPLE_TASKS = [
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
    title: 'Pruebas de sincronización en tiempo real',
    description: 'Verificar que los movimientos de tarjetas se reflejen al instante en todos los navegadores.',
    status: TaskStatus.DONE,
    priority: Priority.MEDIUM,
    dueInDays: 1,
    color: '#E1BEE7',
    assigneeSlot: 3,
    subtasks: [
      { title: 'Probar eventos WebSocket', done: true },
      { title: 'Medir latencia de respuesta', done: true },
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

async function main() {
  const currentCount = await prisma.task.count();
  if (currentCount > 0) {
    console.log(`Ya existen ${currentCount} tareas en la BD. Omitiendo.`);
    return;
  }

  const users = await prisma.user.findMany({ select: { id: true, slot: true } });
  const bySlot = new Map<number, string>();
  for (const u of users) bySlot.set(u.slot, u.id);
  const leaderId = bySlot.get(1);
  if (!leaderId) throw new Error('No se encontró líder');

  const idOf = (slot: number) => bySlot.get(slot) ?? leaderId;

  for (let idx = 0; idx < SAMPLE_TASKS.length; idx++) {
    const t = SAMPLE_TASKS[idx];
    await prisma.task.create({
      data: {
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        dueDate: daysFromNow(t.dueInDays),
        position: (idx + 1) * 1000,
        color: t.color,
        assigneeId: idOf(t.assigneeSlot),
        createdById: leaderId,
        approvedAt: t.status === TaskStatus.APPROVED ? new Date() : null,
        subtasks: {
          create: t.subtasks.map((s, sIdx) => ({ title: s.title, done: s.done, position: sIdx * 1000 })),
        },
        comments: {
          create: t.comments.map((c) => ({ authorId: idOf(c.authorSlot), content: c.content })),
        },
      },
    });
  }
  console.log(`¡Insertadas ${SAMPLE_TASKS.length} tareas de ejemplo en PostgreSQL!`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
