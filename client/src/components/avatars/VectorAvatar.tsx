import { useId } from 'react';
import type { AvatarAccessory, AvatarConfig, AvatarPreset, Role } from '../../types/kanban';
import { DEFAULT_AVATAR } from '../../types/kanban';

export const AVATAR_PRESET_LABELS: Record<AvatarPreset, string> = {
  astronauta: 'Astronauta',
  robot: 'Robot',
  gato: 'Gato',
  zorro: 'Zorro',
  buho: 'Búho',
  panda: 'Panda',
  ninja: 'Ninja',
  mago: 'Mago',
  piloto: 'Piloto',
  artista: 'Artista',
  chef: 'Chef',
  gamer: 'Gamer',
  cientifica: 'Científica',
  exploradora: 'Exploradora',
  oso: 'Oso',
  koala: 'Koala',
};

export const AVATAR_ACCESSORY_LABELS: Record<AvatarAccessory, string> = {
  none: 'Ninguno',
  glasses: 'Lentes',
  headphones: 'Audífonos',
  crown: 'Corona',
  cap: 'Gorra',
  bow: 'Moño',
  star: 'Estrella',
  earring: 'Arete',
};

export const AVATAR_BG_PALETTE = [
  '#1E88E5',
  '#7E57C2',
  '#2E9E5B',
  '#FFA726',
  '#EF4444',
  '#EC4899',
  '#06B6D4',
  '#0F172A',
  '#334155',
  '#6366F1',
] as const;

export const AVATAR_COLOR_PALETTE = [
  '#FFFFFF',
  '#FDE68A',
  '#BAE6FD',
  '#FBCFE8',
  '#BBF7D0',
  '#FED7AA',
  '#DDD6FE',
  '#94A3B8',
  '#334155',
  '#1E293B',
] as const;

interface VectorAvatarProps {
  avatar?: AvatarConfig | null;
  size?: number;
  className?: string;
  title?: string;
}

