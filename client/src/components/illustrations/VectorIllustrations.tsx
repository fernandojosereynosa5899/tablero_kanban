interface IllustrationProps {
  className?: string;
}

export function LoginHeroIllustration({ className = '' }: IllustrationProps) {
  return (
    <svg
      viewBox="0 0 440 310"
      className={`w-full h-auto select-none ${className}`}
      role="img"
      aria-label="Ilustración de tablero Kanban colaborativo"
    >
      <defs>
        <linearGradient id="hero-card-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1E88E5" stopOpacity="0.14" />
          <stop offset="50%" stopColor="#7E57C2" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#2E9E5B" stopOpacity="0.14" />
        </linearGradient>
        <linearGradient id="hero-bar" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1E88E5" />
          <stop offset="55%" stopColor="#7E57C2" />
          <stop offset="100%" stopColor="#2E9E5B" />
        </linearGradient>
      </defs>

      {/* Fondo suave */}
      <rect x="12" y="14" width="416" height="280" rx="26" fill="url(#hero-card-bg)" />

      {/* Destellos decorativos */}
      <circle cx="48" cy="46" r="6" fill="#1E88E5" opacity="0.55" />
      <circle cx="394" cy="44" r="8" fill="#FFA726" opacity="0.55" />
      <circle cx="398" cy="264" r="5" fill="#2E9E5B" opacity="0.6" />

      {/* Marco principal del mini tablero */}
      <rect
        x="34"
        y="34"
        width="372"
        height="240"
        rx="18"
        className="fill-white dark:fill-slate-900"
        stroke="rgba(148,163,184,0.35)"
        strokeWidth="1.5"
      />

      {/* Cabecera del tablero */}
      <rect x="52" y="52" width="124" height="10" rx="5" className="fill-slate-800 dark:fill-slate-100" />
      <rect x="52" y="69" width="186" height="6" rx="3" className="fill-slate-300 dark:fill-slate-700" />

      {/* Burbujas de presencia */}
      <circle cx="318" cy="60" r="10" fill="#1E88E5" />
      <circle cx="342" cy="60" r="10" fill="#7E57C2" />
      <circle cx="366" cy="60" r="10" fill="#2E9E5B" />
      <circle cx="325" cy="67" r="3.5" fill="#22C55E" stroke="#FFFFFF" strokeWidth="1.5" />
      <circle cx="349" cy="67" r="3.5" fill="#22C55E" stroke="#FFFFFF" strokeWidth="1.5" />
      <circle cx="373" cy="67" r="3.5" fill="#94A3B8" stroke="#FFFFFF" strokeWidth="1.5" />

      {/* Barra de progreso */}
      <rect x="52" y="86" width="336" height="8" rx="4" className="fill-slate-100 dark:fill-slate-800" />
      <rect x="52" y="86" width="236" height="8" rx="4" fill="url(#hero-bar)" />

      {/* 4 columnas */}
      {/* Columna 1: POR HACER */}
      <rect x="52" y="108" width="76" height="148" rx="10" className="fill-slate-50 dark:fill-slate-800/80" />
      <rect x="60" y="116" width="42" height="5" rx="2.5" fill="#1E88E5" />
      <rect x="60" y="130" width="60" height="44" rx="8" className="fill-white dark:fill-slate-900" stroke="#1E88E5" strokeOpacity="0.35" />
      <rect x="67" y="139" width="44" height="5" rx="2.5" className="fill-slate-700 dark:fill-slate-200" />
      <rect x="67" y="149" width="32" height="4" rx="2" className="fill-slate-300 dark:fill-slate-600" />
      <circle cx="109" cy="163" r="5" fill="#1E88E5" />
      <rect x="60" y="182" width="60" height="36" rx="8" className="fill-white dark:fill-slate-900" stroke="rgba(148,163,184,0.3)" />
      <rect x="67" y="191" width="40" height="5" rx="2.5" className="fill-slate-700 dark:fill-slate-200" />
      <rect x="67" y="201" width="26" height="4" rx="2" className="fill-slate-300 dark:fill-slate-600" />

      {/* Columna 2: EN PROCESO */}
      <rect x="138" y="108" width="76" height="148" rx="10" className="fill-slate-50 dark:fill-slate-800/80" />
      <rect x="146" y="116" width="44" height="5" rx="2.5" fill="#FFA726" />
      <rect x="146" y="130" width="60" height="52" rx="8" className="fill-white dark:fill-slate-900" stroke="#FFA726" strokeOpacity="0.5" />
      <rect x="153" y="139" width="46" height="5" rx="2.5" className="fill-slate-700 dark:fill-slate-200" />
      <rect x="153" y="149" width="36" height="4" rx="2" className="fill-slate-300 dark:fill-slate-600" />
      <rect x="153" y="160" width="28" height="4" rx="2" fill="#FFA726" opacity="0.65" />
      <circle cx="195" cy="171" r="5" fill="#FFA726" />

      {/* Columna 3: HECHO */}
      <rect x="224" y="108" width="76" height="148" rx="10" className="fill-slate-50 dark:fill-slate-800/80" />
      <rect x="232" y="116" width="36" height="5" rx="2.5" fill="#7E57C2" />
      <rect x="232" y="130" width="60" height="44" rx="8" className="fill-white dark:fill-slate-900" stroke="#7E57C2" strokeOpacity="0.45" />
      <rect x="239" y="139" width="44" height="5" rx="2.5" className="fill-slate-700 dark:fill-slate-200" />
      <rect x="239" y="149" width="30" height="4" rx="2" className="fill-slate-300 dark:fill-slate-600" />
      <circle cx="281" cy="163" r="5" fill="#7E57C2" />

      {/* Columna 4: APROBADO */}
      <rect x="310" y="108" width="78" height="148" rx="10" className="fill-slate-50 dark:fill-slate-800/80" />
      <rect x="318" y="116" width="46" height="5" rx="2.5" fill="#2E9E5B" />
      <rect x="318" y="130" width="62" height="46" rx="8" className="fill-white dark:fill-slate-900" stroke="#2E9E5B" strokeOpacity="0.5" />
      <rect x="325" y="139" width="42" height="5" rx="2.5" className="fill-slate-700 dark:fill-slate-200" />
      <rect x="325" y="149" width="34" height="4" rx="2" className="fill-slate-300 dark:fill-slate-600" />
      <circle cx="368" cy="164" r="6" fill="#2E9E5B" />
      <path d="M365.5 164 L367.3 165.8 L370.8 162.2" fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />

      {/* Tarjeta flotante arrastrada */}
      <g transform="translate(186, 194) rotate(-3)">
        <rect
          x="0"
          y="0"
          width="88"
          height="46"
          rx="10"
          className="fill-white dark:fill-slate-900"
          stroke="#1E88E5"
          strokeWidth="1.8"
        />
        <rect x="10" y="11" width="54" height="5" rx="2.5" className="fill-slate-800 dark:fill-slate-100" />
        <rect x="10" y="21" width="38" height="4" rx="2" className="fill-slate-300 dark:fill-slate-600" />
        <circle cx="72" cy="32" r="5" fill="#1E88E5" />
      </g>
    </svg>
  );
}

