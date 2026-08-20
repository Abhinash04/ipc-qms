/**
 * State Emblem of India (Ashoka Lions Capital) + Satyameva Jayate SVG Component
 */
export function AshokaEmblem({ className = "w-10 h-14" }) {
  return (
    <svg viewBox="0 0 160 210" className={className} xmlns="http://www.w3.org/2000/svg" aria-label="State Emblem of India">
      <defs>
        <linearGradient id="ashokaGold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="50%" stopColor="#d97706" />
          <stop offset="100%" stopColor="#92400e" />
        </linearGradient>
        <linearGradient id="ashokaGoldLight" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>

      {/* Ashoka Capital Lions Group */}
      <g fill="url(#ashokaGold)">
        {/* Left Lion Profile */}
        <path d="M 42 35 C 38 25, 30 25, 26 35 C 22 45, 25 58, 28 65 C 20 70, 16 82, 22 95 C 28 105, 42 110, 48 102 C 45 92, 44 80, 42 70 C 40 60, 42 45, 42 35 Z" />
        <path d="M 22 68 C 16 70, 12 78, 15 85 C 18 90, 24 90, 26 82 Z" />

        {/* Right Lion Profile */}
        <path d="M 118 35 C 122 25, 130 25, 134 35 C 138 45, 135 58, 132 65 C 140 70, 144 82, 138 95 C 132 105, 118 110, 112 102 C 115 92, 116 80, 118 70 C 120 60, 118 45, 118 35 Z" />
        <path d="M 138 68 C 144 70, 148 78, 145 85 C 142 90, 136 90, 134 82 Z" />

        {/* Center Lion Front Head */}
        <path d="M 80 18 C 65 18, 56 32, 54 48 C 52 60, 56 75, 54 88 C 58 102, 70 110, 80 110 C 90 110, 102 102, 106 88 C 104 75, 108 60, 106 48 C 104 32, 95 18, 80 18 Z" />

        {/* Crown/Mane details center lion */}
        <circle cx="80" cy="30" r="5" fill="url(#ashokaGoldLight)" />
        <path d="M 72 38 C 76 34, 84 34, 88 38 C 85 45, 75 45, 72 38 Z" fill="url(#ashokaGoldLight)" />
        <ellipse cx="80" cy="52" rx="7" ry="5" fill="#78350f" />
        <path d="M 74 48 Q 80 44 86 48" stroke="#78350f" strokeWidth="2.5" fill="none" />

        {/* Mouth and chin */}
        <path d="M 70 65 Q 80 72 90 65 Q 80 82 70 65" fill="#92400e" />
        <path d="M 75 80 Q 80 88 85 80" fill="url(#ashokaGoldLight)" />

        {/* Abacus Platform / Band */}
        <rect x="25" y="108" width="110" height="22" rx="3" fill="url(#ashokaGold)" />
        <rect x="23" y="106" width="114" height="4" rx="2" fill="url(#ashokaGoldLight)" />
        <rect x="23" y="128" width="114" height="4" rx="2" fill="url(#ashokaGoldLight)" />

        {/* Ashoka Chakra in Abacus Center */}
        <circle cx="80" cy="119" r="9" fill="none" stroke="#78350f" strokeWidth="2" />
        <circle cx="80" cy="119" r="2" fill="#78350f" />
        {[0, 30, 60, 90, 120, 150].map((deg) => (
          <line
            key={deg}
            x1={80 + 8 * Math.cos((deg * Math.PI) / 180)}
            y1={119 + 8 * Math.sin((deg * Math.PI) / 180)}
            x2={80 - 8 * Math.cos((deg * Math.PI) / 180)}
            y2={119 - 8 * Math.sin((deg * Math.PI) / 180)}
            stroke="#78350f"
            strokeWidth="1.2"
          />
        ))}

        {/* Bull & Horse accents */}
        <path d="M 40 119 C 37 114, 45 112, 48 116 C 50 120, 42 124, 40 119 Z" fill="#78350f" />
        <path d="M 120 119 C 117 114, 125 112, 128 116 C 130 120, 122 124, 120 119 Z" fill="#78350f" />

        {/* Inverted Lotus Base */}
        <path d="M 30 132 Q 80 155 130 132 L 122 154 Q 80 168 38 154 Z" fill="url(#ashokaGold)" />
        <path d="M 40 135 C 50 148, 70 154, 80 154 C 90 154, 110 148, 120 135" fill="none" stroke="url(#ashokaGoldLight)" strokeWidth="2" />

        {/* Base Pedestal */}
        <rect x="45" y="156" width="70" height="8" rx="2" fill="url(#ashokaGold)" />
      </g>

      {/* Satyameva Jayate Text */}
      <text
        x="80"
        y="182"
        textAnchor="middle"
        fontSize="13"
        fontWeight="bold"
        fontFamily="sans-serif"
        fill="#78350f"
        letterSpacing="0.5"
      >
        सत्यमेव जयते
      </text>
    </svg>
  );
}