function renderPreset(preset: string, color: string) {
  const stroke = 'rgba(15, 23, 42, 0.22)';

  switch (preset) {
    case 'astronauta':
      return (
        <g>
          {/* Traje / hombros */}
          <path d="M20 96 C22 76, 78 76, 80 96 Z" fill={color} stroke={stroke} strokeWidth="2" />
          <rect x="38" y="77" width="24" height="8" rx="4" fill="#94A3B8" />
          {/* Antenas del casco */}
          <line x1="22" y1="50" x2="17" y2="38" stroke="#CBD5E1" strokeWidth="3" strokeLinecap="round" />
          <circle cx="17" cy="36" r="3" fill="#38BDF8" />
          {/* Casco */}
          <circle cx="50" cy="50" r="28" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Visera */}
          <rect x="30" y="34" width="40" height="27" rx="13" fill="#0F172A" stroke="#475569" strokeWidth="2" />
          {/* Reflejo visera */}
          <path d="M36 41 C41 37, 48 37, 54 39" fill="none" stroke="#38BDF8" strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
          {/* Ojos brillantes dentro del visor */}
          <circle cx="42" cy="48" r="2.6" fill="#E0F2FE" />
          <circle cx="58" cy="48" r="2.6" fill="#E0F2FE" />
        </g>
      );

    case 'robot':
      return (
        <g>
          {/* Antena */}
          <line x1="50" y1="14" x2="50" y2="25" stroke="#64748B" strokeWidth="3" strokeLinecap="round" />
          <circle cx="50" cy="13" r="4" fill="#38BDF8" stroke={stroke} strokeWidth="1.5" />
          {/* Orejas mecánicas */}
          <rect x="17" y="42" width="7" height="18" rx="3" fill="#64748B" />
          <rect x="76" y="42" width="7" height="18" rx="3" fill="#64748B" />
          {/* Cuello / torso */}
          <path d="M24 96 C26 78, 74 78, 76 96 Z" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Cabeza */}
          <rect x="23" y="25" width="54" height="50" rx="14" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Pantalla ojos */}
          <rect x="30" y="36" width="40" height="19" rx="7" fill="#0F172A" />
          <circle cx="41" cy="45.5" r="4" fill="#22D3EE" />
          <circle cx="59" cy="45.5" r="4" fill="#22D3EE" />
          {/* Rejilla boca */}
          <rect x="37" y="61" width="26" height="7" rx="3.5" fill="#1E293B" />
          <line x1="43" y1="61" x2="43" y2="68" stroke="#94A3B8" strokeWidth="1.5" />
          <line x1="50" y1="61" x2="50" y2="68" stroke="#94A3B8" strokeWidth="1.5" />
          <line x1="57" y1="61" x2="57" y2="68" stroke="#94A3B8" strokeWidth="1.5" />
        </g>
      );

    case 'gato':
      return (
        <g>
          <path d="M24 96 C26 78, 74 78, 76 96 Z" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Orejas */}
          <polygon points="24,44 26,18 44,32" fill={color} stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
          <polygon points="76,44 74,18 56,32" fill={color} stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
          <polygon points="28,39 29,24 40,33" fill="#FDA4AF" />
          <polygon points="72,39 71,24 60,33" fill="#FDA4AF" />
          {/* Cara */}
          <circle cx="50" cy="52" r="25" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Ojos */}
          <circle cx="40" cy="49" r="3.4" fill="#0F172A" />
          <circle cx="60" cy="49" r="3.4" fill="#0F172A" />
          <circle cx="39" cy="47.8" r="1.1" fill="#FFFFFF" />
          <circle cx="59" cy="47.8" r="1.1" fill="#FFFFFF" />
          {/* Nariz y boca */}
          <polygon points="47,55 53,55 50,59" fill="#FB7185" />
          <path d="M44 62 Q47 64 50 60 Q53 64 56 62" fill="none" stroke="#334155" strokeWidth="1.8" strokeLinecap="round" />
          {/* Bigotes */}
          <line x1="21" y1="53" x2="34" y2="55" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="21" y1="59" x2="34" y2="59" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="79" y1="53" x2="66" y2="55" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="79" y1="59" x2="66" y2="59" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      );

    case 'zorro':
      return (
        <g>
          <path d="M24 96 C26 78, 74 78, 76 96 Z" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Orejas puntiagudas */}
          <polygon points="24,46 22,16 44,31" fill={color} stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
          <polygon points="76,46 78,16 56,31" fill={color} stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
          <polygon points="27,39 26,23 39,32" fill="#1E293B" />
          <polygon points="73,39 74,23 61,32" fill="#1E293B" />
          {/* Cabeza */}
          <ellipse cx="50" cy="52" rx="26" ry="23" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Mejillas crema */}
          <path d="M24 54 C31 54, 42 60, 50 74 C36 74, 26 66, 24 54 Z" fill="#FFF7ED" />
          <path d="M76 54 C69 54, 58 60, 50 74 C64 74, 74 66, 76 54 Z" fill="#FFF7ED" />
          {/* Ojos */}
          <circle cx="40" cy="49" r="3.2" fill="#0F172A" />
          <circle cx="60" cy="49" r="3.2" fill="#0F172A" />
          <circle cx="39" cy="48" r="1" fill="#FFFFFF" />
          <circle cx="59" cy="48" r="1" fill="#FFFFFF" />
          {/* Nariz */}
          <circle cx="50" cy="60" r="3.5" fill="#0F172A" />
        </g>
      );

    case 'buho':
      return (
        <g>
          <path d="M22 96 C24 76, 76 76, 78 96 Z" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Penachos */}
          <polygon points="25,36 22,19 38,28" fill={color} stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
          <polygon points="75,36 78,19 62,28" fill={color} stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
          {/* Cuerpo/cabeza */}
          <ellipse cx="50" cy="52" rx="26" ry="25" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Discos oculares */}
          <circle cx="39" cy="48" r="10.5" fill="#FEF3C7" stroke={stroke} strokeWidth="1.5" />
          <circle cx="61" cy="48" r="10.5" fill="#FEF3C7" stroke={stroke} strokeWidth="1.5" />
          <circle cx="39" cy="48" r="4.5" fill="#0F172A" />
          <circle cx="61" cy="48" r="4.5" fill="#0F172A" />
          <circle cx="37.5" cy="46.5" r="1.5" fill="#FFFFFF" />
          <circle cx="59.5" cy="46.5" r="1.5" fill="#FFFFFF" />
          {/* Pico */}
          <polygon points="46,54 54,54 50,62" fill="#F59E0B" stroke={stroke} strokeWidth="1.2" />
        </g>
      );

    case 'panda':
      return (
        <g>
          {/* Cuerpo con chaleco del color elegido */}
          <path d="M22 96 C24 76, 76 76, 78 96 Z" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Orejas negras */}
          <circle cx="28" cy="29" r="9.5" fill="#1E293B" />
          <circle cx="72" cy="29" r="9.5" fill="#1E293B" />
          {/* Cabeza */}
          <circle cx="50" cy="52" r="25" fill="#FFFFFF" stroke={stroke} strokeWidth="2" />
          {/* Manchas ojos */}
          <ellipse cx="39" cy="49" rx="7" ry="8.5" transform="rotate(-15 39 49)" fill="#1E293B" />
          <ellipse cx="61" cy="49" rx="7" ry="8.5" transform="rotate(15 61 49)" fill="#1E293B" />
          <circle cx="40" cy="48" r="2.5" fill="#FFFFFF" />
          <circle cx="60" cy="48" r="2.5" fill="#FFFFFF" />
          <circle cx="40" cy="48" r="1.2" fill="#0F172A" />
          <circle cx="60" cy="48" r="1.2" fill="#0F172A" />
          {/* Nariz y sonrisa */}
          <ellipse cx="50" cy="57" rx="4" ry="2.6" fill="#1E293B" />
          <path d="M45 62 Q50 66 55 62" fill="none" stroke="#1E293B" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      );

    case 'ninja':
      return (
        <g>
          <path d="M22 96 C24 76, 76 76, 78 96 Z" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Cinta trasera */}
          <path d="M72 37 L86 33 L82 41 Z" fill="#EF4444" />
          {/* Capucha */}
          <circle cx="50" cy="50" r="26" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Cinta roja */}
          <rect x="25" y="34" width="50" height="6" rx="3" fill="#EF4444" />
          {/* Abertura ojos */}
          <rect x="29" y="42" width="42" height="15" rx="7.5" fill="#FDE68A" stroke={stroke} strokeWidth="1.5" />
          {/* Ojos decididos */}
          <circle cx="41" cy="49.5" r="3" fill="#0F172A" />
          <circle cx="59" cy="49.5" r="3" fill="#0F172A" />
          <line x1="36" y1="45" x2="44" y2="47" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" />
          <line x1="64" y1="45" x2="56" y2="47" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" />
        </g>
      );

    case 'mago':
      return (
        <g>
          {/* Túnica */}
          <path d="M20 96 C22 76, 78 76, 80 96 Z" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Rostro */}
          <circle cx="50" cy="54" r="21" fill="#FDE68A" stroke={stroke} strokeWidth="2" />
          {/* Ojos */}
          <circle cx="42" cy="51" r="2.7" fill="#0F172A" />
          <circle cx="58" cy="51" r="2.7" fill="#0F172A" />
          {/* Barba */}
          <path d="M32 58 Q50 84 68 58 Q59 64 50 62 Q41 64 32 58 Z" fill="#F8FAFC" stroke={stroke} strokeWidth="1.4" />
          {/* Sombrero puntiagudo */}
          <polygon points="31,37 50,8 69,37" fill={color} stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
          <ellipse cx="50" cy="37" rx="28" ry="5.5" fill={color} stroke={stroke} strokeWidth="2" />
          <circle cx="50" cy="24" r="3.2" fill="#FBBF24" />
        </g>
      );

    case 'piloto':
      return (
        <g>
          {/* Chaqueta + bufanda */}
          <path d="M22 96 C24 76, 76 76, 78 96 Z" fill={color} stroke={stroke} strokeWidth="2" />
          <path d="M37 78 L63 78 L58 88 L42 88 Z" fill="#F97316" />
          {/* Cara */}
          <circle cx="50" cy="53" r="22" fill="#FED7AA" stroke={stroke} strokeWidth="2" />
          {/* Casco aviador */}
          <path d="M27 52 C27 30, 73 30, 73 52 L73 58 L67 58 L67 44 C59 38, 41 38, 33 44 L33 58 L27 58 Z" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Gafas de aviador en la frente */}
          <rect x="33" y="33" width="15" height="10" rx="4" fill="#38BDF8" stroke="#1E293B" strokeWidth="2" />
          <rect x="52" y="33" width="15" height="10" rx="4" fill="#38BDF8" stroke="#1E293B" strokeWidth="2" />
          <line x1="48" y1="38" x2="52" y2="38" stroke="#1E293B" strokeWidth="2" />
          {/* Ojos y sonrisa */}
          <circle cx="42" cy="54" r="2.7" fill="#0F172A" />
          <circle cx="58" cy="54" r="2.7" fill="#0F172A" />
          <path d="M44 63 Q50 67 56 63" fill="none" stroke="#7C2D12" strokeWidth="2" strokeLinecap="round" />
        </g>
      );

    case 'artista':
      return (
        <g>
          {/* Delantal */}
          <path d="M22 96 C24 76, 76 76, 78 96 Z" fill={color} stroke={stroke} strokeWidth="2" />
          <circle cx="38" cy="88" r="3" fill="#EC4899" />
          <circle cx="58" cy="89" r="2.5" fill="#FBBF24" />
          {/* Cara */}
          <circle cx="50" cy="54" r="22" fill="#FDE68A" stroke={stroke} strokeWidth="2" />
          {/* Cabello */}
          <path d="M28 52 C28 36, 72 36, 72 52 C64 42, 36 42, 28 52 Z" fill="#475569" />
          {/* Boina */}
          <ellipse cx="47" cy="30" rx="22" ry="9" transform="rotate(-12 47 30)" fill={color} stroke={stroke} strokeWidth="2" />
          <line x1="45" y1="18" x2="46" y2="22" stroke="#1E293B" strokeWidth="2.5" strokeLinecap="round" />
          {/* Ojos y sonrisa */}
          <circle cx="42" cy="54" r="2.7" fill="#0F172A" />
          <circle cx="58" cy="54" r="2.7" fill="#0F172A" />
          <circle cx="36" cy="59" r="2.8" fill="#FDA4AF" opacity="0.7" />
          <circle cx="64" cy="59" r="2.8" fill="#FDA4AF" opacity="0.7" />
          <path d="M44 63 Q50 67 56 63" fill="none" stroke="#334155" strokeWidth="1.9" strokeLinecap="round" />
        </g>
      );

    case 'chef':
      return (
        <g>
          {/* Filipina */}
          <path d="M22 96 C24 76, 76 76, 78 96 Z" fill={color} stroke={stroke} strokeWidth="2" />
          <path d="M42 78 L50 86 L58 78" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" />
          {/* Cara */}
          <circle cx="50" cy="57" r="21" fill="#FED7AA" stroke={stroke} strokeWidth="2" />
          {/* Gorro de chef */}
          <path d="M31 41 C24 31, 33 20, 42 23 C45 15, 55 15, 58 23 C67 20, 76 31, 69 41 Z" fill="#FFFFFF" stroke={stroke} strokeWidth="2" />
          <rect x="33" y="38" width="34" height="7" rx="2" fill={color} stroke={stroke} strokeWidth="1.5" />
          {/* Ojos y bigote */}
          <circle cx="42" cy="54" r="2.6" fill="#0F172A" />
          <circle cx="58" cy="54" r="2.6" fill="#0F172A" />
          <path d="M41 62 Q45.5 59 50 62 Q54.5 59 59 62" fill="none" stroke="#334155" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      );

    case 'gamer':
      return (
        <g>
          {/* Hoodie */}
          <path d="M20 96 C22 76, 78 76, 80 96 Z" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Cabeza */}
          <circle cx="50" cy="52" r="22" fill="#FDE68A" stroke={stroke} strokeWidth="2" />
          {/* Cabello estilizado */}
          <path d="M27 49 C27 29, 73 29, 73 49 C67 39, 55 36, 48 42 C41 36, 33 40, 27 49 Z" fill={color} stroke={stroke} strokeWidth="1.8" />
          {/* Visor gamer */}
          <rect x="32" y="45" width="36" height="12" rx="6" fill="#0F172A" stroke="#22D3EE" strokeWidth="2" />
          <line x1="38" y1="51" x2="46" y2="51" stroke="#38BDF8" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="54" y1="51" x2="62" y2="51" stroke="#A855F7" strokeWidth="2.2" strokeLinecap="round" />
          {/* Sonrisa */}
          <path d="M44 64 Q50 68 57 63" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" />
        </g>
      );

    case 'cientifica':
      return (
        <g>
          {/* Bata */}
          <path d="M20 96 C22 76, 78 76, 80 96 Z" fill="#FFFFFF" stroke={stroke} strokeWidth="2" />
          <path d="M44 78 L50 92 L56 78" fill={color} />
          {/* Moño de cabello */}
          <circle cx="50" cy="22" r="9" fill={color} stroke={stroke} strokeWidth="1.8" />
          {/* Cabeza */}
          <circle cx="50" cy="53" r="22" fill="#FED7AA" stroke={stroke} strokeWidth="2" />
          <path d="M28 50 C29 33, 71 33, 72 50 C63 40, 37 40, 28 50 Z" fill={color} />
          {/* Gafas de laboratorio */}
          <circle cx="41" cy="53" r="6.5" fill="rgba(56,189,248,0.22)" stroke="#0F172A" strokeWidth="2" />
          <circle cx="59" cy="53" r="6.5" fill="rgba(56,189,248,0.22)" stroke="#0F172A" strokeWidth="2" />
          <line x1="47.5" y1="53" x2="52.5" y2="53" stroke="#0F172A" strokeWidth="2" />
          <circle cx="41" cy="53" r="2.2" fill="#0F172A" />
          <circle cx="59" cy="53" r="2.2" fill="#0F172A" />
          <path d="M45 64 Q50 67 55 64" fill="none" stroke="#334155" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      );

    case 'exploradora':
      return (
        <g>
          {/* Chaleco */}
          <path d="M22 96 C24 76, 76 76, 78 96 Z" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Cabello */}
          <circle cx="31" cy="60" r="8" fill="#78350F" />
          <circle cx="69" cy="60" r="8" fill="#78350F" />
          {/* Cara */}
          <circle cx="50" cy="55" r="21" fill="#FDE68A" stroke={stroke} strokeWidth="2" />
          {/* Sombrero explorador */}
          <path d="M32 39 C34 23, 66 23, 68 39 Z" fill={color} stroke={stroke} strokeWidth="2" />
          <ellipse cx="50" cy="40" rx="28" ry="5.5" fill={color} stroke={stroke} strokeWidth="2" />
          <rect x="34" y="34" width="32" height="4" rx="2" fill="#92400E" />
          {/* Ojos y sonrisa */}
          <circle cx="42" cy="54" r="2.7" fill="#0F172A" />
          <circle cx="58" cy="54" r="2.7" fill="#0F172A" />
          <path d="M44 63 Q50 67 56 63" fill="none" stroke="#334155" strokeWidth="1.9" strokeLinecap="round" />
        </g>
      );

    case 'oso':
      return (
        <g>
          <path d="M22 96 C24 76, 76 76, 78 96 Z" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Orejas redondas */}
          <circle cx="29" cy="31" r="9.5" fill={color} stroke={stroke} strokeWidth="2" />
          <circle cx="71" cy="31" r="9.5" fill={color} stroke={stroke} strokeWidth="2" />
          <circle cx="29" cy="31" r="5" fill="#FDE68A" />
          <circle cx="71" cy="31" r="5" fill="#FDE68A" />
          {/* Cabeza */}
          <circle cx="50" cy="53" r="25" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Hocico */}
          <ellipse cx="50" cy="60" rx="11" ry="8.5" fill="#FEF3C7" />
          <ellipse cx="50" cy="57" rx="4" ry="2.8" fill="#1E293B" />
          <path d="M46 63 Q50 66 54 63" fill="none" stroke="#1E293B" strokeWidth="1.8" strokeLinecap="round" />
          {/* Ojos */}
          <circle cx="39" cy="48" r="3" fill="#0F172A" />
          <circle cx="61" cy="48" r="3" fill="#0F172A" />
        </g>
      );

    case 'koala':
    default:
      return (
        <g>
          <path d="M22 96 C24 76, 76 76, 78 96 Z" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Grandes orejas */}
          <circle cx="23" cy="45" r="12" fill={color} stroke={stroke} strokeWidth="2" />
          <circle cx="77" cy="45" r="12" fill={color} stroke={stroke} strokeWidth="2" />
          <circle cx="23" cy="45" r="6.5" fill="#E2E8F0" />
          <circle cx="77" cy="45" r="6.5" fill="#E2E8F0" />
          {/* Cabeza */}
          <circle cx="50" cy="53" r="23" fill={color} stroke={stroke} strokeWidth="2" />
          {/* Nariz ovalada típica */}
          <ellipse cx="50" cy="56" rx="5.2" ry="7.2" fill="#1E293B" />
          {/* Ojos */}
          <circle cx="37" cy="50" r="2.8" fill="#0F172A" />
          <circle cx="63" cy="50" r="2.8" fill="#0F172A" />
          <path d="M45 66 Q50 69 55 66" fill="none" stroke="#334155" strokeWidth="1.7" strokeLinecap="round" />
        </g>
      );
  }
}

