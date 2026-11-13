import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  Edit3,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Save,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { api, ApiError } from '../../lib/api';
import {
  AVATAR_ACCESSORIES,
  AVATAR_PRESETS,
  DEFAULT_AVATAR,
  MAX_USERS,
  type AvatarConfig,
  type UserPublic,
} from '../../types/kanban';
import {
  AVATAR_ACCESSORY_LABELS,
  AVATAR_BG_PALETTE,
  AVATAR_COLOR_PALETTE,
  AVATAR_PRESET_LABELS,
  RoleBadge,
  VectorAvatar,
} from '../avatars/VectorAvatar';

interface TeamModalProps {
  open: boolean;
  onClose: () => void;
  onOpenMyProfile: () => void;
}

type SlotActionMode =
  | { type: 'none' }
  | { type: 'create'; slot: number }
  | { type: 'edit'; userId: string }
  | { type: 'reset-password'; userId: string }
  | { type: 'delete'; userId: string };

const TOTAL_SLOTS = [1, 2, 3, 4, 5, 6] as const;

export function TeamModal({ open, onClose, onOpenMyProfile }: TeamModalProps) {
  const { user, users, maxUsers, onlineUserIds, setTasks, refreshUsers } = useAuth();
  const [actionMode, setActionMode] = useState<SlotActionMode>({ type: 'none' });

  // Campos de creación / edición
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [avatar, setAvatar] = useState<AvatarConfig>(DEFAULT_AVATAR);
  const [submitting, setSubmitting] = useState(false);

  const onlineSet = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);

  const userBySlot = useMemo(() => {
    const map = new Map<number, UserPublic>();
    for (const u of users) {
      map.set(u.slot, u);
    }
    return map;
  }, [users]);

  useEffect(() => {
    if (open) {
      setActionMode({ type: 'none' });
      setUsername('');
      setDisplayName('');
      setPassword('');
      setShowPassword(false);
      setAvatar(DEFAULT_AVATAR);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!user || user.role !== 'LEADER') return null;

  const openCreateForm = (slot: number) => {
    setActionMode({ type: 'create', slot });
    setUsername('');
    setDisplayName('');
    setPassword('');
    setShowPassword(false);
    setAvatar({
      preset: AVATAR_PRESETS[(slot + 1) % AVATAR_PRESETS.length],
      bg: AVATAR_BG_PALETTE[(slot - 1) % AVATAR_BG_PALETTE.length],
      color: '#FFFFFF',
      accessory: 'none',
    });
  };

  const openEditForm = (member: UserPublic) => {
    setActionMode({ type: 'edit', userId: member.id });
    setUsername(member.username);
    setDisplayName(member.displayName);
    setAvatar({ ...member.avatar });
  };

  const openResetPasswordForm = (member: UserPublic) => {
    setActionMode({ type: 'reset-password', userId: member.id });
    setPassword('');
    setShowPassword(false);
  };

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanUsername = username.trim().toLowerCase();
    const cleanDisplayName = displayName.trim();

    if (!/^[a-z0-9_-]{3,30}$/.test(cleanUsername)) {
      toast.error(
        'La clave de usuario debe tener 3-30 caracteres (minúsculas, números, guion o guion bajo).',
      );
      return;
    }
    if (cleanDisplayName.length < 2 || cleanDisplayName.length > 50) {
      toast.error('El nombre visible debe tener entre 2 y 50 caracteres.');
      return;
    }
    if (password.length < 6) {
      toast.error('La contraseña inicial debe tener al menos 6 caracteres.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.createUser({
        username: cleanUsername,
        displayName: cleanDisplayName,
        password,
        avatar,
      });
      await refreshUsers();
      toast.success(`Cupo ocupado: ${created.displayName} (@${created.username})`);
      setActionMode({ type: 'none' });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo crear el integrante';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateMember = async (event: FormEvent<HTMLFormElement>, member: UserPublic) => {
    event.preventDefault();
    const cleanUsername = username.trim().toLowerCase();
    const cleanDisplayName = displayName.trim();

    if (!/^[a-z0-9_-]{3,30}$/.test(cleanUsername)) {
      toast.error(
        'La clave de usuario debe tener 3-30 caracteres (minúsculas, números, guion o guion bajo).',
      );
      return;
    }
    if (cleanDisplayName.length < 2 || cleanDisplayName.length > 50) {
      toast.error('El nombre visible debe tener entre 2 y 50 caracteres.');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await api.updateUser(member.id, {
        username: cleanUsername,
        displayName: cleanDisplayName,
        avatar,
      });
      await refreshUsers();
      setTasks((prev) =>
        prev.map((t) => (t.assigneeId === updated.id ? { ...t, assignee: updated } : t)),
      );
      toast.success(`Datos de ${updated.displayName} actualizados`);
      setActionMode({ type: 'none' });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo actualizar el integrante';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>, member: UserPublic) => {
    event.preventDefault();
    if (password.length < 6) {
      toast.error('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setSubmitting(true);
    try {
      await api.updateUser(member.id, { password });
      toast.success(`Contraseña de ${member.displayName} restablecida. Su sesión fue cerrada.`);
      setActionMode({ type: 'none' });
      setPassword('');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo restablecer la contraseña';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMember = async (member: UserPublic) => {
    setSubmitting(true);
    try {
      await api.deleteUser(member.id);
      await refreshUsers();
      setTasks((prev) =>
        prev.map((t) => (t.assigneeId === member.id ? { ...t, assigneeId: null, assignee: null } : t)),
      );
      toast.success(`Cupo #${member.slot} liberado (${member.displayName} eliminado)`);
      setActionMode({ type: 'none' });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo liberar el cupo';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const renderQuickAvatarEditor = () => (
    <div className="space-y-3 rounded-xl border border-slate-200/80 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-3">
        <VectorAvatar avatar={avatar} size={48} />
        <div className="grid flex-1 grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">
              Personaje SVG
            </label>
            <select
              value={avatar.preset}
              onChange={(e) => setAvatar((prev) => ({ ...prev, preset: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {AVATAR_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {AVATAR_PRESET_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">
              Accesorio
            </label>
            <select
              value={avatar.accessory}
              onChange={(e) =>
                setAvatar((prev) => ({
                  ...prev,
                  accessory: e.target.value as AvatarConfig['accessory'],
                }))
              }
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {AVATAR_ACCESSORIES.map((acc) => (
                <option key={acc} value={acc}>
                  {AVATAR_ACCESSORY_LABELS[acc]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-slate-500 mr-1">Fondo:</span>
          {AVATAR_BG_PALETTE.slice(0, 7).map((hex) => {
            const active = avatar.bg.toLowerCase() === hex.toLowerCase();
            return (
              <button
                key={hex}
                type="button"
                onClick={() => setAvatar((prev) => ({ ...prev, bg: hex }))}
                style={{ backgroundColor: hex }}
                aria-label={`Fondo ${hex}`}
                className={`flex h-7 w-7 items-center justify-center rounded-full transition ${
                  active ? 'ring-2 ring-blue-500 ring-offset-1 scale-110' : 'ring-1 ring-black/15'
                }`}
              >
                {active ? <Check className="h-3.5 w-3.5 text-white" /> : null}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-slate-500 mr-1">Color:</span>
          {AVATAR_COLOR_PALETTE.slice(0, 6).map((hex) => {
            const active = avatar.color.toLowerCase() === hex.toLowerCase();
            return (
              <button
                key={hex}
                type="button"
                onClick={() => setAvatar((prev) => ({ ...prev, color: hex }))}
                style={{ backgroundColor: hex }}
                aria-label={`Color ${hex}`}
                className={`flex h-7 w-7 items-center justify-center rounded-full transition ${
                  active ? 'ring-2 ring-blue-500 ring-offset-1 scale-110' : 'ring-1 ring-black/15'
                }`}
              >
                {active ? <Check className="h-3.5 w-3.5 text-slate-900" /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="team-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6 backdrop-blur-xs"
          onClick={onClose}
        >
          <motion.div
            key="team-modal-dialog"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="team-modal-title"
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            {/* Cabecera */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-7 sm:py-4 dark:border-slate-800">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
                  <Users className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="team-modal-title"
                    className="text-lg font-bold text-slate-900 dark:text-white truncate"
                  >
                    Gestión de Equipo ({users.length}/{maxUsers || MAX_USERS})
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Administra los 6 cupos del tablero: edita integrantes, restablece accesos o ocupa cupos libres
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar panel de equipo"
                className="inline-flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Lista de los 6 cupos */}
            <div className="overflow-y-auto p-4 sm:p-7 space-y-3.5">
              {TOTAL_SLOTS.map((slotNumber) => {
                const occupant = userBySlot.get(slotNumber);
                const isLeaderSlot = slotNumber === 1;

                // Cupo ocupado
                if (occupant) {
                  const isOnline = onlineSet.has(occupant.id);
                  const isEditingThis =
                    actionMode.type === 'edit' && actionMode.userId === occupant.id;
                  const isResettingThis =
                    actionMode.type === 'reset-password' && actionMode.userId === occupant.id;
                  const isDeletingThis =
                    actionMode.type === 'delete' && actionMode.userId === occupant.id;

                  return (
                    <div
                      key={slotNumber}
                      className="rounded-2xl border border-slate-200/90 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/40"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="relative shrink-0">
                            <VectorAvatar avatar={occupant.avatar} size={46} />
                            <span
                              title={isOnline ? 'En línea' : 'Desconectado'}
                              className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${
                                isOnline ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-600'
                              }`}
                            />
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-md bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                Cupo #{slotNumber}
                              </span>
                              <h3 className="text-sm font-bold leading-snug text-slate-900 dark:text-white">
                                {occupant.displayName}
                              </h3>
                              <RoleBadge role={occupant.role} size="sm" />
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                              <span className="font-mono">@{occupant.username}</span>
                              <span>•</span>
                              <span
                                className={
                                  isOnline
                                    ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                                    : 'text-slate-400'
                                }
                              >
                                {isOnline ? 'En línea ahora' : 'Desconectado'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {isLeaderSlot ? (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onOpenMyProfile();
                            }}
                            className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            Editar en Mi Perfil
                          </button>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                isEditingThis
                                  ? setActionMode({ type: 'none' })
                                  : openEditForm(occupant)
                              }
                              className={`inline-flex min-h-[36px] items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
                                isEditingThis
                                  ? 'border-blue-500 bg-blue-600 text-white'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                              }`}
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              Editar
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                isResettingThis
                                  ? setActionMode({ type: 'none' })
                                  : openResetPasswordForm(occupant)
                              }
                              className={`inline-flex min-h-[36px] items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
                                isResettingThis
                                  ? 'border-amber-500 bg-amber-500 text-white'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-amber-50 hover:text-amber-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-amber-950/40'
                              }`}
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                              Restablecer clave
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                setActionMode(
                                  isDeletingThis
                                    ? { type: 'none' }
                                    : { type: 'delete', userId: occupant.id },
                                )
                              }
                              className={`inline-flex min-h-[36px] items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
                                isDeletingThis
                                  ? 'border-red-600 bg-red-600 text-white'
                                  : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-300'
                              }`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Liberar
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Formulario inline: Editar integrante */}
                      {isEditingThis ? (
                        <form
                          onSubmit={(e) => void handleUpdateMember(e, occupant)}
                          className="mt-4 space-y-3 border-t border-slate-200/80 pt-4 dark:border-slate-700"
                        >
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="mb-1 block text-[11px] font-bold uppercase text-slate-500">
                                Clave de usuario
                              </label>
                              <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                required
                                maxLength={30}
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] font-bold uppercase text-slate-500">
                                Nombre visible
                              </label>
                              <input
                                type="text"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                required
                                maxLength={50}
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                              />
                            </div>
                          </div>

                          {renderQuickAvatarEditor()}

                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setActionMode({ type: 'none' })}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                            >
                              Cancelar
                            </button>
                            <button
                              type="submit"
                              disabled={submitting}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-65"
                            >
                              {submitting ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Save className="h-3.5 w-3.5" />
                              )}
                              Guardar cambios
                            </button>
                          </div>
                        </form>
                      ) : null}

                      {/* Formulario inline: Restablecer contraseña */}
                      {isResettingThis ? (
                        <form
                          onSubmit={(e) => void handleResetPassword(e, occupant)}
                          className="mt-4 space-y-3 border-t border-slate-200/80 pt-4 dark:border-slate-700"
                        >
                          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                            <span>
                              Al restablecer la contraseña, se cerrará automáticamente la sesión
                              actual de <strong>{occupant.displayName}</strong>.
                            </span>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-2">
                            <div className="relative flex-1">
                              <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Nueva contraseña (mínimo 6 caracteres)"
                                minLength={6}
                                required
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 pr-9 py-2 text-xs sm:text-sm text-slate-900 outline-none focus:border-amber-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword((p) => !p)}
                                aria-label="Mostrar u ocultar contraseña"
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                              >
                                {showPassword ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </button>
                            </div>

                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setActionMode({ type: 'none' })}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                              >
                                Cancelar
                              </button>
                              <button
                                type="submit"
                                disabled={submitting}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-65"
                              >
                                {submitting ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <KeyRound className="h-3.5 w-3.5" />
                                )}
                                Confirmar restablecimiento
                              </button>
                            </div>
                          </div>
                        </form>
                      ) : null}

                      {/* Confirmación inline: Eliminar / Liberar cupo */}
                      {isDeletingThis ? (
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-950/40">
                          <p className="text-xs font-medium text-red-800 dark:text-red-200">
                            ¿Eliminar a <strong>{occupant.displayName}</strong> y liberar el cupo #
                            {slotNumber}? Sus tareas asignadas quedarán sin asignar.
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setActionMode({ type: 'none' })}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => void handleDeleteMember(occupant)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-65"
                            >
                              {submitting ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : null}
                              Sí, liberar cupo
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                }

                // Cupo libre
                const isCreatingHere =
                  actionMode.type === 'create' && actionMode.slot === slotNumber;

                return (
                  <div
                    key={slotNumber}
                    className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/40 p-4 dark:border-slate-700 dark:bg-slate-800/20"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-slate-300 bg-white text-xs font-bold text-slate-400 dark:border-slate-700 dark:bg-slate-900">
                          #{slotNumber}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                            Cupo #{slotNumber} disponible
                          </p>
                          <p className="text-xs text-slate-400">
                            Espacio libre para un nuevo integrante del equipo
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          isCreatingHere
                            ? setActionMode({ type: 'none' })
                            : openCreateForm(slotNumber)
                        }
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-indigo-700"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        {isCreatingHere ? 'Cerrar formulario' : 'Ocupar cupo libre'}
                      </button>
                    </div>

                    {isCreatingHere ? (
                      <form
                        onSubmit={(e) => void handleCreateUser(e)}
                        className="mt-4 space-y-3 border-t border-slate-200/80 pt-4 dark:border-slate-700"
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="mb-1 block text-[11px] font-bold uppercase text-slate-500">
                              Clave de usuario *
                            </label>
                            <input
                              type="text"
                              value={username}
                              onChange={(e) => setUsername(e.target.value)}
                              placeholder="ej. integrante6"
                              required
                              maxLength={30}
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] font-bold uppercase text-slate-500">
                              Nombre visible *
                            </label>
                            <input
                              type="text"
                              value={displayName}
                              onChange={(e) => setDisplayName(e.target.value)}
                              placeholder="ej. Lucía Navarro"
                              required
                              maxLength={50}
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] font-bold uppercase text-slate-500">
                              Contraseña inicial *
                            </label>
                            <div className="relative">
                              <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Mínimo 6 caracteres"
                                required
                                minLength={6}
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 pr-8 py-2 text-xs sm:text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword((p) => !p)}
                                aria-label="Mostrar u ocultar contraseña"
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                              >
                                {showPassword ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>

                        {renderQuickAvatarEditor()}

                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setActionMode({ type: 'none' })}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                          >
                            Cancelar
                          </button>
                          <button
                            type="submit"
                            disabled={submitting}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-65"
                          >
                            {submitting ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <UserPlus className="h-3.5 w-3.5" />
                            )}
                            Crear integrante
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
