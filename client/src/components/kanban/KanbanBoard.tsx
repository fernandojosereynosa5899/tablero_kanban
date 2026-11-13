import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { toast } from 'sonner';
import { KANBAN_COLUMNS, type Role, type Task, type TaskStatus } from '../../types/kanban';
import { KanbanColumn } from './KanbanColumn';
import { TaskCard } from './TaskCard';

interface KanbanBoardProps {
  allTasks: Task[];
  filteredTasks: Task[];
  hasActiveFilters: boolean;
  currentUserId: string;
  currentUserRole: Role;
  onMoveTask: (task: Task, toStatus: TaskStatus, position?: number) => Promise<boolean>;
  onOpenDetail: (task: Task) => void;
  onCreateInColumn?: (status: TaskStatus) => void;
}

const collisionDetectionStrategy: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }
  return closestCorners(args);
};

export function KanbanBoard({
  allTasks,
  filteredTasks,
  hasActiveFilters,
  currentUserId,
  currentUserRole,
  onMoveTask,
  onOpenDetail,
  onCreateInColumn,
}: KanbanBoardProps) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [mobileActiveStatus, setMobileActiveStatus] = useState<TaskStatus>('TODO');
  const [mobileShowAll, setMobileShowAll] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const groupedFiltered = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      TODO: [],
      IN_PROGRESS: [],
      DONE: [],
      APPROVED: [],
    };
    for (const task of filteredTasks) {
      map[task.status].push(task);
    }
    for (const col of KANBAN_COLUMNS) {
      map[col.status].sort(
        (a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt),
      );
    }
    return map;
  }, [filteredTasks]);

  const activeTask = useMemo(
    () => (activeTaskId ? allTasks.find((t) => t.id === activeTaskId) ?? null : null),
    [activeTaskId, allTasks],
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTaskId(String(event.active.id));
  };

  const handleDragCancel = () => {
    setActiveTaskId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTaskId(null);
    const { active, over } = event;
    if (!over) return;

    const draggedTask = allTasks.find((t) => t.id === String(active.id));
    if (!draggedTask) return;

    const overId = String(over.id);
    const overData = over.data.current as
      | { type?: 'column'; status?: TaskStatus }
      | { type?: 'task'; task?: Task }
      | undefined;

    let targetStatus: TaskStatus | null = null;
    if (overData?.type === 'column' && overData.status) {
      targetStatus = overData.status;
    } else if (overData?.type === 'task' && overData.task) {
      targetStatus = overData.task.status;
    } else if (overId.startsWith('col:')) {
      targetStatus = overId.slice(4) as TaskStatus;
    } else {
      const overTaskFallback = allTasks.find((t) => t.id === overId);
      if (overTaskFallback) {
        targetStatus = overTaskFallback.status;
      }
    }

    if (!targetStatus) return;

    // Validación de permisos antes de mutar
    if (currentUserRole !== 'LEADER') {
      const canMoveTask = draggedTask.assignedToAll || draggedTask.assigneeId === currentUserId;
      if (!canMoveTask || draggedTask.status === 'APPROVED') {
        toast.error('Solo puedes mover tus tareas asignadas');
        return;
      }
      if (targetStatus === 'APPROVED') {
        toast.error('Solo el líder puede aprobar tareas');
        return;
      }
    }

    // Cálculo de posición destino en la columna completa (sin filtros)
    const destColumnAll = allTasks
      .filter((t) => t.status === targetStatus && t.id !== draggedTask.id)
      .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));

    let nextPosition: number | undefined;

    if (destColumnAll.length === 0) {
      nextPosition = 0;
    } else if (!overId.startsWith('col:') && overId !== draggedTask.id) {
      const overIndex = destColumnAll.findIndex((t) => t.id === overId);
      if (overIndex !== -1) {
        const prevPos =
          overIndex > 0
            ? destColumnAll[overIndex - 1].position
            : Math.max(0, destColumnAll[0].position - 1000);
        const overPos = destColumnAll[overIndex].position;
        const nextPos =
          overIndex < destColumnAll.length - 1
            ? destColumnAll[overIndex + 1].position
            : overPos + 1000;

        // Si estaba arriba en la misma columna, insertamos después; si no, antes
        const sameColumnAll = allTasks
          .filter((t) => t.status === targetStatus)
          .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
        const activeOrigIdx = sameColumnAll.findIndex((t) => t.id === draggedTask.id);
        const overOrigIdx = sameColumnAll.findIndex((t) => t.id === overId);

        if (
          draggedTask.status === targetStatus &&
          activeOrigIdx !== -1 &&
          overOrigIdx !== -1 &&
          activeOrigIdx < overOrigIdx
        ) {
          nextPosition = (overPos + nextPos) / 2;
        } else {
          nextPosition = overIndex === 0 ? Math.max(0, overPos / 2) : (prevPos + overPos) / 2;
        }
      } else {
        nextPosition = destColumnAll[destColumnAll.length - 1].position + 1000;
      }
    } else {
      nextPosition = destColumnAll[destColumnAll.length - 1].position + 1000;
    }

    // Evitar petición redundante si quedó en el mismo lugar
    if (
      draggedTask.status === targetStatus &&
      (overId === draggedTask.id || overId === `col:${targetStatus}`)
    ) {
      return;
    }

    void onMoveTask(draggedTask, targetStatus, nextPosition);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetectionStrategy}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <section aria-label="Tablero Kanban de cuatro columnas" className="relative z-10 space-y-2.5 sm:space-y-3">
        {/* Selector rápido fijo de columnas en móvil (< 768px) para navegación cómoda con el pulgar */}
        <div className="md:hidden sticky top-2 z-20 rounded-xl border border-zinc-200/95 bg-white/95 p-2 shadow-sm backdrop-blur-md dark:border-[#272A33] dark:bg-[#181A1F]/95">
          <div className="mb-1.5 flex items-center justify-between px-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
              Columnas del tablero
            </span>
            <button
              type="button"
              onClick={() => setMobileShowAll((prev) => !prev)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition ${
                mobileShowAll
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/15'
              }`}
            >
              {mobileShowAll ? 'Ver 1 columna' : 'Ver todas (4)'}
            </button>
          </div>

          <div
            role="tablist"
            aria-label="Cambiar columna en móvil"
            className="grid grid-cols-2 gap-1.5"
          >
            {KANBAN_COLUMNS.map((col) => {
              const count = groupedFiltered[col.status].length;
              const isSelected = !mobileShowAll && mobileActiveStatus === col.status;
              return (
                <button
                  key={col.status}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => {
                    setMobileActiveStatus(col.status);
                    setMobileShowAll(false);
                  }}
                  style={
                    isSelected
                      ? {
                          borderColor: col.color,
                          backgroundColor: `${col.color}18`,
                        }
                      : undefined
                  }
                  className={`flex min-h-[36px] items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-extrabold tracking-wide transition ${
                    isSelected
                      ? 'text-slate-900 shadow-xs dark:text-white'
                      : 'border-zinc-200 bg-zinc-50/90 text-slate-600 hover:bg-zinc-100 dark:border-[#2D3038] dark:bg-[#212329] dark:text-zinc-300 dark:hover:bg-[#292C34]'
                  }`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: col.color }}
                    />
                    <span className="truncate">{col.label}</span>
                  </span>
                  <span
                    className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none"
                    style={{
                      backgroundColor: `${col.color}22`,
                      color: col.color,
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 items-start">
          {KANBAN_COLUMNS.map((column) => (
            <KanbanColumn
              key={column.status}
              column={column}
              tasks={groupedFiltered[column.status]}
              hasActiveFilters={hasActiveFilters}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              isDraggingActive={activeTaskId !== null}
              hiddenOnMobile={!mobileShowAll && column.status !== mobileActiveStatus}
              onOpenDetail={onOpenDetail}
              onQuickMove={(task, toStatus) => {
                void onMoveTask(task, toStatus);
              }}
              onCreateInColumn={onCreateInColumn}
            />
          ))}
        </div>
      </section>

      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="w-[300px] sm:w-[320px] pointer-events-none">
            <TaskCard
              task={activeTask}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              onOpenDetail={() => {}}
              isOverlay
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
