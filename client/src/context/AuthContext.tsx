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
}

const AuthContext = createContext<AuthContextValue | null>(null);

function sortUsersBySlot(list: UserPublic[]): UserPublic[] {
  return [...list].sort((a, b) => a.slot - b.slot);
}

function upsertTask(list: Task[], incoming: Task): Task[] {
  const idx = list.findIndex((t) => t.id === incoming.id);
  const next = idx === -1 ? [...list, incoming] : list.map((t, i) => (i === idx ? incoming : t));
  return [...next].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
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
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [socket, setSocket] = useState<KanbanSocket | null>(null);
  const [maintenanceStatus, setMaintenanceStatus] = useState<MaintenanceStatus | null>(null);

  const socketRef = useRef<KanbanSocket | null>(null);
  const suppressRevokeRef = useRef<boolean>(false);
  const prevMaintenanceActiveRef = useRef<boolean>(false);

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

  // Validación inicial de token guardado y estado de mantenimiento
  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const statusPromise = api.getMaintenanceStatus().catch(() => null);
      const storedToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
      if (!storedToken) {
        setApiAuthToken(null);
        const status = await statusPromise;
        if (!active) return;
        if (status) {
          setMaintenanceStatus((prev) => status ?? prev);
        }
        setIsLoading(false);
        return;
      }

      setApiAuthToken(storedToken);
      try {
        const [status, me, usersRes, tasksList] = await Promise.all([
          statusPromise,
          api.getMe(),
          api.listUsers(),
          api.listTasks(),
        ]);
        if (!active) return;
        if (status) {
          setMaintenanceStatus((prev) => status ?? prev);
        }
        setToken(storedToken);
        setUser(me);
        setUsers(sortUsersBySlot(usersRes.users));
        setMaxUsers(usersRes.maxUsers);
        setTasks(tasksList);
      } catch (err) {
        if (!active) return;
        const status = await statusPromise;
        if (!active) return;
        if (status) {
          setMaintenanceStatus((prev) => status ?? prev);
        }
        if (err instanceof ApiError && err.status === 503) {
          // Conservar el token para recuperar la sesión al finalizar la ventana de mantenimiento
          setToken(storedToken);
          setUser(null);
        } else {
          clearSession();
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void bootstrap();
    return () => {
      active = false;
    };
  }, [clearSession]);

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

    const activeSocket = createKanbanSocket(token, {
      onConnect: () => {
        setIsConnected(true);
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

    const seenCreatedCommentIds = new Set<string>();
    const seenDeletedCommentIds = new Set<string>();
    const seenCreatedAttachmentIds = new Set<string>();
    const seenDeletedAttachmentIds = new Set<string>();

    const trackBounded = (bucket: Set<string>, id: string): boolean => {
      if (bucket.has(id)) return false;
      bucket.add(id);
      if (bucket.size > 400) {
        const first = bucket.values().next().value;
        if (first) bucket.delete(first);
      }
      return true;
    };

    activeSocket.on('comment:created', ({ taskId, comment }) => {
      if (!trackBounded(seenCreatedCommentIds, comment.id)) return;
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, commentCount: t.commentCount + 1 } : t)),
      );
    });

    activeSocket.on('comment:deleted', ({ taskId, id }) => {
      if (!trackBounded(seenDeletedCommentIds, id)) return;
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, commentCount: Math.max(0, t.commentCount - 1) } : t,
        ),
      );
    });

    activeSocket.on('attachment:created', ({ taskId, attachment }) => {
      if (!trackBounded(seenCreatedAttachmentIds, attachment.id)) return;
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, attachmentCount: (t.attachmentCount ?? 0) + 1 } : t,
        ),
      );
    });

    activeSocket.on('attachment:deleted', ({ taskId, id }) => {
      if (!trackBounded(seenDeletedAttachmentIds, id)) return;
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, attachmentCount: Math.max(0, (t.attachmentCount ?? 0) - 1) } : t,
        ),
      );
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
  }, [token, user?.id, clearSession, refreshMaintenance]);

  // Recuperar tablero y sesión automáticamente cuando termina la ventana de mantenimiento
  useEffect(() => {
    const isActiveNow = Boolean(maintenanceStatus?.active);
    const wasActive = prevMaintenanceActiveRef.current;
    prevMaintenanceActiveRef.current = isActiveNow;

    if (!wasActive || isActiveNow || !token) {
      return;
    }

    if (!user) {
      setApiAuthToken(token);
      Promise.all([api.getMe(), api.listUsers(), api.listTasks()])
        .then(([me, usersRes, tasksList]) => {
          setUser(me);
          setUsers(sortUsersBySlot(usersRes.users));
          setMaxUsers(usersRes.maxUsers);
          setTasks(tasksList);
        })
        .catch(() => {
          clearSession();
        });
      return;
    }

    if (socketRef.current && !socketRef.current.connected) {
      socketRef.current.connect();
    }
    if (user.role !== 'LEADER' || !socketRef.current?.connected) {
      api.listUsers().then((res) => setUsers(sortUsersBySlot(res.users))).catch(() => {});
      api.listTasks().then((fresh) => setTasks(fresh)).catch(() => {});
    }
  }, [maintenanceStatus?.active, token, user, clearSession]);

  // Detección de conectividad del navegador para sincronización a prueba de fallos de red
  useEffect(() => {
    const handleOnline = () => {
      toast.success('Conexión reestablecida. Sincronizando datos...');
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
  }, [token, refreshMaintenance]);

  const login = useCallback(async (username: string, password: string) => {
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
      isConnected,
      onlineUserIds,
      socket,
      maintenanceStatus,
      login,
      logout,
      refreshUsers,
      refreshTasks,
      refreshMaintenance,
      updateMaintenance,
      updateProfile,
      updateMyPassword,
    }),
    [
      user,
      token,
      users,
      maxUsers,
      tasks,
      isLoading,
      isConnected,
      onlineUserIds,
      socket,
      maintenanceStatus,
      login,
      logout,
      refreshUsers,
      refreshTasks,
      refreshMaintenance,
      updateMaintenance,
      updateProfile,
      updateMyPassword,
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
