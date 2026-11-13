import { useEffect, useRef, useState } from 'react';
import {
  Activity as ActivityIcon,
  ChevronDown,
  Filter,
  Info,
  Plus,
  Search,
  SlidersHorizontal,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import {
  PRIORITY_OPTIONS,
  type Priority,
  type Role,
  type UserPublic,
} from '../../types/kanban';
import { VectorAvatar } from '../avatars/VectorAvatar';

export type QuickScopeFilter = 'ALL' | 'MINE';

export interface KanbanFilters {
  search: string;
  scope: QuickScopeFilter;
  assigneeId: string; // 'ALL' | 'UNASSIGNED' | 'TEAM' | userId
  priority: Priority | 'ALL';
}

interface KanbanToolbarProps {
  filters: KanbanFilters;
  onChangeFilters: (next: KanbanFilters) => void;
  users: UserPublic[];
  currentUserId: string;
  currentUserRole: Role;
  myTasksCount: number;
  totalTasksCount: number;
  filteredTasksCount: number;
  onCreateTask: () => void;
  onOpenActivity: () => void;
}

export function KanbanToolbar({
  filters,
  onChangeFilters,
  users,
  currentUserId,
  currentUserRole,
  myTasksCount,
  totalTasksCount,
  filteredTasksCount,
  onCreateTask,
  onOpenActivity,
}: KanbanToolbarProps) {
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!assigneeMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setAssigneeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [assigneeMenuOpen]);

  const advancedFiltersCount =
    (filters.assigneeId !== 'ALL' ? 1 : 0) + (filters.priority !== 'ALL' ? 1 : 0);
  const showAdvancedFilters = mobileFiltersOpen || advancedFiltersCount > 0;

  const hasActiveFilters =
    filters.search.trim().length > 0 ||
    filters.scope !== 'ALL' ||
    advancedFiltersCount > 0;

  const selectedAssignee =
    filters.assigneeId !== 'ALL' && filters.assigneeId !== 'UNASSIGNED'
      ? users.find((u) => u.id === filters.assigneeId) ?? null
      : null;

  const handleResetFilters = () => {
    setMobileFiltersOpen(false);
    onChangeFilters({
      search: '',
      scope: 'ALL',
      assigneeId: 'ALL',
      priority: 'ALL',
    });
  };

  const handleSelectScope = (scope: QuickScopeFilter) => {
    onChangeFilters({
      ...filters,
      scope,
      // Si el usuario activa "Mis tareas", limpiamos otro responsable distinto para evitar filtro vacío
      assigneeId: scope === 'MINE' ? 'ALL' : filters.assigneeId,
    });
  };

  const canCreateTasks = currentUserRole === 'LEADER' || currentUserRole === 'SUBLEADER';

  return (
    <section
      aria-label="Barra de herramientas y filtros del tablero"
      className="relative z-20 rounded-xl border border-zinc-200 bg-white p-2.5 sm:p-3 dark:border-[#272A33] dark:bg-[#181A1F]"
    >
      <div className="flex flex-col gap-2 sm:gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        {/* Buscador y filtros */}
        <div className="flex flex-1 flex-col gap-2 md:flex-row md:flex-wrap md:items-center min-w-0">
          {/* Buscador + botón de filtros en móvil */}
          <div className="flex items-center gap-2 w-full md:w-auto md:min-w-[220px] md:flex-1 md:max-w-xs">
            <div className="relative flex-1 min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={filters.search}
                onChange={(e) => onChangeFilters({ ...filters, search: e.target.value })}
                placeholder="Buscar actividades..."
                aria-label="Buscar actividades por título o descripción"
                className="min-h-[38px] w-full rounded-xl border border-zinc-200 bg-zinc-50/90 py-2 pl-9 pr-8 text-xs sm:text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 dark:border-[#2D3038] dark:bg-[#212329] dark:text-white dark:focus:bg-[#252830]"
              />
              {filters.search ? (
                <button
                  type="button"
                  onClick={() => onChangeFilters({ ...filters, search: '' })}
                  aria-label="Limpiar búsqueda"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => setMobileFiltersOpen((prev) => !prev)}
              aria-expanded={showAdvancedFilters}
              aria-label="Mostrar u ocultar filtros de responsable y prioridad"
              className={`md:hidden inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                showAdvancedFilters
                  ? 'border-blue-500/60 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300'
                  : 'border-zinc-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-[#2D3038] dark:bg-[#212329] dark:text-zinc-200'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Filtros</span>
              {advancedFiltersCount > 0 ? (
                <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">
                  {advancedFiltersCount}
                </span>
              ) : null}
            </button>
          </div>

          {/* Pills rápidas: Todas / Mis tareas (50/50 simétrico en móvil) */}
          <div
            role="group"
            aria-label="Filtro rápido de asignación"
            className="grid grid-cols-2 w-full md:inline-flex md:w-auto items-center rounded-xl border border-zinc-200 bg-zinc-100/90 p-1 dark:border-[#2D3038] dark:bg-[#212329]"
          >
            <button
              type="button"
              onClick={() => handleSelectScope('ALL')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-center transition ${
                filters.scope === 'ALL'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-[#14161B] dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              Todas ({totalTasksCount})
            </button>
            <button
              type="button"
              onClick={() => handleSelectScope('MINE')}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                filters.scope === 'MINE'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : currentUserRole === 'MEMBER'
                    ? 'text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-500/15'
                    : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <UserCheck className="h-3.5 w-3.5 shrink-0" />
              <span>Mis tareas</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                  filters.scope === 'MINE'
                    ? 'bg-white/20 text-white'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                }`}
              >
                {myTasksCount}
              </span>
            </button>
          </div>

          {/* Filtros de Responsable y Prioridad (colapsables en móvil, visibles en md+) */}
          <div
            className={`${
              showAdvancedFilters ? 'grid' : 'hidden md:flex'
            } grid-cols-2 gap-2 w-full md:w-auto md:items-center`}
          >
            {/* Selector de responsable con avatares */}
            <div ref={dropdownRef} className="relative w-full md:w-auto min-w-0">
              <button
                type="button"
                onClick={() => setAssigneeMenuOpen((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={assigneeMenuOpen}
                className="inline-flex min-h-[38px] w-full md:w-auto items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-xs transition hover:border-slate-300 hover:bg-slate-50 dark:border-[#2D3038] dark:bg-[#212329] dark:text-zinc-200 dark:hover:bg-[#292C34]"
              >
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  {selectedAssignee ? (
                    <>
                      <VectorAvatar avatar={selectedAssignee.avatar} size={18} />
                      <span className="truncate leading-tight">{selectedAssignee.displayName}</span>
                    </>
                  ) : filters.assigneeId === 'TEAM' ? (
                    <>
                      <Users className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
                      <span className="truncate">Todo el equipo</span>
                    </>
                  ) : filters.assigneeId === 'UNASSIGNED' ? (
                    <span className="truncate">Sin asignar</span>
                  ) : (
                    <>
                      <Filter className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="truncate">Responsable: Todos</span>
                    </>
                  )}
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              </button>

              {assigneeMenuOpen ? (
                <div
                  role="listbox"
                  aria-label="Filtrar por responsable"
                  className="absolute left-0 top-full z-50 mt-1.5 w-[260px] max-w-[calc(100vw-2rem)] rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-2xl dark:border-[#2D3038] dark:bg-[#181A1F]"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onChangeFilters({ ...filters, scope: 'ALL', assigneeId: 'ALL' });
                      setAssigneeMenuOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-medium transition ${
                      filters.assigneeId === 'ALL'
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#22252C]'
                    }`}
                  >
                    <span>Todos los integrantes</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onChangeFilters({ ...filters, scope: 'ALL', assigneeId: 'TEAM' });
                      setAssigneeMenuOpen(false);
                    }}
                    className={`mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium transition ${
                      filters.assigneeId === 'TEAM'
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#22252C]'
                    }`}
                  >
                    <Users className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
                    <span>Asignadas a todo el equipo</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onChangeFilters({ ...filters, scope: 'ALL', assigneeId: 'UNASSIGNED' });
                      setAssigneeMenuOpen(false);
                    }}
                    className={`mt-0.5 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-medium transition ${
                      filters.assigneeId === 'UNASSIGNED'
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#22252C]'
                    }`}
                  >
                    <span>Sin asignar</span>
                  </button>

                  <div className="my-1 border-t border-zinc-100 dark:border-[#272A33]" />

                  <div className="max-h-56 overflow-y-auto space-y-0.5">
                    {users.map((member) => {
                      const active = filters.assigneeId === member.id;
                      return (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => {
                            onChangeFilters({ ...filters, scope: 'ALL', assigneeId: member.id });
                            setAssigneeMenuOpen(false);
                          }}
                          className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-xs font-medium transition ${
                            active
                              ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#22252C]'
                          }`}
                        >
                          <VectorAvatar avatar={member.avatar} size={22} />
                          <span className="flex-1 whitespace-normal leading-snug">
                            {member.displayName}
                            {member.id === currentUserId ? ' (Tú)' : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Filtro por prioridad con chevron alineado */}
            <div className="relative w-full md:w-auto min-w-0">
              <select
                value={filters.priority}
                onChange={(e) =>
                  onChangeFilters({ ...filters, priority: e.target.value as Priority | 'ALL' })
                }
                aria-label="Filtrar por prioridad"
                className="min-h-[38px] w-full appearance-none rounded-xl border border-zinc-200 bg-white pl-3 pr-8 py-2 text-xs font-medium text-slate-700 shadow-xs outline-none transition hover:border-slate-300 focus:border-blue-500 dark:border-[#2D3038] dark:bg-[#212329] dark:text-zinc-200"
              >
                <option value="ALL">Prioridad: Todas</option>
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    Prioridad: {p.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            </div>

            {hasActiveFilters ? (
              <button
                type="button"
                onClick={handleResetFilters}
                className="col-span-2 md:col-span-1 inline-flex min-h-[36px] md:min-h-[38px] items-center justify-center gap-1 rounded-xl border border-zinc-200/80 md:border-transparent px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:border-[#2D3038] dark:md:border-transparent dark:text-zinc-400 dark:hover:bg-[#22252C] dark:hover:text-zinc-200"
              >
                <X className="h-3.5 w-3.5" />
                Limpiar ({filteredTasksCount}/{totalTasksCount})
              </button>
            ) : null}
          </div>
        </div>

        {/* Botones de acción derecha */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between xl:justify-end">
          {currentUserRole === 'SUBLEADER' ? (
            <span className="inline-flex w-full sm:w-auto items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-[11px] font-medium text-zinc-700 dark:bg-[#22252C] dark:text-zinc-300">
              <Info className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
              <span>Sublíder: puedes agregar tareas y mover las tuyas hasta HECHO</span>
            </span>
          ) : currentUserRole === 'MEMBER' ? (
            <span className="inline-flex w-full sm:w-auto items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-[11px] font-medium text-zinc-700 dark:bg-[#22252C] dark:text-zinc-300">
              <Info className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span>Mueve tus tarjetas hasta HECHO</span>
            </span>
          ) : null}

          <div
            className={`grid gap-2 w-full sm:flex sm:w-auto sm:items-center ${
              canCreateTasks ? 'grid-cols-2' : 'grid-cols-1'
            }`}
          >
            <button
              type="button"
              onClick={onOpenActivity}
              className="inline-flex min-h-[38px] items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs sm:text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-[#2D3038] dark:bg-[#212329] dark:text-zinc-200 dark:hover:bg-[#292C34]"
            >
              <ActivityIcon className="h-4 w-4 text-violet-500 shrink-0" />
              <span>Actividad</span>
            </button>

            {canCreateTasks ? (
              <button
                type="button"
                onClick={onCreateTask}
                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-white transition hover:bg-blue-700 active:scale-[0.98]"
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span>Nueva Actividad</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
