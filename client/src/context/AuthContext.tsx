import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { toast } from 'sonner';
import {
  ApiError,
  api,
  setApiAuthToken,
  setMaintenanceHandler,
  setUnauthorizedHandler,
  type UpdateMaintenanceInput,
  type UpdateMeInput,
} from '../lib/api';
import { createKanbanSocket, type KanbanSocket } from '../lib/socket';
import { MAX_USERS, type MaintenanceStatus, type Task, type UserPublic } from '../types/kanban';

const TOKEN_STORAGE_KEY = 'kanban_token';

interface AuthContextValue {
  user: UserPublic | null;
  token: string | null;
  users: UserPublic[];
  maxUsers: number;
  tasks: Task[];
  setTasks: Dispatch<SetStateAction<Task[]>>;
  isLoading: boolean;
  bootstrapError: string | null;
  isRetryingSession: boolean;
  retrySession: () => Promise<void>;
  isConnected: boolean;
  onlineUserIds: string[];
  socket: KanbanSocket | null;
  maintenanceStatus: MaintenanceStatus | null;
  login: (username: string, password: string) => Promise<void>;
  logout: (message?: string) => void;
  refreshUsers: () => Promise<void>;
  refreshTasks: () => Promise<void>;
  refreshMaintenance: () => Promise<MaintenanceStatus | null>;
  updateMaintenance: (input: UpdateMaintenanceInput) => Promise<MaintenanceStatus>;
  updateProfile: (input: UpdateMeInput) => Promise<UserPublic>;
  updateMyPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  registerCommentCreated: (taskId: string, commentId: string) => void;
  registerCommentDeleted: (taskId: string, commentId: string) => void;
  registerAttachmentCreated: (taskId: string, attachmentId: string) => void;
  registerAttachmentDeleted: (taskId: string, attachmentId: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function sortUsersBySlot(list: UserPublic[]): UserPublic[] {
  return list.toSorted((a, b) => a.slot - b.slot);
}

function upsertTask(list: Task[], incoming: Task): Task[] {
  const idx = list.findIndex((t) => t.id === incoming.id);
  const next = idx === -1 ? [...list, incoming] : list.map((t, i) => (i === idx ? incoming : t));
  return next.toSorted((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

function trackBounded(bucket: Set<string>, id: string): boolean {
  if (bucket.has(id)) return false;
  bucket.add(id);
  if (bucket.size > 400) {
    const first = bucket.values().next().value;
    if (first) bucket.delete(first);
  }
  return true;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  });
  const [user, setUser] = useState<UserPublic | null>(null);
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [maxUsers, setMaxUsers] = useState<number>(MAX_USERS);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [isRetryingSession, setIsRetryingSession] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [socket, setSocket] = useState<KanbanSocket | null>(null);
  const [maintenanceStatus, setMaintenanceStatus] = useState<MaintenanceStatus | null>(null);

  const socketRef = useRef<KanbanSocket | null>(null);
  const tokenRef = useRef<string | null>(token);
  const userRef = useRef<UserPublic | null>(user);
  tokenRef.current = token;
  userRef.current = user;
  const suppressRevokeRef = useRef<boolean>(false);
  const prevMaintenanceActiveRef = useRef<boolean>(false);
  const isResyncingRef = useRef<boolean>(false);
  const bootstrapInFlightRef = useRef<Promise<void> | null>(null);
  const unauthorizedNotifiedRef = useRef<boolean>(false);

  const seenCreatedCommentIdsRef = useRef<Set<string>>(new Set());
  const seenDeletedCommentIdsRef = useRef<Set<string>>(new Set());
  const seenCreatedAttachmentIdsRef = useRef<Set<string>>(new Set());
  const seenDeletedAttachmentIdsRef = useRef<Set<string>>(new Set());

  const clearSession = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setSocket(null);
    setIsConnected(false);
    setOnlineUserIds([]);
    setApiAuthToken(null);
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
    setUsers([]);
    setTasks([]);
    setBootstrapError(null);
    seenCreatedCommentIdsRef.current.clear();
    seenDeletedCommentIdsRef.current.clear();
    seenCreatedAttachmentIdsRef.current.clear();
    seenDeletedAttachmentIdsRef.current.clear();
  }, []);

  const logout = useCallback(
    (message?: string) => {
      clearSession();
      if (message) {
        toast.info(message);
      }
    },
    [clearSession],
  );

  const refreshMaintenance = useCallback(async (): Promise<MaintenanceStatus | null> => {
    try {
      const status = await api.getMaintenanceStatus();
      setMaintenanceStatus(status);
      return status;
    } catch {
      return null;
    }
  }, []);

  const updateMaintenance = useCallback(
    async (input: UpdateMaintenanceInput): Promise<MaintenanceStatus> => {
      const updated = await api.updateMaintenanceStatus(input);
      setMaintenanceStatus(updated);
      return updated;
    },
    [],
  );

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (unauthorizedNotifiedRef.current) return;
      unauthorizedNotifiedRef.current = true;
      clearSession();
      toast.error('Tu sesión expiró. Inicia sesión nuevamente.');
    });
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  useEffect(() => {
    setMaintenanceHandler((status) => {
      if (status) {
        setMaintenanceStatus(status);
      } else {
        void refreshMaintenance();
      }
    });
    return () => setMaintenanceHandler(null);
  }, [refreshMaintenance]);

  const refreshUsers = useCallback(async () => {
    const res = await api.listUsers();
    setUsers(sortUsersBySlot(res.users));
    setMaxUsers(res.maxUsers);
  }, []);

  const refreshTasks = useCallback(async () => {
    const list = await api.listTasks();
    setTasks(list);
  }, []);

  const registerCommentCreated = useCallback((taskId: string, commentId: string) => {
    if (!trackBounded(seenCreatedCommentIdsRef.current, commentId)) return;
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, commentCount: t.commentCount + 1 } : t)),
    );
  }, []);

  const registerCommentDeleted = useCallback((taskId: string, commentId: string) => {
    if (!trackBounded(seenDeletedCommentIdsRef.current, commentId)) return;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, commentCount: Math.max(0, t.commentCount - 1) } : t,
      ),
    );
  }, []);

  const registerAttachmentCreated = useCallback((taskId: string, attachmentId: string) => {
    if (!trackBounded(seenCreatedAttachmentIdsRef.current, attachmentId)) return;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, attachmentCount: (t.attachmentCount ?? 0) + 1 } : t,
      ),
    );
  }, []);

  const registerAttachmentDeleted = useCallback((taskId: string, attachmentId: string) => {
    if (!trackBounded(seenDeletedAttachmentIdsRef.current, attachmentId)) return;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, attachmentCount: Math.max(0, (t.attachmentCount ?? 0) - 1) } : t,
      ),
    );
  }, []);

  const loadSession = useCallback(
    async (isActiveCheck?: () => boolean): Promise<void> => {
      const stillActive = () => (isActiveCheck ? isActiveCheck() : true);
      const statusPromise = api.getMaintenanceStatus().catch(() => null);
      const storedToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);

      if (!storedToken) {
        setApiAuthToken(null);
        setToken(null);
        setUser(null);
        setBootstrapError(null);
        const status = await statusPromise;
        if (!stillActive()) return;
        if (status) {
          setMaintenanceStatus((prev) => status ?? prev);
        }
        return;
      }

      unauthorizedNotifiedRef.current = false;
      setApiAuthToken(storedToken);
      setToken(storedToken);

      try {
        const [status, me] = await Promise.all([statusPromise, api.getMe()]);
        if (!stillActive()) return;
        if (status) {
          setMaintenanceStatus((prev) => status ?? prev);
        }

        const [usersRes, tasksList] = await Promise.all([api.listUsers(), api.listTasks()]);
        if (!stillActive()) return;

        setToken(storedToken);
        setUser(me);
        setUsers(sortUsersBySlot(usersRes.users));
        setMaxUsers(usersRes.maxUsers);
        setTasks(tasksList);
        setBootstrapError(null);
      } catch (err) {
        if (!stillActive()) return;
        const status = await statusPromise;
        if (!stillActive()) return;
        if (status?.active) {
          setMaintenanceStatus(status);
        } else if (status) {
          setMaintenanceStatus((prev) => (prev?.active ? prev : status));
        }

        const isMaintenanceError =
          (err instanceof ApiError && err.status === 503) || Boolean(status?.active);
        const isAuthRejected = err instanceof ApiError && (err.status === 401 || err.status === 403);

        if (isMaintenanceError) {
          // Conservar el token para recuperar la sesión al finalizar la ventana de mantenimiento
          const fallbackMaintenance: MaintenanceStatus = {
            active: true,
            source: 'database',
            canDisableInApp: true,
            title: 'Tablero Kanban en mantenimiento',
            message: err instanceof ApiError ? err.message : 'Estamos aplicando mejoras en el servidor.',
            estimatedMinutes: null,
            updatedByName: null,
            updatedAt: new Date().toISOString(),
          };
          setApiAuthToken(storedToken);
          setToken(storedToken);
          setUser(null);
          setBootstrapError(null);
          setMaintenanceStatus((prev) => {
            if (prev?.active) return prev;
            if (status?.active) return status;
            return fallbackMaintenance;
          });
        } else if (isAuthRejected) {
          clearSession();
        } else {
          // Error transitorio (cold start en Render, red, timeout, 5xx, HTML): conservar token para reintentar
          setApiAuthToken(storedToken);
          setToken(storedToken);
          setUser(null);
          const message =
            err instanceof ApiError
              ? err.message
              : 'No se pudo conectar con el servidor. Es posible que esté iniciando en Render.';
          setBootstrapError(message);
        }
      }
    },
    [clearSession],
  );

  const retrySession = useCallback(async (): Promise<void> => {
    setIsRetryingSession(true);
    try {
      await loadSession();
    } finally {
      setIsRetryingSession(false);
    }
  }, [loadSession]);

  const refreshMaintenanceAndRecover = useCallback(async (): Promise<MaintenanceStatus | null> => {
    const status = await refreshMaintenance();
    if (status && !status.active && tokenRef.current && !userRef.current) {
      await loadSession();
    }
    return status;
  }, [refreshMaintenance, loadSession]);

  // Validación inicial de token guardado y estado de mantenimiento
  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        if (!bootstrapInFlightRef.current) {
          bootstrapInFlightRef.current = loadSession().finally(() => {
            bootstrapInFlightRef.current = null;
          });
        }
        await bootstrapInFlightRef.current;
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void bootstrap();
    return () => {
      active = false;
    };
  }, [loadSession]);

  // Conexión Socket.IO cuando hay usuario y token válidos
  useEffect(() => {
    if (!token || !user) {
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
        setIsConnected(false);
        setOnlineUserIds([]);
      }
      return;
    }

    let hasConnectedBefore = false;

    const activeSocket = createKanbanSocket(token, {
      onConnect: () => {
        setIsConnected(true);
        if (hasConnectedBefore && !isResyncingRef.current) {
          isResyncingRef.current = true;
          void Promise.allSettled([
            refreshTasks(),
            refreshUsers(),
            refreshMaintenance(),
          ]).finally(() => {
            isResyncingRef.current = false;
          });
        }
        hasConnectedBefore = true;
      },
      onDisconnect: () => {
        setIsConnected(false);
      },
      onConnectError: () => {
        setIsConnected(false);
      },
      onPresenceUpdate: (ids) => {
        setOnlineUserIds(ids);
      },
      onSessionRevoked: (reason) => {
        if (suppressRevokeRef.current) {
          return;
        }
        clearSession();
        toast.error(reason || 'Tu sesión fue cerrada');
      },
      onMaintenanceReject: () => {
        setIsConnected(false);
        void refreshMaintenance();
      },
    });

    activeSocket.on('maintenance:updated', (status) => {
      setMaintenanceStatus(status);
    });

    activeSocket.on('user:created', (createdUser) => {
      setUsers((prev) => {
        const exists = prev.some((u) => u.id === createdUser.id);
        const next = exists
          ? prev.map((u) => (u.id === createdUser.id ? createdUser : u))
          : [...prev, createdUser];
        return sortUsersBySlot(next);
      });
    });

    activeSocket.on('user:updated', (updatedUser) => {
      setUsers((prev) =>
        sortUsersBySlot(prev.map((u) => (u.id === updatedUser.id ? updatedUser : u))),
      );
      setUser((prev) => (prev && prev.id === updatedUser.id ? updatedUser : prev));
      setTasks((prev) =>
        prev.map((t) => (t.assigneeId === updatedUser.id ? { ...t, assignee: updatedUser } : t)),
      );
    });

    activeSocket.on('user:deleted', ({ id }) => {
      setUsers((prev) => prev.filter((u) => u.id !== id));
      setOnlineUserIds((prev) => prev.filter((uid) => uid !== id));
      setTasks((prev) =>
        prev.map((t) => (t.assigneeId === id ? { ...t, assigneeId: null, assignee: null } : t)),
      );
    });

    activeSocket.on('task:created', (task) => {
      setTasks((prev) => upsertTask(prev, task));
    });

    activeSocket.on('task:updated', (task) => {
      setTasks((prev) => upsertTask(prev, task));
    });

    activeSocket.on('task:moved', ({ task }) => {
      setTasks((prev) => upsertTask(prev, task));
    });

    activeSocket.on('task:approved', ({ task }) => {
      setTasks((prev) => upsertTask(prev, task));
    });

    activeSocket.on('task:deleted', ({ id }) => {
      setTasks((prev) => prev.filter((t) => t.id !== id));
    });

    activeSocket.on('comment:created', ({ taskId, comment }) => {
      registerCommentCreated(taskId, comment.id);
    });

    activeSocket.on('comment:deleted', ({ taskId, id }) => {
      registerCommentDeleted(taskId, id);
    });

    activeSocket.on('attachment:created', ({ taskId, attachment }) => {
      registerAttachmentCreated(taskId, attachment.id);
    });

    activeSocket.on('attachment:deleted', ({ taskId, id }) => {
      registerAttachmentDeleted(taskId, id);
    });

    socketRef.current = activeSocket;
    setSocket(activeSocket);
    activeSocket.connect();

    return () => {
      activeSocket.removeAllListeners();
      activeSocket.disconnect();
      if (socketRef.current === activeSocket) {
        socketRef.current = null;
      }
      setSocket(null);
      setIsConnected(false);
    };
  }, [
    token,
    user?.id,
    clearSession,
    refreshMaintenance,
    refreshTasks,
    refreshUsers,
    registerCommentCreated,
    registerCommentDeleted,
    registerAttachmentCreated,
    registerAttachmentDeleted,
  ]);

  // Recuperar tablero y sesión automáticamente cuando termina la ventana de mantenimiento
  useEffect(() => {
    const isActiveNow = Boolean(maintenanceStatus?.active);
    const wasActive = prevMaintenanceActiveRef.current;
    prevMaintenanceActiveRef.current = isActiveNow;

    if (!wasActive || isActiveNow || !token) {
      return;
    }

    if (!user) {
      void retrySession();
      return;
    }

    if (socketRef.current && !socketRef.current.connected) {
      socketRef.current.connect();
    }
    if (user.role !== 'LEADER' || !socketRef.current?.connected) {
      api.listUsers().then((res) => setUsers(sortUsersBySlot(res.users))).catch(() => {});
      api.listTasks().then((fresh) => setTasks(fresh)).catch(() => {});
    }
  }, [maintenanceStatus?.active, token, user, retrySession]);

  // Detección de conectividad del navegador para sincronización a prueba de fallos de red
  useEffect(() => {
    const handleOnline = () => {
      toast.success('Conexión reestablecida. Sincronizando datos...');
      if (token && !user) {
        void retrySession();
        return;
      }
      void refreshMaintenance();
      if (token) {
        api.listTasks().then((fresh) => setTasks(fresh)).catch(() => {});
        api.listUsers().then((res) => setUsers(sortUsersBySlot(res.users))).catch(() => {});
      }
    };
    const handleOffline = () => {
      toast.warning('Sin conexión a Internet. El tablero se sincronizará automáticamente al volver en línea.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [token, user, refreshMaintenance, retrySession]);

  const login = useCallback(async (username: string, password: string) => {
    unauthorizedNotifiedRef.current = false;
    const res = await api.login(username, password);
    setApiAuthToken(res.token);
    window.localStorage.setItem(TOKEN_STORAGE_KEY, res.token);

    try {
      const [usersRes, tasksList] = await Promise.all([api.listUsers(), api.listTasks()]);
      setToken(res.token);
      setUser(res.user);
      setUsers(sortUsersBySlot(usersRes.users));
      setMaxUsers(usersRes.maxUsers);
      setTasks(tasksList);
      setBootstrapError(null);
    } catch (err) {
      setApiAuthToken(null);
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      throw err;
    }
  }, []);

  const updateProfile = useCallback(async (input: UpdateMeInput): Promise<UserPublic> => {
    const updated = await api.updateMe(input);
    setUser(updated);
    setUsers((prev) => sortUsersBySlot(prev.map((u) => (u.id === updated.id ? updated : u))));
    setTasks((prev) =>
      prev.map((t) => (t.assigneeId === updated.id ? { ...t, assignee: updated } : t)),
    );
    return updated;
  }, []);

  const updateMyPassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<void> => {
      suppressRevokeRef.current = true;
      try {
        const res = await api.changeMyPassword({ currentPassword, newPassword });
        setApiAuthToken(res.token);
        window.localStorage.setItem(TOKEN_STORAGE_KEY, res.token);
        setToken(res.token);
      } finally {
        window.setTimeout(() => {
          suppressRevokeRef.current = false;
        }, 500);
      }
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      users,
      maxUsers,
      tasks,
      setTasks,
      isLoading,
      bootstrapError,
      isRetryingSession,
      retrySession,
      isConnected,
      onlineUserIds,
      socket,
      maintenanceStatus,
      login,
      logout,
      refreshUsers,
      refreshTasks,
      refreshMaintenance: refreshMaintenanceAndRecover,
      updateMaintenance,
      updateProfile,
      updateMyPassword,
      registerCommentCreated,
      registerCommentDeleted,
      registerAttachmentCreated,
      registerAttachmentDeleted,
    }),
    [
      user,
      token,
      users,
      maxUsers,
      tasks,
      isLoading,
      bootstrapError,
      isRetryingSession,
      retrySession,
      isConnected,
      onlineUserIds,
      socket,
      maintenanceStatus,
      login,
      logout,
      refreshUsers,
      refreshTasks,
      refreshMaintenanceAndRecover,
      updateMaintenance,
      updateProfile,
      updateMyPassword,
      registerCommentCreated,
      registerCommentDeleted,
      registerAttachmentCreated,
      registerAttachmentDeleted,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }
  return ctx;
}
