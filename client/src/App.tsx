import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { CheckCircle2, Loader2, LogOut, RefreshCw, ServerCrash, ShieldAlert, Wrench } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { KanbanToolbar, type KanbanFilters } from './components/kanban/KanbanToolbar';
import { OverdueTasksAlert } from './components/kanban/OverdueTasksAlert';
import { TopHeader } from './components/layout/TopHeader';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { useKanbanMove } from './hooks/useKanbanMove';
import { useKanbanRealtime, type CelebrationPayload } from './hooks/useKanbanRealtime';
import { ApiError } from './lib/api';
import { getMaintenanceSourceLabel, type Task, type TaskStatus } from './types/kanban';

const LoginScreen = lazy(() =>
  import('./components/auth/LoginScreen').then((m) => ({ default: m.LoginScreen })),
);
const MaintenanceScreen = lazy(() =>
  import('./components/maintenance/MaintenanceScreen').then((m) => ({
    default: m.MaintenanceScreen,
  })),
);
const KanbanBoard = lazy(() =>
  import('./components/kanban/KanbanBoard').then((m) => ({ default: m.KanbanBoard })),
);
const TaskDetailModal = lazy(() =>
  import('./components/kanban/TaskDetailModal').then((m) => ({ default: m.TaskDetailModal })),
);
const TaskFormModal = lazy(() =>
  import('./components/kanban/TaskFormModal').then((m) => ({ default: m.TaskFormModal })),
);
const TeamModal = lazy(() =>
  import('./components/team/TeamModal').then((m) => ({ default: m.TeamModal })),
);
const MaintenanceModal = lazy(() =>
  import('./components/maintenance/MaintenanceModal').then((m) => ({
    default: m.MaintenanceModal,
  })),
);
const ActivityDrawer = lazy(() =>
  import('./components/kanban/ActivityDrawer').then((m) => ({ default: m.ActivityDrawer })),
);
const AvatarStudioModal = lazy(() =>
  import('./components/avatars/AvatarStudioModal').then((m) => ({
    default: m.AvatarStudioModal,
  })),
);
const ApprovalCelebration = lazy(() =>
  import('./components/kanban/ApprovalCelebration').then((m) => ({
    default: m.ApprovalCelebration,
  })),
);
const OnboardingTutorialModal = lazy(() =>
  import('./components/tutorial/OnboardingTutorialModal').then((m) => ({
    default: m.OnboardingTutorialModal,
  })),
);

function useEverOpened(isOpen: boolean): boolean {
  const [everOpened, setEverOpened] = useState(isOpen);
  useEffect(() => {
    if (isOpen) {
      setEverOpened(true);
    }
  }, [isOpen]);
  return everOpened;
}

function ScreenFallback({ label = 'Cargando vista...' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-screen flex flex-col items-center justify-center gap-3 overflow-x-hidden bg-[#F3F4F6] dark:bg-[#111215] text-slate-600 dark:text-slate-300"
    >
      <Loader2 className="h-8 w-8 animate-spin text-blue-600" aria-hidden="true" />
      <p className="text-sm font-medium">{label}</p>
    </div>
  );
}

function BoardFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[360px] flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-200/80 bg-white/70 p-8 text-slate-600 dark:border-[#272A33] dark:bg-[#181A1F]/70 dark:text-slate-300"
    >
      <Loader2 className="h-7 w-7 animate-spin text-blue-600" aria-hidden="true" />
      <p className="text-sm font-medium">Cargando columnas del tablero...</p>
    </div>
  );
}

