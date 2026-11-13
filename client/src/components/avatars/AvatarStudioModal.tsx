import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Eye, EyeOff, KeyRound, Loader2, Palette, Save, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../lib/api';
import {
  AVATAR_ACCESSORIES,
  AVATAR_PRESETS,
  DEFAULT_AVATAR,
  type AvatarConfig,
} from '../../types/kanban';
import {
  AVATAR_ACCESSORY_LABELS,
  AVATAR_BG_PALETTE,
  AVATAR_COLOR_PALETTE,
  AVATAR_PRESET_LABELS,
  RoleBadge,
  VectorAvatar,
} from './VectorAvatar';

interface AvatarStudioModalProps {
  open: boolean;
  onClose: () => void;
}

type StudioTab = 'avatar' | 'password';

export function AvatarStudioModal({ open, onClose }: AvatarStudioModalProps) {
  const { user, updateProfile, updateMyPassword } = useAuth();

  const [tab, setTab] = useState<StudioTab>('avatar');

  // Estado perfil y avatar
  const [displayName, setDisplayName] = useState('');
  const [avatar, setAvatar] = useState<AvatarConfig>(DEFAULT_AVATAR);
  const [savingProfile, setSavingProfile] = useState(false);

  // Estado cambio de contraseña
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (open && user) {
      setDisplayName(user.displayName);
      setAvatar({ ...user.avatar });
      setTab('avatar');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordError(null);
    }
  }, [open, user]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!user) return null;

  const handleSaveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = displayName.trim();
    if (trimmed.length < 2 || trimmed.length > 50) {
      toast.error('El nombre visible debe tener entre 2 y 50 caracteres.');
      return;
    }

    setSavingProfile(true);
    try {
      await updateProfile({
        displayName: trimmed,
        avatar,
      });
      toast.success('Perfil y avatar SVG actualizados');
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo actualizar el perfil';
      toast.error(msg);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSavePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError(null);

    if (!currentPassword) {
      setPasswordError('Ingresa tu contraseña actual.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('La confirmación no coincide con la nueva contraseña.');
      return;
    }

    setSavingPassword(true);
    try {
      await updateMyPassword(currentPassword, newPassword);
      toast.success('Contraseña actualizada. Tu sesión sigue activa.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo actualizar la contraseña';
      setPasswordError(msg);
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="avatar-studio-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6 backdrop-blur-xs"
          onClick={onClose}
        >
          <motion.div
            key="avatar-studio-dialog"
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="avatar-studio-title"
            className="relative w-full max-w-3xl max-h-[90dvh] flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabecera del modal */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-7 sm:py-4 dark:border-slate-800">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="avatar-studio-title"
                    className="text-lg font-bold text-slate-900 dark:text-white truncate"
                  >
                    Mi Perfil &amp; Estudio de Avatares SVG
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Personaliza tu identidad visual en tiempo real o actualiza tu contraseña
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar ventana"
                className="inline-flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Pestañas */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5 sm:px-7 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/60">
              <button
                type="button"
                onClick={() => setTab('avatar')}
                className={`inline-flex min-h-[38px] items-center gap-2 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold transition ${
                  tab === 'avatar'
                    ? 'bg-white text-blue-600 shadow-xs ring-1 ring-slate-200 dark:bg-slate-800 dark:text-blue-400 dark:ring-slate-700'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Palette className="h-4 w-4" />
                Perfil y Avatar SVG
              </button>

              <button
                type="button"
                onClick={() => setTab('password')}
                className={`inline-flex min-h-[38px] items-center gap-2 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold transition ${
                  tab === 'password'
                    ? 'bg-white text-blue-600 shadow-xs ring-1 ring-slate-200 dark:bg-slate-800 dark:text-blue-400 dark:ring-slate-700'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <KeyRound className="h-4 w-4" />
                Cambiar Contraseña
              </button>
            </div>

            {/* Contenido */}
            <div className="overflow-y-auto p-4 sm:p-7">
              {tab === 'avatar' ? (
                <form onSubmit={handleSaveProfile} className="space-y-6">
                  {/* Vista previa + Nombre visible */}
                  <div className="flex flex-col sm:flex-row items-center gap-5 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-800/40">
                    <motion.div
                      key={`${avatar.preset}-${avatar.bg}-${avatar.color}-${avatar.accessory}`}
                      initial={{ scale: 0.92, opacity: 0.8 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.2 }}
                      className="shrink-0 rounded-full p-1 ring-4 ring-blue-500/20"
                    >
                      <VectorAvatar avatar={avatar} size={108} title="Vista previa de avatar" />
                    </motion.div>

                    <div className="w-full space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          Usuario: <strong className="text-slate-700 dark:text-slate-200">@{user.username}</strong>
                        </span>
                        <RoleBadge role={user.role} />
                      </div>

                      <div>
                        <label
                          htmlFor="studio-display-name"
                          className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-1"
                        >
                          Nombre visible
                        </label>
                        <input
                          id="studio-display-name"
                          type="text"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          maxLength={50}
                          required
                          className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Selector de los 16 presets */}
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                        Personaje SVG ({AVATAR_PRESETS.length} estilos)
                      </h3>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {AVATAR_PRESET_LABELS[avatar.preset as keyof typeof AVATAR_PRESET_LABELS] ??
                          avatar.preset}
                      </span>
                    </div>

                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                      {AVATAR_PRESETS.map((preset) => {
                        const selected = avatar.preset === preset;
                        return (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setAvatar((prev) => ({ ...prev, preset }))}
                            className={`group flex flex-col items-center gap-1 rounded-2xl p-2 text-center transition ${
                              selected
                                ? 'bg-blue-50 ring-2 ring-blue-500 dark:bg-blue-500/15 dark:ring-blue-400'
                                : 'bg-slate-50 hover:bg-slate-100 ring-1 ring-slate-200/80 dark:bg-slate-800/60 dark:hover:bg-slate-800 dark:ring-slate-700/80'
                            }`}
                          >
                            <VectorAvatar
                              avatar={{ ...avatar, preset }}
                              size={42}
                              className="transition group-hover:scale-105"
                            />
                            <span className="w-full truncate text-[10px] font-medium text-slate-700 dark:text-slate-300">
                              {AVATAR_PRESET_LABELS[preset]}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Paletas de colores */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                          Color de fondo
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">{avatar.bg}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {AVATAR_BG_PALETTE.map((hex) => {
                          const selected = avatar.bg.toLowerCase() === hex.toLowerCase();
                          return (
                            <button
                              key={hex}
                              type="button"
                              aria-label={`Color de fondo ${hex}`}
                              onClick={() => setAvatar((prev) => ({ ...prev, bg: hex }))}
                              style={{ backgroundColor: hex }}
                              className={`flex h-7 w-7 items-center justify-center rounded-full transition ${
                                selected
                                  ? 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-900 scale-110'
                                  : 'ring-1 ring-black/15 hover:scale-105'
                              }`}
                            >
                              {selected ? <Check className="h-3.5 w-3.5 text-white drop-shadow" /> : null}
                            </button>
                          );
                        })}
                        <label
                          title="Elegir color personalizado"
                          className="relative flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-slate-400 text-[10px] font-bold text-slate-600 dark:text-slate-300"
                        >
                          +
                          <input
                            type="color"
                            value={avatar.bg}
                            onChange={(e) => setAvatar((prev) => ({ ...prev, bg: e.target.value }))}
                            className="absolute inset-0 cursor-pointer opacity-0"
                          />
                        </label>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                          Color principal
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">{avatar.color}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {AVATAR_COLOR_PALETTE.map((hex) => {
                          const selected = avatar.color.toLowerCase() === hex.toLowerCase();
                          const isLight =
                            hex === '#FFFFFF' ||
                            hex === '#FDE68A' ||
                            hex === '#BAE6FD' ||
                            hex === '#BBF7D0';
                          return (
                            <button
                              key={hex}
                              type="button"
                              aria-label={`Color principal ${hex}`}
                              onClick={() => setAvatar((prev) => ({ ...prev, color: hex }))}
                              style={{ backgroundColor: hex }}
                              className={`flex h-7 w-7 items-center justify-center rounded-full transition ${
                                selected
                                  ? 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-900 scale-110'
                                  : 'ring-1 ring-black/15 hover:scale-105'
                              }`}
                            >
                              {selected ? (
                                <Check
                                  className={`h-3.5 w-3.5 ${
                                    isLight ? 'text-slate-900' : 'text-white'
                                  }`}
                                />
                              ) : null}
                            </button>
                          );
                        })}
                        <label
                          title="Elegir color principal personalizado"
                          className="relative flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-slate-400 text-[10px] font-bold text-slate-600 dark:text-slate-300"
                        >
                          +
                          <input
                            type="color"
                            value={avatar.color}
                            onChange={(e) =>
                              setAvatar((prev) => ({ ...prev, color: e.target.value }))
                            }
                            className="absolute inset-0 cursor-pointer opacity-0"
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Selector de 8 accesorios */}
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2.5">
                      Accesorio ({AVATAR_ACCESSORIES.length} opciones)
                    </h3>
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                      {AVATAR_ACCESSORIES.map((accessory) => {
                        const selected = avatar.accessory === accessory;
                        return (
                          <button
                            key={accessory}
                            type="button"
                            onClick={() => setAvatar((prev) => ({ ...prev, accessory }))}
                            className={`flex flex-col items-center gap-1 rounded-2xl p-2 text-center transition ${
                              selected
                                ? 'bg-blue-50 ring-2 ring-blue-500 dark:bg-blue-500/15 dark:ring-blue-400'
                                : 'bg-slate-50 hover:bg-slate-100 ring-1 ring-slate-200/80 dark:bg-slate-800/60 dark:hover:bg-slate-800 dark:ring-slate-700/80'
                            }`}
                          >
                            <VectorAvatar avatar={{ ...avatar, accessory }} size={38} />
                            <span className="w-full truncate text-[10px] font-medium text-slate-700 dark:text-slate-300">
                              {AVATAR_ACCESSORY_LABELS[accessory]}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Pie de acciones */}
                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={savingProfile}
                      className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-65"
                    >
                      {savingProfile ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      Guardar cambios
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleSavePassword} className="max-w-md mx-auto space-y-4 py-2">
                  <div>
                    <label
                      htmlFor="studio-current-password"
                      className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1"
                    >
                      Contraseña actual
                    </label>
                    <div className="relative">
                      <input
                        id="studio-current-password"
                        type={showCurrent ? 'text' : 'password'}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        autoComplete="current-password"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 pr-10 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrent((p) => !p)}
                        aria-label="Mostrar u ocultar contraseña actual"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="studio-new-password"
                      className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1"
                    >
                      Nueva contraseña (mínimo 8 caracteres)
                    </label>
                    <div className="relative">
                      <input
                        id="studio-new-password"
                        type={showNew ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        autoComplete="new-password"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 pr-10 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNew((p) => !p)}
                        aria-label="Mostrar u ocultar nueva contraseña"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="studio-confirm-password"
                      className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1"
                    >
                      Confirmar nueva contraseña
                    </label>
                    <input
                      id="studio-confirm-password"
                      type={showNew ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>

                  {passwordError ? (
                    <div
                      role="alert"
                      className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
                    >
                      {passwordError}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-end gap-3 pt-3">
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={savingPassword}
                      className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-65"
                    >
                      {savingPassword ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <KeyRound className="h-4 w-4" />
                      )}
                      Actualizar contraseña
                    </button>
                  </div>
                </form>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