/**
 * 3D IPC Logo Insignia Component
 */
export function IpcInsignia({ className = "w-9 h-6" }) {
  return (
    <svg viewBox="0 0 120 65" className={className} xmlns="http://www.w3.org/2000/svg" aria-label="IPC Logo Insignia">
      <defs>
        <linearGradient id="ipcGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="45%" stopColor="#0284c7" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <filter id="ipcShadow" x="-10%" y="-10%" width="130%" height="130%">
          <feDropShadow dx="1" dy="2" stdDeviation="1.5" floodColor="#0f172a" floodOpacity="0.3" />
        </filter>
      </defs>

      <g filter="url(#ipcShadow)">
        {/* Background Oval Badge */}
        <rect x="4" y="4" width="112" height="56" rx="14" fill="#ffffff" stroke="#93c5fd" strokeWidth="2" />
        <rect x="7" y="7" width="106" height="50" rx="11" fill="none" stroke="#0284c7" strokeWidth="1" strokeDasharray="3 2" opacity="0.35" />

        {/* 3D IPC Text */}
        <text
          x="61"
          y="44"
          textAnchor="middle"
          fontSize="38"
          fontWeight="900"
          fontFamily="Impact, 'Arial Black', sans-serif"
          fill="#0c4a6e"
          letterSpacing="1"
        >
          IPC
        </text>
        <text
          x="60"
          y="42"
          textAnchor="middle"
          fontSize="38"
          fontWeight="900"
          fontFamily="Impact, 'Arial Black', sans-serif"
          fill="url(#ipcGradient)"
          stroke="#ffffff"
          strokeWidth="1.2"
          letterSpacing="1"
        >
          IPC
        </text>
      </g>
    </svg>
  );
}

/**
 * Main Full IPC Logo / Header Banner Component
 */
export function IpcLogo({
  variant = 'light', // 'light' | 'dark' | 'compact'
  showText = true,
  className = '',
  size = 'md', // 'sm' | 'md' | 'lg'
}) {
  const isDark = variant === 'dark';

  const sizeClasses = {
    sm: { emblem: 'w-7 h-10', insignia: 'w-7 h-5', title: 'text-[11px]', sub: 'text-[8.5px]' },
    md: { emblem: 'w-10 h-13', insignia: 'w-10 h-6', title: 'text-[13px] sm:text-[14px]', sub: 'text-[9.5px] sm:text-[10.5px]' },
    lg: { emblem: 'w-14 h-18', insignia: 'w-12 h-7.5', title: 'text-[16px] sm:text-[19px]', sub: 'text-[11.5px] sm:text-[12.5px]' },
  };

  const currentSize = sizeClasses[size] || sizeClasses.md;

  if (variant === 'compact') {
    return (
      <div className={`flex flex-col items-center justify-center select-none ${className}`}>
        <AshokaEmblem className={currentSize.emblem} />
        <IpcInsignia className={`${currentSize.insignia} -mt-0.5`} />
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      {/* Left Icon Emblem Stack */}
      <div className="flex flex-col items-center shrink-0">
        <AshokaEmblem className={currentSize.emblem} />
        <IpcInsignia className={`${currentSize.insignia} -mt-0.5`} />
      </div>

      {/* Right Official Government Text Block */}
      {showText && (
        <div className="flex flex-col justify-center leading-tight">
          {/* Line 1: Hindi Main Title */}
          <div
            className={`font-bold tracking-tight ${currentSize.title} ${isDark ? 'text-slate-100' : 'text-slate-900'
              }`}
          >
            भारतीय भेषज संहिता आयोग
          </div>

          {/* Line 2: English Main Title */}
          <div
            className={`font-black tracking-tight uppercase ${currentSize.title} ${isDark ? 'text-amber-300' : 'text-slate-900'
              }`}
          >
            INDIAN PHARMACOPOEIA COMMISSION
          </div>

          {/* Line 3: Hindi Subtitle */}
          <div
            className={`font-medium ${currentSize.sub} ${isDark ? 'text-slate-300' : 'text-slate-700'
              }`}
          >
            स्वास्थ्य एवं परिवार कल्याण मंत्रालय, भारत सरकार
          </div>

          {/* Line 4: English Subtitle */}
          <div
            className={`font-bold tracking-wider uppercase ${currentSize.sub} ${isDark ? 'text-slate-300/90' : 'text-slate-800'
              }`}
          >
            MINISTRY OF HEALTH & FAMILY WELFARE, GOVERNMENT OF INDIA
          </div>
        </div>
      )}
    </div>
  );
}