function BoardShell() {
  const {
    user,
    token,
    users,
    tasks,
    isLoading,
    bootstrapError,
    isRetryingSession,
    retrySession,
    logout,
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

  const detailMounted = useEverOpened(detailTaskId !== null);
  const formMounted = useEverOpened(formModalState.open);
  const teamMounted = useEverOpened(teamModalOpen);
  const maintenanceMounted = useEverOpened(maintenanceModalOpen);
  const activityMounted = useEverOpened(activityOpen);
  const avatarStudioMounted = useEverOpened(avatarStudioOpen);
  const celebrationMounted = useEverOpened(celebration !== null);
  const tutorialMounted = useEverOpened(tutorialOpen);

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

  const handleOpenDetail = useCallback((task: Task) => {
    setDetailTaskId(task.id);
  }, []);

  const handleOpenTaskById = useCallback((taskId: string) => {
    setDetailTaskId(taskId);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailTaskId(null);
  }, []);

  const handleOpenCreateTodo = useCallback(() => {
    handleOpenCreateModal('TODO');
  }, [handleOpenCreateModal]);

  const handleCloseFormModal = useCallback(() => {
    setFormModalState((prev) => ({
      ...prev,
      open: false,
    }));
  }, []);

  const handleOpenAvatarStudio = useCallback(() => setAvatarStudioOpen(true), []);
  const handleCloseAvatarStudio = useCallback(() => setAvatarStudioOpen(false), []);
  const handleOpenTeamModal = useCallback(() => setTeamModalOpen(true), []);
  const handleCloseTeamModal = useCallback(() => setTeamModalOpen(false), []);
  const handleOpenMaintenanceModal = useCallback(() => setMaintenanceModalOpen(true), []);
  const handleCloseMaintenanceModal = useCallback(() => setMaintenanceModalOpen(false), []);
  const handleOpenActivity = useCallback(() => setActivityOpen(true), []);
  const handleCloseActivity = useCallback(() => setActivityOpen(false), []);
  const handleOpenTutorial = useCallback(() => setTutorialOpen(true), []);
  const handleCompleteCelebration = useCallback(() => setCelebration(null), []);

  if (isLoading) {
    return <ScreenFallback label="Cargando Tablero Kanban..." />;
  }

  if (maintenanceStatus?.active && !user) {
    return (
      <Suspense fallback={<ScreenFallback />}>
        <MaintenanceScreen
          status={maintenanceStatus}
          onRefresh={refreshMaintenance}
          allowLeaderLogin
        />
      </Suspense>
    );
  }

  if (token && !user && bootstrapError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-[#F3F4F6] dark:bg-[#111215]">
        <div
          role="alert"
          className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 sm:p-7 shadow-xl dark:border-[#272A33] dark:bg-[#181A1F]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300">
              <ServerCrash className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                Conectando con el servidor
              </h1>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                El servidor puede estar despertando tras inactividad
              </p>
            </div>
          </div>

          <p className="mt-4 text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {bootstrapError}
          </p>

          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
            Tu sesión local se conservó de forma segura. Puedes reintentar la conexión sin volver a
            escribir tu contraseña.
          </p>

          <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={() => void retrySession()}
              disabled={isRetryingSession}
              className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs sm:text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-65"
            >
              {isRetryingSession ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Despertando servidor...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  <span>Reintentar conexión</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => logout('Sesión cerrada')}
              disabled={isRetryingSession}
              className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-65 dark:border-[#2D3038] dark:bg-[#212329] dark:text-slate-200 dark:hover:bg-[#292C34]"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>Cerrar sesión</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Suspense fallback={<ScreenFallback />}>
        <LoginScreen />
      </Suspense>
    );
  }

  if (maintenanceStatus?.active && user.role !== 'LEADER') {
    return (
      <Suspense fallback={<ScreenFallback />}>
        <MaintenanceScreen status={maintenanceStatus} onRefresh={refreshMaintenance} />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden bg-[#F3F4F6] dark:bg-[#111215] transition-colors">
      <TopHeader
        onOpenAvatarStudio={handleOpenAvatarStudio}
        onOpenTeam={handleOpenTeamModal}
        onOpenTutorial={handleOpenTutorial}
        onOpenMaintenance={user.role === 'LEADER' ? handleOpenMaintenanceModal : undefined}
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
                    onClick={handleOpenMaintenanceModal}
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
                    onClick={handleOpenMaintenanceModal}
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
          onCreateTask={handleOpenCreateTodo}
          onOpenActivity={handleOpenActivity}
        />

        <OverdueTasksAlert
          tasks={tasks}
          currentUserId={user.id}
          currentUserRole={user.role}
          onOpenTask={handleOpenTaskById}
        />

        <Suspense fallback={<BoardFallback />}>
          <KanbanBoard
            allTasks={tasks}
            filteredTasks={filteredTasks}
            hasActiveFilters={hasActiveFilters}
            currentUserId={user.id}
            currentUserRole={user.role}
            onMoveTask={moveTask}
            onOpenDetail={handleOpenDetail}
            onCreateInColumn={
              user.role === 'LEADER' || user.role === 'SUBLEADER'
                ? handleOpenCreateModal
                : undefined
            }
          />
        </Suspense>
      </main>

      {detailMounted ? (
        <Suspense fallback={null}>
          <TaskDetailModal
            taskId={detailTaskId}
            onClose={handleCloseDetail}
            onEditTask={handleOpenEditModal}
            onMoveTask={moveTask}
          />
        </Suspense>
      ) : null}

      {(user.role === 'LEADER' || user.role === 'SUBLEADER') && formMounted ? (
        <Suspense fallback={null}>
          <TaskFormModal
            open={formModalState.open}
            task={user.role === 'LEADER' ? formModalState.task : null}
            initialStatus={formModalState.initialStatus}
            onClose={handleCloseFormModal}
          />
        </Suspense>
      ) : null}

      {user.role === 'LEADER' ? (
        <>
          {teamMounted ? (
            <Suspense fallback={null}>
              <TeamModal
                open={teamModalOpen}
                onClose={handleCloseTeamModal}
                onOpenMyProfile={handleOpenAvatarStudio}
              />
            </Suspense>
          ) : null}
          {maintenanceMounted ? (
            <Suspense fallback={null}>
              <MaintenanceModal
                open={maintenanceModalOpen}
                onClose={handleCloseMaintenanceModal}
              />
            </Suspense>
          ) : null}
        </>
      ) : null}

      {activityMounted ? (
        <Suspense fallback={null}>
          <ActivityDrawer
            open={activityOpen}
            onClose={handleCloseActivity}
            onSelectTask={handleOpenTaskById}
          />
        </Suspense>
      ) : null}

      {avatarStudioMounted ? (
        <Suspense fallback={null}>
          <AvatarStudioModal open={avatarStudioOpen} onClose={handleCloseAvatarStudio} />
        </Suspense>
      ) : null}

      {celebrationMounted ? (
        <Suspense fallback={null}>
          <ApprovalCelebration
            celebration={celebration}
            onComplete={handleCompleteCelebration}
          />
        </Suspense>
      ) : null}

      {tutorialMounted ? (
        <Suspense fallback={null}>
          <OnboardingTutorialModal
            open={tutorialOpen}
            onClose={handleCloseTutorial}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
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
    </MotionConfig>
  );
}

export default App;
