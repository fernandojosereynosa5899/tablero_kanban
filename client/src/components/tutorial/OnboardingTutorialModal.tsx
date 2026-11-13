import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Columns,
  HelpCircle,
  KeyRound,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PROJECT_DATE_MAX, PROJECT_DATE_MIN } from '../../types/kanban';

interface OnboardingTutorialModalProps {
  open: boolean;
  onClose: () => void;
}

interface TutorialStep {
  badge: string;
  badgeColor: string;
  title: string;
  subtitle: string;
  icon: typeof Sparkles;
  content: {
    highlight: string;
    items: Array<{ title: string; desc: string; icon?: typeof Sparkles }>;
  };
}

const STEPS: TutorialStep[] = [
  {
    badge: 'Paso 1 de 4',
    badgeColor: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
    title: '¡Bienvenido al Tablero Kanban!',
    subtitle: 'Gestión colaborativa en tiempo real con sincronización instantánea',
    icon: Sparkles,
    content: {
      highlight:
        'Tu espacio de trabajo unificado para coordinar las actividades del equipo durante todo el proyecto.',
      items: [
        {
          title: 'Periodo de vigencia del proyecto',
          desc: `Solo se pueden asignar fechas límite entre el 07/11/2026 y el 19/12/2026 (${PROJECT_DATE_MIN} al ${PROJECT_DATE_MAX}).`,
          icon: Calendar,
        },
        {
          title: 'Presencia de equipo en vivo',
          desc: 'En la esquina superior derecha verás las burbujas de los 6 integrantes con un punto verde que indica quién está conectado en este momento.',
          icon: Users,
        },
        {
          title: 'Barra de progreso general',
          desc: 'Indica el porcentaje de tareas validadas en APROBADO respecto al total del tablero, actualizándose al instante.',
          icon: CheckCircle2,
        },
      ],
    },
  },
  {
    badge: 'Paso 2 de 4',
    badgeColor: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    title: 'Columnas y Flujo de Trabajo',
    subtitle: 'Cómo mover y avanzar las actividades sin desorden',
    icon: Columns,
    content: {
      highlight:
        'El tablero se divide en 4 etapas con colores claros y correlativos para facilitar la lectura:',
      items: [
        {
          title: '1. POR HACER (Azul) y 2. EN PROCESO (Naranja)',
          desc: 'Tareas pendientes de iniciar y trabajo activo en desarrollo. Arrastra las tarjetas o usa las flechas rápidas en móvil.',
          icon: Columns,
        },
        {
          title: '3. HECHO (Morado)',
          desc: 'Trabajo terminado por el integrante, listo para ser inspeccionado.',
          icon: CheckCircle2,
        },
        {
          title: '4. APROBADO (Verde) — Exclusivo del Líder',
          desc: 'Solo el Líder de Proyecto (Reynosa Vidal Fernando Jose) puede mover tarjetas a APROBADO, activando la celebración del equipo.',
          icon: ShieldCheck,
        },
      ],
    },
  },
  {
    badge: 'Paso 3 de 4',
    badgeColor: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
    title: 'Colaboración y Comentarios en Vivo',
    subtitle: 'Asignación a todos y comunicación simultánea sin colisiones',
    icon: MessageSquare,
    content: {
      highlight:
        'Diseñado para que los 6 integrantes trabajen y comenten en paralelo sin bloquearse:',
      items: [
        {
          title: 'Tareas para "Todo el equipo"',
          desc: 'Al crear o editar una tarea se puede asignar a "Todo el equipo (Todos)". Cualquier integrante puede moverla y completar sus subtareas.',
          icon: Users,
        },
        {
          title: 'Comentarios simultáneos sin colisiones',
          desc: 'Varios compañeros pueden abrir una tarjeta y comentar al mismo tiempo. Los mensajes se fusionan cronológicamente vía Socket.IO.',
          icon: MessageSquare,
        },
        {
          title: 'Indicador de escritura en vivo',
          desc: 'Verás avisos como "Eunice, Kuri están escribiendo..." para saber quién está redactando notas en la misma actividad.',
          icon: Sparkles,
        },
      ],
    },
  },
  {
    badge: 'Paso 4 de 4',
    badgeColor: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    title: 'Tu Perfil y Seguridad',
    subtitle: 'Recomendaciones importantes para tu primer inicio de sesión',
    icon: KeyRound,
    content: {
      highlight:
        'Cada miembro debe resguardar su cuenta y personalizar su identidad en el tablero:',
      items: [
        {
          title: 'Cambiar tu contraseña inicial',
          desc: 'Te sugerimos ir a "Mi Perfil & Avatar" -> "Cambiar contraseña" para reemplazar la clave inicial compartida por una personal de 8+ caracteres.',
          icon: KeyRound,
        },
        {
          title: 'Personalizar tu Avatar SVG',
          desc: 'Elige entre más de 14 avatares vectoriales (astronauta, robot, zorro, gato, piloto, etc.), accesorios y colores propios.',
          icon: Sparkles,
        },
        {
          title: 'Panel del Líder: Equipo (6/6)',
          desc: 'Si alguien olvida su contraseña o necesita restablecer su acceso, el Líder puede reconfigurar las credenciales desde su panel.',
          icon: ShieldCheck,
        },
      ],
    },
  },
];

