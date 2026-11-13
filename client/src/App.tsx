import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Toaster } from 'sonner';
import { LoginScreen } from './components/auth/LoginScreen';
import { AvatarStudioModal } from './components/avatars/AvatarStudioModal';
import { ActivityDrawer } from './components/kanban/ActivityDrawer';
import { ApprovalCelebration } from './components/kanban/ApprovalCelebration';
import { KanbanBoard } from './components/kanban/KanbanBoard';
import { KanbanToolbar, type KanbanFilters } from './components/kanban/KanbanToolbar';
import { OverdueTasksAlert } from './components/kanban/OverdueTasksAlert';
import { TaskDetailModal } from './components/kanban/TaskDetailModal';
import { TaskFormModal } from './components/kanban/TaskFormModal';
import { TopHeader } from './components/layout/TopHeader';
import { TeamModal } from './components/team/TeamModal';
import { OnboardingTutorialModal } from './components/tutorial/OnboardingTutorialModal';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { useKanbanMove } from './hooks/useKanbanMove';
import { useKanbanRealtime, type CelebrationPayload } from './hooks/useKanbanRealtime';
import type { Task, TaskStatus } from './types/kanban';

function BoardShell() {
  const { user, users, tasks, isLoading } = useAuth();

  const [avatarStudioOpen, setAvatarStudioOpen] = useState(false);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);

  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [formModalState, setFormModalState] = useState<{
    open: boolean;
    task: Task | null;
    initialStatus: TaskStatus;
  }>({
    open: false,
    task: null,
    initialStatus: 'TODO',
  });

  const [filters, setFilters] = useState<KanbanFilters>({
    search: '',
    scope: 'ALL',
    assigneeId: 'ALL',
    priority: 'ALL',
  });

  const [celebration, setCelebration] = useState<CelebrationPayload | null>(null);
  const lastCelebrationRef = useRef<{ taskId: string; ts: number } | null>(null);

  // Mostrar el mini tutorial automáticamente la primera vez que el usuario ingresa
  useEffect(() => {
    if (!user) return;
    try {
      const seenKey = `kanban_tutorial_v1_${user.id}`;
      if (!window.localStorage.getItem(seenKey)) {
        setTutorialOpen(true);
      }
    } catch {
      // Ignorar si el almacenamiento local está restringido
    }
  }, [user]);

  const handleCloseTutorial = useCallback(() => {
    if (user) {
      try {
        window.localStorage.setItem(`kanban_tutorial_v1_${user.id}`, 'true');
      } catch {
        // Ignorar si el almacenamiento local está restringido
      }
    }
    setTutorialOpen(false);
  }, [user]);

  const triggerCelebration = useCallback(
    (taskId: string, taskTitle: string, approvedBy?: string) => {
      const now = Date.now();
      if (
        lastCelebrationRef.current &&
        lastCelebrationRef.current.taskId === taskId &&
        now - lastCelebrationRef.current.ts < 2000
      ) {
        return;
      }
      lastCelebrationRef.current = { taskId, ts: now };
      setCelebration({
        key: now,
        taskId,
        taskTitle,
        approvedBy,
      });
    },
    [],
  );

  useKanbanRealtime({ onApproveCelebration: triggerCelebration });
  const { moveTask } = useKanbanMove({ onApproveCelebration: triggerCelebration });

  const myTasksCount = useMemo(
    () => (user ? tasks.filter((t) => t.assignedToAll || t.assigneeId === user.id).length : 0),
    [tasks, user],
  );

  const filteredTasks = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (query) {
        const hay = `${task.title} ${task.description}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      if (filters.scope === 'MINE' && user) {
        if (!task.assignedToAll && task.assigneeId !== user.id) return false;
      }
      if (filters.assigneeId === 'UNASSIGNED') {
        if (task.assigneeId !== null || task.assignedToAll) return false;
      } else if (filters.assigneeId === 'TEAM') {
        if (!task.assignedToAll) return false;
      } else if (filters.assigneeId !== 'ALL') {
        if (!task.assignedToAll && task.assigneeId !== filters.assigneeId) return false;
      }
      if (filters.priority !== 'ALL') {
        if (task.priority !== filters.priority) return false;
      }
      return true;
    });
  }, [tasks, filters, user]);

  const hasActiveFilters =
    filters.search.trim().length > 0 ||
    filters.scope !== 'ALL' ||
    filters.assigneeId !== 'ALL' ||
    filters.priority !== 'ALL';

  const handleOpenCreateModal = useCallback(
    (initialStatus: TaskStatus = 'TODO') => {
      const safeStatus =
        user?.role !== 'LEADER' && initialStatus === 'APPROVED' ? 'TODO' : initialStatus;
      setFormModalState({
        open: true,
        task: null,
        initialStatus: safeStatus,
      });
    },
    [user?.role],
  );

  const handleOpenEditModal = useCallback(
    (task: Task) => {
      if (user?.role !== 'LEADER') return;
      setDetailTaskId(null);
      setFormModalState({
        open: true,
        task,
        initialStatus: task.status,
      });
    },
    [user?.role],
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 overflow-x-hidden bg-[#F3F4F6] dark:bg-[#111215] text-zinc-600 dark:text-zinc-300">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <p className="text-sm font-medium">Cargando Tablero Kanban...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden bg-[#F3F4F6] dark:bg-[#111215] transition-colors">
      <TopHeader
        onOpenAvatarStudio={() => setAvatarStudioOpen(true)}
        onOpenTeam={() => setTeamModalOpen(true)}
        onOpenTutorial={() => setTutorialOpen(true)}
      />

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-2.5 sm:px-6 sm:py-4 lg:px-8 space-y-2.5 sm:space-y-3.5">
        <KanbanToolbar
          filters={filters}
          onChangeFilters={setFilters}
          users={users}
          currentUserId={user.id}
          currentUserRole={user.role}
          myTasksCount={myTasksCount}
          totalTasksCount={tasks.length}
          filteredTasksCount={filteredTasks.length}
          onCreateTask={() => handleOpenCreateModal('TODO')}
          onOpenActivity={() => setActivityOpen(true)}
        />

        <OverdueTasksAlert
          tasks={tasks}
          currentUserId={user.id}
          currentUserRole={user.role}
          onOpenTask={(id) => setDetailTaskId(id)}
        />

        <KanbanBoard
          allTasks={tasks}
          filteredTasks={filteredTasks}
          hasActiveFilters={hasActiveFilters}
          currentUserId={user.id}
          currentUserRole={user.role}
          onMoveTask={moveTask}
          onOpenDetail={(task) => setDetailTaskId(task.id)}
          onCreateInColumn={
            user.role === 'LEADER' || user.role === 'SUBLEADER'
              ? (status) => handleOpenCreateModal(status)
              : undefined
          }
        />
      </main>

      <TaskDetailModal
        taskId={detailTaskId}
        onClose={() => setDetailTaskId(null)}
        onEditTask={handleOpenEditModal}
        onMoveTask={(task, toStatus) => moveTask(task, toStatus)}
      />

      {user.role === 'LEADER' || user.role === 'SUBLEADER' ? (
        <TaskFormModal
          open={formModalState.open}
          task={user.role === 'LEADER' ? formModalState.task : null}
          initialStatus={formModalState.initialStatus}
          onClose={() =>
            setFormModalState((prev) => ({
              ...prev,
              open: false,
            }))
          }
        />
      ) : null}

      {user.role === 'LEADER' ? (
        <TeamModal
          open={teamModalOpen}
          onClose={() => setTeamModalOpen(false)}
          onOpenMyProfile={() => setAvatarStudioOpen(true)}
        />
      ) : null}

      <ActivityDrawer
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        onSelectTask={(id) => setDetailTaskId(id)}
      />

      <AvatarStudioModal open={avatarStudioOpen} onClose={() => setAvatarStudioOpen(false)} />

      <ApprovalCelebration
        celebration={celebration}
        onComplete={() => setCelebration(null)}
      />

      <OnboardingTutorialModal
        open={tutorialOpen}
        onClose={handleCloseTutorial}
      />
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BoardShell />
        <Toaster
          richColors
          position="bottom-right"
          toastOptions={{ className: 'break-words' }}
        />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
