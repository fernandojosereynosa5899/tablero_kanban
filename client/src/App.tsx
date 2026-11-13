import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, ShieldAlert, Wrench } from 'lucide-react';
import { Toaster, toast } from 'sonner';
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
import { MaintenanceModal } from './components/maintenance/MaintenanceModal';
import {
  getMaintenanceSourceLabel,
  MaintenanceScreen,
} from './components/maintenance/MaintenanceScreen';
import { TeamModal } from './components/team/TeamModal';
import { OnboardingTutorialModal } from './components/tutorial/OnboardingTutorialModal';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { useKanbanMove } from './hooks/useKanbanMove';
import { useKanbanRealtime, type CelebrationPayload } from './hooks/useKanbanRealtime';
import { ApiError } from './lib/api';
import type { Task, TaskStatus } from './types/kanban';

function BoardShell() {
  const {
    user,
    users,
    tasks,
    isLoading,
    maintenanceStatus,
    refreshMaintenance,
    updateMaintenance,
  } = useAuth();

  const [avatarStudioOpen, setAvatarStudioOpen] = useState(false);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [maintenanceModalOpen, setMaintenanceModalOpen] = useState(false);
  const [endingMaintenance, setEndingMaintenance] = useState(false);
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

  const handleQuickDisableMaintenance = useCallback(async () => {
    if (!maintenanceStatus?.canDisableInApp || endingMaintenance) return;
    setEndingMaintenance(true);
    try {
      await updateMaintenance({ enabled: false });
      toast.success('Mantenimiento finalizado. El tablero fue reabierto para todo el equipo.');
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'No se pudo finalizar la ventana de mantenimiento.';
      toast.error(msg);
    } finally {
      setEndingMaintenance(false);
    }
  }, [maintenanceStatus?.canDisableInApp, endingMaintenance, updateMaintenance]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 overflow-x-hidden bg-[#F3F4F6] dark:bg-[#111215] text-zinc-600 dark:text-zinc-300">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <p className="text-sm font-medium">Cargando Tablero Kanban...</p>
      </div>
    );
  }

  if (maintenanceStatus?.active && !user) {
    return (
      <MaintenanceScreen
        status={maintenanceStatus}
        onRefresh={refreshMaintenance}
        allowLeaderLogin
      />
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  if (maintenanceStatus?.active && user.role !== 'LEADER') {
    return (
      <MaintenanceScreen status={maintenanceStatus} onRefresh={refreshMaintenance} />
    );
  }

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden bg-[#F3F4F6] dark:bg-[#111215] transition-colors">
      <TopHeader
        onOpenAvatarStudio={() => setAvatarStudioOpen(true)}
        onOpenTeam={() => setTeamModalOpen(true)}
        onOpenTutorial={() => setTutorialOpen(true)}
        onOpenMaintenance={
          user.role === 'LEADER' ? () => setMaintenanceModalOpen(true) : undefined
        }
        maintenanceActive={Boolean(maintenanceStatus?.active)}
      />

      {maintenanceStatus?.active && user.role === 'LEADER' ? (
        <div
          role="status"
          aria-live="polite"
          className="border-b border-amber-300/80 bg-gradient-to-r from-amber-50 via-amber-50/90 to-indigo-50/90 dark:border-amber-500/30 dark:from-amber-950/60 dark:via-[#1D1B17] dark:to-indigo-950/50"
        >
          <div className="mx-auto max-w-[1600px] px-3 py-2.5 sm:px-6 lg:px-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start sm:items-center gap-2.5 min-w-0">
              <span className="mt-0.5 sm:mt-0 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                <Wrench className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-xs sm:text-sm font-semibold text-amber-950 dark:text-amber-100">
                  Ventana de mantenimiento activa para el equipo — los integrantes ven la pantalla
                  de mantenimiento
                </p>
                <span className="inline-flex items-center rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200/80 dark:bg-indigo-500/15 dark:text-indigo-200 dark:ring-indigo-500/30">
                  {getMaintenanceSourceLabel(maintenanceStatus.source)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {maintenanceStatus.canDisableInApp ? (
                <>
                  <button
                    type="button"
                    onClick={() => setMaintenanceModalOpen(true)}
                    disabled={endingMaintenance}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white/90 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-500/30 dark:bg-[#212329] dark:text-indigo-200 dark:hover:bg-indigo-500/20"
                  >
                    Configurar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleQuickDisableMaintenance()}
                    disabled={endingMaintenance}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {endingMaintenance ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Finalizando...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Finalizar mantenimiento
                      </>
                    )}
                  </button>
                </>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/80 bg-white/85 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:border-amber-500/35 dark:bg-[#22201A] dark:text-amber-200">
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300" />
                    Activado por despliegue/entorno
                  </span>
                  <button
                    type="button"
                    onClick={() => setMaintenanceModalOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white/90 px-2.5 py-1 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 dark:border-indigo-500/30 dark:bg-[#212329] dark:text-indigo-200 dark:hover:bg-indigo-500/20"
                  >
                    Ver detalles
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

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
        <>
          <TeamModal
            open={teamModalOpen}
            onClose={() => setTeamModalOpen(false)}
            onOpenMyProfile={() => setAvatarStudioOpen(true)}
          />
          <MaintenanceModal
            open={maintenanceModalOpen}
            onClose={() => setMaintenanceModalOpen(false)}
          />
        </>
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
