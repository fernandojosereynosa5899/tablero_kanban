import { useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Award, Sparkles } from 'lucide-react';
import type { CelebrationPayload } from '../../hooks/useKanbanRealtime';

interface ApprovalCelebrationProps {
  celebration: CelebrationPayload | null;
  onComplete: () => void;
}

interface Particle {
  id: number;
  startX: number;
  endX: number;
  endY: number;
  rotate: number;
  scale: number;
  delay: number;
  duration: number;
  color: string;
  shape: 'star' | 'ribbon' | 'circle' | 'diamond';
}

const CONFETTI_COLORS = [
  '#2E9E5B',
  '#1E88E5',
  '#FFA726',
  '#7E57C2',
  '#FACC15',
  '#EC4899',
  '#38BDF8',
];

function buildParticles(seedKey: number): Particle[] {
  const shapes: Particle['shape'][] = ['star', 'ribbon', 'circle', 'diamond'];
  const items: Particle[] = [];

  for (let i = 0; i < 36; i++) {
    // Distribución determinista variada basada en el índice y la clave
    const pseudo = ((i * 73 + seedKey * 19) % 100) / 100;
    const pseudo2 = ((i * 41 + seedKey * 31) % 100) / 100;
    const startX = 12 + ((i * 2.35 + pseudo * 14) % 76);
    const drift = (pseudo - 0.5) * 34;
    items.push({
      id: i,
      startX,
      endX: startX + drift,
      endY: 55 + pseudo2 * 40,
      rotate: (pseudo - 0.5) * 540,
      scale: 0.75 + pseudo2 * 0.7,
      delay: (i % 9) * 0.045,
      duration: 1.7 + pseudo2 * 0.9,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      shape: shapes[i % shapes.length],
    });
  }

  return items;
}

function renderShape(shape: Particle['shape'], color: string) {
  switch (shape) {
    case 'star':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <polygon
            points="12,2 14.9,8.6 22,9.3 16.6,14 18.2,21 12,17.3 5.8,21 7.4,14 2,9.3 9.1,8.6"
            fill={color}
          />
        </svg>
      );
    case 'ribbon':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="3" y="1" width="10" height="14" rx="3" fill={color} />
        </svg>
      );
    case 'diamond':
      return (
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <polygon points="8,1 15,8 8,15 1,8" fill={color} />
        </svg>
      );
    case 'circle':
    default:
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="6" cy="6" r="5" fill={color} />
        </svg>
      );
  }
}

export function ApprovalCelebration({ celebration, onComplete }: ApprovalCelebrationProps) {
  useEffect(() => {
    if (!celebration) return;
    const timer = window.setTimeout(() => {
      onComplete();
    }, 3800);
    return () => window.clearTimeout(timer);
  }, [celebration, onComplete]);

  const particles = useMemo(
    () => (celebration ? buildParticles(celebration.key) : []),
    [celebration],
  );

  return (
    <AnimatePresence>
      {celebration ? (
        <motion.div
          key={celebration.key}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          aria-live="polite"
          className="pointer-events-none fixed inset-0 z-[70] overflow-hidden"
        >
          {/* Confeti y estrellas SVG */}
          {particles.map((p) => (
            <motion.div
              key={p.id}
              initial={{
                left: `${p.startX}vw`,
                top: '-4vh',
                opacity: 0,
                scale: 0.3,
                rotate: 0,
              }}
              animate={{
                left: `${p.endX}vw`,
                top: `${p.endY}vh`,
                opacity: [0, 1, 1, 0],
                scale: [0.4, p.scale, p.scale, 0.7],
                rotate: p.rotate,
              }}
              transition={{
                duration: p.duration,
                delay: p.delay,
                ease: 'easeOut',
              }}
              className="absolute will-change-transform"
            >
              {renderShape(p.shape, p.color)}
            </motion.div>
          ))}

          {/* Banner sutil de celebración */}
          <div className="flex justify-center px-3 pt-16 sm:px-4 sm:pt-24">
            <motion.div
              initial={{ opacity: 0, y: -18, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 360, damping: 24 }}
              className="flex w-auto max-w-[calc(100vw-1.5rem)] items-start gap-3 rounded-2xl border border-emerald-300/80 bg-white/95 px-4 py-3 shadow-xl shadow-emerald-500/20 backdrop-blur-md dark:border-emerald-500/40 dark:bg-slate-900/95 sm:max-w-lg sm:px-5 sm:py-3.5"
            >
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm">
                <Award className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-extrabold text-emerald-700 dark:text-emerald-300">
                  <span>¡Tarea Aprobada!</span>
                  <Sparkles className="h-4 w-4 shrink-0 text-amber-400" />
                </div>
                <p className="mt-0.5 whitespace-normal break-words text-xs font-medium leading-relaxed text-slate-700 dark:text-slate-200 sm:text-[13px]">
                  {celebration.taskTitle}
                </p>
                {celebration.approvedBy ? (
                  <p className="mt-0.5 whitespace-normal break-words text-[11px] font-medium text-emerald-700/80 dark:text-emerald-300/80">
                    Aprobada por {celebration.approvedBy}
                  </p>
                ) : null}
              </div>
            </motion.div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