function renderAccessory(accessory: AvatarAccessory) {
  switch (accessory) {
    case 'none':
      return null;

    case 'glasses':
      return (
        <g>
          <rect x="29" y="42" width="18" height="13" rx="5" fill="rgba(255,255,255,0.18)" stroke="#0F172A" strokeWidth="2.4" />
          <rect x="53" y="42" width="18" height="13" rx="5" fill="rgba(255,255,255,0.18)" stroke="#0F172A" strokeWidth="2.4" />
          <line x1="47" y1="48" x2="53" y2="48" stroke="#0F172A" strokeWidth="2.4" />
          <line x1="23" y1="46" x2="29" y2="48" stroke="#0F172A" strokeWidth="2" />
          <line x1="77" y1="46" x2="71" y2="48" stroke="#0F172A" strokeWidth="2" />
        </g>
      );

    case 'headphones':
      return (
        <g>
          <path d="M21 50 C21 20, 79 20, 79 50" fill="none" stroke="#1E293B" strokeWidth="4.5" strokeLinecap="round" />
          <rect x="14" y="43" width="9" height="18" rx="4.5" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.5" />
          <rect x="77" y="43" width="9" height="18" rx="4.5" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.5" />
        </g>
      );

    case 'crown':
      return (
        <g>
          <polygon
            points="32,26 36,11 45,19 50,8 55,19 64,11 68,26"
            fill="#FBBF24"
            stroke="#B45309"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <rect x="32" y="24" width="36" height="4.5" rx="2" fill="#F59E0B" stroke="#B45309" strokeWidth="1.2" />
          <circle cx="50" cy="18" r="2" fill="#EF4444" />
        </g>
      );

    case 'cap':
      return (
        <g>
          <path d="M26 35 C27 18, 73 18, 74 35 Z" fill="#EF4444" stroke="#991B1B" strokeWidth="1.8" />
          <path d="M24 35 L79 35 C78 39, 64 40, 50 38 C36 37, 25 38, 24 35 Z" fill="#DC2626" stroke="#991B1B" strokeWidth="1.5" />
          <circle cx="50" cy="27" r="3" fill="#FFFFFF" />
        </g>
      );

    case 'bow':
      return (
        <g transform="translate(65, 22)">
          <polygon points="0,7 -10,1 -10,13" fill="#EC4899" stroke="#9D174D" strokeWidth="1.4" strokeLinejoin="round" />
          <polygon points="0,7 10,1 10,13" fill="#EC4899" stroke="#9D174D" strokeWidth="1.4" strokeLinejoin="round" />
          <circle cx="0" cy="7" r="3.4" fill="#F472B6" stroke="#9D174D" strokeWidth="1.2" />
        </g>
      );

    case 'star':
      return (
        <g transform="translate(74, 24)">
          <polygon
            points="0,-10 2.9,-3.2 10,-2.8 4.5,2 6.2,9.2 0,5.2 -6.2,9.2 -4.5,2 -10,-2.8 -2.9,-3.2"
            fill="#FACC15"
            stroke="#B45309"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </g>
      );

    case 'earring':
      return (
        <g>
          <circle cx="24" cy="60" r="4.2" fill="none" stroke="#FACC15" strokeWidth="2.4" />
          <circle cx="24" cy="56" r="1.8" fill="#F59E0B" />
        </g>
      );
  }
}