export function EmptyColumnIllustration({ className = '' }: IllustrationProps) {
  return (
    <svg
      viewBox="0 0 140 100"
      className={`w-28 h-auto select-none ${className}`}
      aria-hidden="true"
    >
      <rect
        x="22"
        y="18"
        width="96"
        height="64"
        rx="12"
        fill="none"
        className="stroke-slate-300 dark:stroke-slate-700"
        strokeWidth="2"
        strokeDasharray="6 5"
      />
      <rect x="36" y="34" width="52" height="7" rx="3.5" className="fill-slate-200 dark:fill-slate-700" />
      <rect x="36" y="48" width="68" height="6" rx="3" className="fill-slate-200/80 dark:fill-slate-800" />
      <circle cx="96" cy="64" r="9" className="fill-blue-500/15" />
      <path d="M92 64 L95 67 L101 61" fill="none" stroke="#1E88E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EmptyActivityIllustration({ className = '' }: IllustrationProps) {
  return (
    <svg
      viewBox="0 0 140 100"
      className={`w-28 h-auto select-none ${className}`}
      aria-hidden="true"
    >
      <circle cx="34" cy="30" r="7" className="fill-violet-500/20" />
      <circle cx="34" cy="30" r="3" fill="#7E57C2" />
      <rect x="50" y="25" width="66" height="8" rx="4" className="fill-slate-200 dark:fill-slate-700" />
      <line x1="34" y1="39" x2="34" y2="51" className="stroke-slate-300 dark:stroke-slate-700" strokeWidth="2" strokeDasharray="3 3" />
      <circle cx="34" cy="60" r="7" className="fill-emerald-500/20" />
      <circle cx="34" cy="60" r="3" fill="#2E9E5B" />
      <rect x="50" y="55" width="54" height="8" rx="4" className="fill-slate-200/80 dark:fill-slate-800" />
    </svg>
  );
}
