import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import type {
  CommentCreatedPayload,
  TaskApprovedPayload,
  TaskMovedPayload,
} from '../lib/socket';
import { TASK_STATUS_LABELS, type Task } from '../types/kanban';

export interface CelebrationPayload {
  key: number;
  taskId: string;
  taskTitle: string;
  approvedBy?: string;
}

interface UseKanbanRealtimeOptions {
  onApproveCelebration: (taskId: string, taskTitle: string, approvedBy?: string) => void;
}

function formatTaskTitle(title: string): string {
  return title.trim();
}

export function useKanbanRealtime({ onApproveCelebration }: UseKanbanRealtimeOptions): void {
  const { socket, user, users, tasks } = useAuth();

  const userRef = useRef(user);
  const usersRef = useRef(users);
  const tasksRef = useRef(tasks);
  const celebrationCbRef = useRef(onApproveCelebration);

  userRef.current = user;
  usersRef.current = users;
  tasksRef.current = tasks;
  celebrationCbRef.current = onApproveCelebration;

  useEffect(() => {
    if (!socket) return;

    const handleTaskMoved = ({ task, fromStatus, toStatus, by }: TaskMovedPayload) => {
      const currentUser = userRef.current;
      if (!currentUser) return;

      // Evitar toast duplicado cuando la tarea entra a APROBADO (se maneja en task:approved)
      if (toStatus === 'APPROVED' && fromStatus !== 'APPROVED') {
        return;
      }

      if (by && by.id !== currentUser.id) {
        toast.info(
          `${by.displayName} movió '${formatTaskTitle(task.title)}' a ${TASK_STATUS_LABELS[toStatus]}`,
        );
      }
    };

    const handleTaskApproved = ({ task, by }: TaskApprovedPayload) => {
      const currentUser = userRef.current;
      celebrationCbRef.current(task.id, task.title, by?.displayName);

      if (currentUser && by && by.id !== currentUser.id) {
        toast.success(`🎉 '${formatTaskTitle(task.title)}' fue aprobada`);
      }
    };

    const handleTaskCreated = (task: Task) => {
      const currentUser = userRef.current;
      if (!currentUser) return;
      if (task.createdById && task.createdById !== currentUser.id) {
        const creator = usersRef.current.find((u) => u.id === task.createdById);
        const actor = creator ? creator.displayName : 'El líder';
        toast.info(`${actor} creó la actividad '${formatTaskTitle(task.title)}'`);
      }
    };

    const handleCommentCreated = ({ taskId, comment }: CommentCreatedPayload) => {
      const currentUser = userRef.current;
      if (!currentUser) return;
      if (comment.author.id !== currentUser.id) {
        const task = tasksRef.current.find((t) => t.id === taskId);
        const taskLabel = task ? `'${formatTaskTitle(task.title)}'` : 'una tarea';
        toast.info(`${comment.author.displayName} comentó en ${taskLabel}`);
      }
    };

    socket.on('task:moved', handleTaskMoved);
    socket.on('task:approved', handleTaskApproved);
    socket.on('task:created', handleTaskCreated);
    socket.on('comment:created', handleCommentCreated);

    return () => {
      socket.off('task:moved', handleTaskMoved);
      socket.off('task:approved', handleTaskApproved);
      socket.off('task:created', handleTaskCreated);
      socket.off('comment:created', handleCommentCreated);
    };
  }, [socket]);
}
