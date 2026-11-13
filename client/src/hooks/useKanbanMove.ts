import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import type { Task, TaskStatus } from '../types/kanban';

interface UseKanbanMoveOptions {
  onApproveCelebration: (taskId: string, taskTitle: string, approvedBy?: string) => void;
}

export function useKanbanMove({ onApproveCelebration }: UseKanbanMoveOptions) {
  const { user, tasks, setTasks, socket } = useAuth();
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const moveTask = useCallback(
    async (task: Task, toStatus: TaskStatus, position?: number): Promise<boolean> => {
      if (!user) return false;

      if (user.role !== 'LEADER') {
        if (!task.assignedToAll && task.assigneeId !== user.id) {
          toast.error('Solo puedes mover tus tareas asignadas');
          return false;
        }
        if (task.status === 'APPROVED' || toStatus === 'APPROVED') {
          toast.error('Solo el líder puede aprobar tareas');
          return false;
        }
      }

      const snapshot = tasksRef.current;

      const sameColTasks = snapshot
        .filter((t) => t.status === toStatus && t.id !== task.id)
        .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));

      const targetPosition =
        position !== undefined && Number.isFinite(position) && position >= 0
          ? position
          : sameColTasks.length === 0
            ? 0
            : sameColTasks[sameColTasks.length - 1].position + 1000;

      const enteringApproved = toStatus === 'APPROVED' && task.status !== 'APPROVED';
      const optimisticTask: Task = {
        ...task,
        status: toStatus,
        position: targetPosition,
        approvedAt:
          toStatus === 'APPROVED'
            ? enteringApproved
              ? new Date().toISOString()
              : task.approvedAt ?? new Date().toISOString()
            : null,
      };

      setTasks((prev) =>
        prev
          .map((t) => (t.id === task.id ? optimisticTask : t))
          .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt)),
      );

      // Si el socket está conectado, usamos task:move con ack
      if (socket && socket.connected) {
        return new Promise<boolean>((resolve) => {
          let settled = false;
          const timeoutId = window.setTimeout(() => {
            if (!settled) {
              settled = true;
              // Si el ack tardó demasiado, hacemos fallback a REST
              api
                .moveTask(task.id, { status: toStatus, position: targetPosition })
                .then((updated) => {
                  setTasks((prev) =>
                    prev
                      .map((t) => (t.id === updated.id ? updated : t))
                      .sort(
                        (a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt),
                      ),
                  );
                  if (enteringApproved) {
                    onApproveCelebration(updated.id, updated.title, user.displayName);
                  }
                  resolve(true);
                })
                .catch((err) => {
                  setTasks(snapshot);
                  const msg = err instanceof ApiError ? err.message : 'No se pudo mover la tarea';
                  toast.error(msg);
                  resolve(false);
                });
            }
          }, 5000);

          socket.emit(
            'task:move',
            { taskId: task.id, status: toStatus, position: targetPosition },
            (ack) => {
              if (settled) return;
              settled = true;
              window.clearTimeout(timeoutId);

              if (!ack || !ack.ok) {
                setTasks(snapshot);
                toast.error(ack?.error || 'No se pudo mover la tarea');
                resolve(false);
                return;
              }

              setTasks((prev) =>
                prev
                  .map((t) => (t.id === ack.task.id ? ack.task : t))
                  .sort(
                    (a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt),
                  ),
              );
              resolve(true);
            },
          );
        });
      }

      // Fallback REST cuando el socket está desconectado
      try {
        const updated = await api.moveTask(task.id, {
          status: toStatus,
          position: targetPosition,
        });
        setTasks((prev) =>
          prev
            .map((t) => (t.id === updated.id ? updated : t))
            .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt)),
        );
        if (enteringApproved) {
          onApproveCelebration(updated.id, updated.title, user.displayName);
        }
        return true;
      } catch (err) {
        setTasks(snapshot);
        const msg = err instanceof ApiError ? err.message : 'No se pudo mover la tarea';
        toast.error(msg);
        return false;
      }
    },
    [user, socket, setTasks, onApproveCelebration],
  );

  return { moveTask };
}
