import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Calendar, HelpCircle, LogOut, Moon, Sun, Users, Wrench } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { getRoleLabel, KANBAN_COLUMNS } from '../../types/kanban';
import { RoleBadge, VectorAvatar } from '../avatars/VectorAvatar';

interface TopHeaderProps {
  onOpenAvatarStudio: () => void;
  onOpenTeam?: () => void;
  onOpenTutorial: () => void;
  onOpenMaintenance?: () => void;
  maintenanceActive?: boolean;
}

function formatSpanishDate(date: Date): string {
  const formatted = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export function TopHeader({
  onOpenAvatarStudio,
  onOpenTeam,
  onOpenTutorial,
  onOpenMaintenance,
  maintenanceActive = false,
}: TopHeaderProps) {
  const { user, users, maxUsers, tasks, onlineUserIds, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const dateLabel = useMemo(() => formatSpanishDate(new Date()), []);

  const stats = useMemo(() => {
    const total = tasks.length;
    const byStatus = {
      TODO: 0,
      IN_PROGRESS: 0,
      DONE: 0,
      APPROVED: 0,
    };
    for (const task of tasks) {
      byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
    }
    const approvedPct = total > 0 ? Math.round((byStatus.APPROVED / total) * 100) : 0;
    return { total, byStatus, approvedPct };
  }, [tasks]);

  const onlineSet = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);
  const onlineCount = useMemo(
    () => users.filter((u) => onlineSet.has(u.id)).length,
    [users, onlineSet],
  );

  if (!user) return null;

  const renderUtilityIcons = () => (
    <>
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
        className="inline-flex h-8 w-8 sm:min-h-[34px] sm:min-w-[34px] items-center justify-center rounded-lg border border-zinc-200 bg-white p-1.5 text-slate-700 shadow-xs transition hover:bg-slate-100 dark:border-[#2D3038] dark:bg-[#212329] dark:text-slate-200 dark:hover:bg-[#292C34]"
      >
        {theme === 'dark' ? (
          <Sun className="h-4 w-4 text-amber-400" />
        ) : (
          <Moon className="h-4 w-4 text-indigo-600" />
        )}
      </button>

      <button
        type="button"
        onClick={onOpenTutorial}
        aria-label="Abrir tutorial guiado"
        title="Abrir guía de bienvenida del Tablero Kanban"
        className="inline-flex h-8 sm:min-h-[34px] items-center justify-center gap-1.5 rounded-lg border border-blue-200/80 bg-blue-50/70 px-2 sm:px-2.5 text-xs font-semibold text-blue-700 shadow-xs transition hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300 dark:hover:bg-blue-500/25"
      >
        <HelpCircle className="h-4 w-4 sm:h-3.5 sm:w-3.5 text-blue-600 dark:text-blue-400" />
        <span className="hidden sm:inline">Guía</span>
      </button>
    </>
  );

  const renderAccountActions = (mobileFullWidth: boolean) => (
    <>
      <button
        type="button"
        onClick={onOpenAvatarStudio}
        className={`inline-flex min-h-[36px] sm:min-h-[34px] items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-xs transition hover:border-blue-300 hover:bg-blue-50/60 dark:border-[#2D3038] dark:bg-[#212329] dark:text-slate-100 dark:hover:border-blue-500/50 dark:hover:bg-[#292C34] ${
          mobileFullWidth ? 'flex-1 min-w-0' : ''
        }`}
      >
        <VectorAvatar avatar={user.avatar} size={18} />
        <span className="truncate sm:hidden">Mi Perfil</span>
        <span className="hidden sm:inline">Mi Perfil &amp; Avatar</span>
      </button>

      {user.role === 'LEADER' ? (
        <>
          <button
            type="button"
            onClick={onOpenTeam}
            className={`inline-flex min-h-[36px] sm:min-h-[34px] items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-200 dark:hover:bg-indigo-500/25 ${
              mobileFullWidth ? 'min-w-0' : ''
            }`}
          >
            <Users className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              Equipo ({users.length}/{maxUsers})
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenMaintenance}
            aria-pressed={maintenanceActive}
            title={
              maintenanceActive
                ? 'Ventana de mantenimiento activa — clic para configurar o reabrir el tablero'
                : 'Configurar ventana de mantenimiento'
            }
            className={`inline-flex min-h-[36px] sm:min-h-[34px] items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
              maintenanceActive
                ? 'border-amber-300 bg-amber-50 text-amber-800 ring-1 ring-amber-300/70 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30 dark:hover:bg-amber-500/25'
                : 'border-zinc-200 bg-white text-slate-700 shadow-xs hover:border-amber-300 hover:bg-amber-50/60 hover:text-amber-800 dark:border-[#2D3038] dark:bg-[#212329] dark:text-slate-200 dark:hover:border-amber-500/40 dark:hover:bg-[#292C34] dark:hover:text-amber-200'
            } ${mobileFullWidth ? 'min-w-0' : ''}`}
          >
            {maintenanceActive ? (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
              </span>
            ) : null}
            <Wrench
              className={`h-3.5 w-3.5 shrink-0 ${
                maintenanceActive
                  ? 'text-amber-600 dark:text-amber-300'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            />
            <span className="truncate">
              {maintenanceActive ? 'Mantenimiento activo' : 'Mantenimiento'}
            </span>
          </button>
        </>
      ) : null}

      <button
        type="button"
        onClick={() => logout('Sesión cerrada correctamente')}
        className={`inline-flex min-h-[36px] sm:min-h-[34px] items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 dark:border-[#2D3038] dark:bg-[#212329] dark:text-slate-300 dark:hover:border-red-500/30 dark:hover:bg-red-950/40 dark:hover:text-red-300 ${
          mobileFullWidth ? 'shrink-0' : ''
        }`}
      >
        <LogOut className="h-3.5 w-3.5 shrink-0" />
        <span>Salir</span>
      </button>
    </>
  );

  return (
    <header className="relative md:sticky md:top-0 z-30 border-b border-zinc-200 bg-white dark:border-[#272A33] dark:bg-[#181A1F]">
      <div className="mx-auto max-w-[1600px] px-3 py-2.5 sm:px-6 sm:py-2.5 lg:px-8">
        {/* Fila superior compacta: título/rol + iconos arriba en móvil; barra horizontal en desktop */}
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0 pt-0.5 lg:pt-0">
                <h1 className="text-[17px] sm:text-xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight">
                  Tablero Kanban
                </h1>
                <RoleBadge role={user.role} size="sm" />
                <span className="hidden md:inline-flex items-center gap-1 rounded-full bg-slate-100/90 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-[#22252C] dark:text-slate-300">
                  <Calendar className="h-3 w-3 text-blue-500" />
                  {dateLabel}
                </span>
                <span className="hidden xl:inline-flex items-center rounded-full bg-blue-50/90 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-blue-200/70 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/25">
                  Entrega: 07/11/26 – 19/12/26
                </span>
              </div>

              {/* Iconos rápidos siempre alineados arriba a la derecha en móvil/tablet */}
              <div className="flex items-center gap-1.5 shrink-0 md:hidden">
                {renderUtilityIcons()}
              </div>
            </div>

            <p className="mt-1 text-[10px] sm:text-[11px] font-bold tracking-wider uppercase text-slate-500 dark:text-zinc-400 leading-snug">
              VEAMOS CÓMO ESTÁN NUESTROS PROYECTOS Y TAREAS
            </p>

            {/* Fecha y periodo en móvil sin punto huérfano */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 md:hidden">
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100/90 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-[#22252C] dark:text-zinc-300">
                <Calendar className="h-3 w-3 text-blue-500 shrink-0" />
                <span>{dateLabel}</span>
              </span>
              <span className="inline-flex items-center rounded-md bg-blue-50/90 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-blue-200/70 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/25">
                07/11 – 19/12/26
              </span>
            </div>
          </div>

          {/* Tira simétrica de cuenta/equipo en móvil */}
          <div
            className={
              user.role === 'LEADER'
                ? 'grid grid-cols-2 gap-1.5 w-full md:hidden'
                : 'flex items-center gap-1.5 w-full md:hidden'
            }
          >
            {renderAccountActions(true)}
          </div>

          {/* Botones completos unificados en tablet y desktop (md+) */}
          <div className="hidden md:flex flex-wrap items-center gap-1.5 shrink-0">
            {renderUtilityIcons()}
            {renderAccountActions(false)}
          </div>
        </div>

        {/* Fila inferior minimalista: barra de progreso + burbujas en vivo */}
        <div className="mt-2.5 pt-2 border-t border-zinc-200/80 dark:border-[#272A33] grid grid-cols-1 gap-2 md:grid-cols-12 md:items-center">
          {/* Progreso general */}
          <div className="min-w-0 md:col-span-7 flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <div className="flex items-center justify-between md:justify-start w-full md:w-auto gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
                <span>Progreso aprobado</span>
                <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                  {stats.approvedPct}% ({stats.byStatus.APPROVED}/{stats.total})
                </span>
              </div>

              <div className="hidden md:flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                {KANBAN_COLUMNS.map((col) => (
                  <span key={col.status} className="inline-flex items-center gap-1">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: col.color }}
                    />
                    <span>{col.label}:</span>
                    <strong className="text-slate-700 dark:text-slate-200">
                      {stats.byStatus[col.status]}
                    </strong>
                  </span>
                ))}
              </div>
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-800">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${stats.approvedPct}%` }}
                transition={{ duration: 0.45, ease: 'easeOut' }}
                className="h-full rounded-full bg-[#2E9E5B]"
              />
            </div>
          </div>

          {/* Burbujas en vivo de los 6 usuarios */}
          <div className="min-w-0 md:col-span-5 flex items-center justify-between md:justify-end gap-2">
            <span className="text-[11px] font-medium text-slate-500 dark:text-zinc-400 shrink-0">
              Conectados ({onlineCount}/{users.length})
            </span>

            <div className="flex items-center gap-1">
              {users.map((member, index) => {
                const isOnline = onlineSet.has(member.id);
                const isSelf = member.id === user.id;
                const roleLabel = getRoleLabel(member.role);

                return (
                  <div key={member.id} className="group relative">
                    <button
                      type="button"
                      onClick={isSelf ? onOpenAvatarStudio : undefined}
                      aria-label={`${member.displayName} (${roleLabel}) — ${
                        isOnline ? 'En línea' : 'Desconectado'
                      }`}
                      className={`relative rounded-full p-0.5 transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        isSelf
                          ? 'ring-2 ring-blue-500/80 cursor-pointer hover:scale-105'
                          : 'ring-1 ring-slate-200 dark:ring-slate-700 cursor-default'
                      }`}
                    >
                      <VectorAvatar
                        avatar={member.avatar}
                        size={24}
                        className={isOnline ? '' : 'opacity-65 grayscale-[30%]'}
                      />

                      {/* Punto de presencia en vivo */}
                      <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5 items-center justify-center">
                        {isOnline ? (
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        ) : null}
                        <span
                          className={`relative inline-flex h-2 w-2 rounded-full ring-2 ring-white dark:ring-[#181A1F] ${
                            isOnline ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-600'
                          }`}
                        />
                      </span>
                    </button>

                    {/* Tooltip con nombre y rol sin desbordar en móvil */}
                    <div
                      role="tooltip"
                      className={`pointer-events-none absolute ${
                        index >= 2 ? 'right-0' : 'left-0'
                      } md:left-1/2 md:right-auto md:-translate-x-1/2 top-full mt-2 z-50 hidden w-max max-w-[260px] rounded-xl border border-slate-200 bg-slate-900 px-3 py-2 text-xs text-white shadow-xl group-hover:block group-focus-within:block dark:border-slate-700 dark:bg-slate-800`}
                    >
                      <div className="font-semibold leading-snug">
                        {member.displayName} {isSelf ? '(Tú)' : ''}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-300">
                        <span>{roleLabel}</span>
                        <span>•</span>
                        <span className={isOnline ? 'text-emerald-400' : 'text-slate-400'}>
                          {isOnline ? 'En línea' : 'Desconectado'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