export function VectorAvatar({ avatar, size = 44, className = '', title }: VectorAvatarProps) {
  const uid = useId();
  const safeAvatar: AvatarConfig = avatar ?? DEFAULT_AVATAR;
  const clipId = `avatar-clip-${uid}`;
  const gradId = `avatar-grad-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`shrink-0 select-none overflow-hidden rounded-full ${className}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <clipPath id={clipId}>
          <circle cx="50" cy="50" r="48" />
        </clipPath>
        <radialGradient id={gradId} cx="32%" cy="28%" r="72%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.14" />
        </radialGradient>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        <circle cx="50" cy="50" r="50" fill={safeAvatar.bg || DEFAULT_AVATAR.bg} />
        <circle cx="50" cy="50" r="50" fill={`url(#${gradId})`} />
        {renderPreset(safeAvatar.preset, safeAvatar.color || DEFAULT_AVATAR.color)}
        {renderAccessory(safeAvatar.accessory)}
      </g>

      <circle
        cx="50"
        cy="50"
        r="48.5"
        fill="none"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="2"
      />
    </svg>
  );
}

interface RoleBadgeProps {
  role: Role;
  size?: 'sm' | 'md';
  className?: string;
}

export function RoleBadge({ role, size = 'sm', className = '' }: RoleBadgeProps) {
  const paddingClass = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';
  const styleClass =
    role === 'LEADER'
      ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300/70 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30'
      : role === 'SUBLEADER'
        ? 'bg-indigo-100 text-indigo-800 ring-1 ring-indigo-300/70 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-400/30'
        : 'bg-sky-100 text-sky-800 ring-1 ring-sky-300/60 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/30';
  const label = role === 'LEADER' ? 'Líder' : role === 'SUBLEADER' ? 'Sublíder' : 'Integrante';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold tracking-wide ${paddingClass} ${styleClass} ${className}`}
    >
      {role === 'LEADER' ? (
        <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
          <path
            d="M3 18h18l-1.5-9-4.5 4-3-6-3 6-4.5-4L3 18zm1 2h16v2H4v-2z"
            fill="#F59E0B"
          />
        </svg>
      ) : role === 'SUBLEADER' ? (
        <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
          <path
            d="M12 2.5l2.8 5.7 6.3.9-4.5 4.4 1.1 6.2L12 16.8l-5.7 2.9 1.1-6.2L2.9 9.1l6.3-.9L12 2.5z"
            fill="currentColor"
          />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
          <circle cx="12" cy="8" r="4" fill="currentColor" opacity="0.85" />
          <path d="M5 19c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" fill="currentColor" opacity="0.7" />
        </svg>
      )}
      {label}
    </span>
  );
}