export function OnboardingTutorialModal({ open, onClose }: OnboardingTutorialModalProps) {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') {
        setCurrentStep((s) => Math.min(STEPS.length - 1, s + 1));
      }
      if (e.key === 'ArrowLeft') {
        setCurrentStep((s) => Math.max(0, s - 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!user) return null;

  const step = STEPS[currentStep];
  const StepIcon = step.icon;
  const isLast = currentStep === STEPS.length - 1;
  const isFirst = currentStep === 0;

  const handleFinish = () => {
    onClose();
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="tutorial-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-6 backdrop-blur-xs"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 12 }}
            transition={{ type: 'spring', damping: 25, stiffness: 320 }}
            className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200/90 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Tutorial guiado del Tablero Kanban"
          >
            {/* Encabezado del modal */}
            <div className="relative border-b border-slate-100 bg-slate-50/70 px-5 py-4 dark:border-slate-800 dark:bg-slate-800/40 sm:px-7">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${step.badgeColor}`}
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                    <span>{step.badge}</span>
                  </span>
                  <span className="hidden text-xs font-semibold text-slate-400 sm:inline">
                    Guía de bienvenida
                  </span>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Cerrar tutorial"
                  className="rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Indicador de pasos (píldoras interactivas) */}
              <div className="mt-3 flex items-center gap-2">
                {STEPS.map((s, idx) => {
                  const active = idx === currentStep;
                  const visited = idx < currentStep;
                  return (
                    <button
                      key={s.title}
                      type="button"
                      onClick={() => setCurrentStep(idx)}
                      className={`h-2 flex-1 rounded-full transition-all duration-200 ${
                        active
                          ? 'bg-blue-600 dark:bg-blue-500 ring-2 ring-blue-400/40'
                          : visited
                            ? 'bg-slate-300 dark:bg-slate-700'
                            : 'bg-slate-200 dark:bg-slate-800'
                      }`}
                      aria-label={`Ir al paso ${idx + 1}`}
                      title={`Paso ${idx + 1}: ${s.title}`}
                    />
                  );
                })}
              </div>
            </div>

            {/* Contenido deslizable del paso */}
            <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
              <div className="flex items-start gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300 border border-blue-100 dark:border-blue-500/30">
                  <StepIcon className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                    {step.title}
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                    {step.subtitle}
                  </p>
                </div>
              </div>

              {/* Párrafo destacado */}
              <div className="mt-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3.5 text-xs sm:text-sm font-medium leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
                {step.content.highlight}
              </div>

              {/* Lista de características del paso */}
              <div className="mt-4 space-y-3">
                {step.content.items.map((item) => {
                  const ItemIcon = item.icon ?? Sparkles;
                  return (
                    <div
                      key={item.title}
                      className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-3.5 shadow-xs transition hover:border-slate-200 dark:border-slate-800/80 dark:bg-slate-800/60"
                    >
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                        <ItemIcon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                          {item.title}
                        </h3>
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                          {item.desc}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Pie de navegación */}
            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-800/50 sm:px-7">
              <div className="text-[11px] text-slate-400 dark:text-slate-500 text-center sm:text-left">
                Puedes reabrir esta guía con el botón <strong className="text-slate-600 dark:text-slate-300">Guía</strong> en la barra superior.
              </div>

              <div className="flex items-center justify-end gap-2">
                {!isFirst ? (
                  <button
                    type="button"
                    onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Anterior</span>
                  </button>
                ) : null}

                {isLast ? (
                  <button
                    type="button"
                    onClick={handleFinish}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-md transition hover:bg-emerald-500 active:scale-[0.98]"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>¡Comenzar a trabajar!</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCurrentStep((s) => Math.min(STEPS.length - 1, s + 1))}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-md transition hover:bg-blue-500 active:scale-[0.98]"
                  >
                    <span>Siguiente</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
