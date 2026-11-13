import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Lock, Plus } from 'lucide-react';
import type { ColumnMeta, Role, Task, TaskStatus } from '../../types/kanban';
import { EmptyColumnIllustration } from '../illustrations/VectorIllustrations';
import { TaskCard } from './TaskCard';

interface KanbanColumnProps {
  column: ColumnMeta;
  tasks: Task[];
  hasActiveFilters: boolean;
  currentUserId: string;
  currentUserRole: Role;
  isDraggingActive: boolean;
  hiddenOnMobile?: boolean;
  onOpenDetail: (task: Task) => void;
  onQuickMove: (task: Task, toStatus: TaskStatus) => void;
  onCreateInColumn?: (status: TaskStatus) => void;
}

export function KanbanColumn({
  column,
  tasks,
  hasActiveFilters,
  currentUserId,
  currentUserRole,
  isDraggingActive,
  hiddenOnMobile = false,
  onOpenDetail,
  onQuickMove,
  onCreateInColumn,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${column.status}`,
    data: {
      type: 'column',
      status: column.status,
    },
  });

  const isForbiddenForMember =
    isDraggingActive && isOver && currentUserRole !== 'LEADER' && column.status === 'APPROVED';

  return (
    <div
      ref={setNodeRef}
      aria-label={`Columna ${column.label}`}
      style={{
        borderTopColor: isOver && isForbiddenForMember ? '#EF4444' : column.color,
        borderColor: isOver
          ? isForbiddenForMember
            ? '#EF4444'
            : column.color
          : undefined,
      }}
      className={`${hiddenOnMobile ? 'hidden md:flex' : 'flex'} min-h-[340px] md:min-h-[380px] flex-col rounded-xl border border-t-[3px] bg-[#EAECEF]/85 p-3.5 transition-all dark:bg-[#181A1F] ${
        isOver
          ? isForbiddenForMember
            ? 'border-2 bg-red-50/70 ring-2 ring-red-500/20 dark:bg-red-950/30'
            : 'border-2 bg-white shadow-md dark:bg-[#1E2027]'
          : 'border-zinc-200/90 dark:border-[#272A33]'
      }`}
    >
      {/* Cabecera de columna */}
      <div className="mb-3 flex items-start justify-between gap-2 pb-2.5 border-b border-slate-200/80 dark:border-slate-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-full shadow-xs"
              style={{ backgroundColor: column.color }}
            />
            <h3 className="text-xs font-extrabold tracking-wider text-slate-800 dark:text-slate-100 truncate">
              {column.label}
            </h3>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-bold"
              style={{
                backgroundColor: `${column.color}20`,
                color: column.color,
              }}
            >
              {tasks.length}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
            {column.description}
          </p>
        </div>

        {onCreateInColumn && !(currentUserRole !== 'LEADER' && column.status === 'APPROVED') ? (
          <button
            type="button"
            onClick={() => onCreateInColumn(column.status)}
            title={`Agregar actividad en ${column.label}`}
            aria-label={`Agregar actividad en ${column.label}`}
            className="inline-flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-700 hover:shadow-xs dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <Plus className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* Aviso visual si integrante intenta soltar en APROBADO */}
      {isForbiddenForMember ? (
        <div className="mb-2.5 flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:border-red-500/30 dark:bg-red-950/50 dark:text-red-300">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          <span>Solo el líder puede aprobar tareas</span>
        </div>
      ) : null}

      {/* Lista sorteable de tarjetas */}
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-1 flex-col gap-3">
          {tasks.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200/90 bg-white/50 px-4 py-8 text-center dark:border-slate-800 dark:bg-slate-900/40">
              <EmptyColumnIllustration className="opacity-85" />
              <p className="mt-2.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                {hasActiveFilters
                  ? 'Ninguna actividad coincide con los filtros'
                  : 'Sin actividades en esta columna'}
              </p>
            </div>
          ) : (
            tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                onOpenDetail={onOpenDetail}
                onQuickMove={onQuickMove}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}
