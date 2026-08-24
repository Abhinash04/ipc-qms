import { cn } from '@/utils/cn';

export function StatTile({
  label,
  value,
  icon: Icon,
  cardBg,
  cardBorder,
  numColor,
  trendText,
  trendType,
  subtextMain,
  caption,
  subtextColor,
  illustrationType,
  className
}) {
  const blobColors = {
    assigned: '#3b82f6',
    drafting: '#f59e0b',
    review: '#f43f5e',
    closed: '#10b981',
  };

  const badgeGradients = {
    assigned: 'bg-[linear-gradient(135deg,#3478F6,#173B9C)] shadow-[0_12px_20px_rgba(52,120,246,0.28)]',
    drafting: 'bg-[linear-gradient(135deg,#F59E0B,#EA580C)] shadow-[0_12px_20px_rgba(245,158,11,0.26)]',
    review: 'bg-[linear-gradient(135deg,#FB7185,#E11D48)] shadow-[0_12px_20px_rgba(244,63,94,0.24)]',
    closed: 'bg-[linear-gradient(135deg,#34D399,#059669)] shadow-[0_12px_20px_rgba(16,185,129,0.24)]',
  };

  const currentBadgeGrad = badgeGradients[illustrationType] || badgeGradients.assigned;
  const currentBlobColor = blobColors[illustrationType] || blobColors.assigned;

  return (
    <div
      className={cn(
        "glass-panel aurora-panel bento-card group relative cursor-pointer select-none overflow-hidden rounded-[28px] p-5 sm:p-6 transition-all duration-300 hover:-translate-y-1",
        className
      )}
      style={{ borderColor: cardBorder || 'rgba(255,255,255,0.9)' }}
    >
      <div
        className="animate-blob absolute -right-8 top-0 h-36 w-36 rounded-full opacity-45 blur-2xl pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${currentBlobColor} 0%, rgba(255,255,255,0) 72%)`,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background: cardBg || 'linear-gradient(180deg, rgba(255,255,255,0.85) 0%, rgba(247,250,255,0.78) 100%)',
        }}
      />
      <div className="pointer-events-none absolute inset-x-6 top-0 h-14 rounded-b-[40px] bg-[linear-gradient(180deg,rgba(255,255,255,0.5),rgba(255,255,255,0))]" />

      <div className="relative z-10 flex h-full w-full flex-col justify-between">
      <div className="flex items-start justify-between gap-3 z-10">
        <div className="flex items-center gap-3.5">
          {Icon && (
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] text-white transition-transform duration-300 group-hover:scale-105 border border-white/20",
                currentBadgeGrad
              )}
            >
              <Icon className="h-5.5 w-5.5 text-white" strokeWidth={2.4} />
            </div>
          )}
          <div>
            <h3 className="font-heading text-[15px] font-black text-slate-800 m-0 leading-tight">
              {label}
            </h3>
            {caption && (
              <p className="text-[11.5px] font-semibold text-slate-400 m-0 mt-0.5">
                {caption}
              </p>
            )}
          </div>
        </div>

        {trendText && (
          <span
            className={cn(
              "glass-pill inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-[11.5px] font-extrabold",
              trendType === 'down'
                ? "text-rose-600"
                : "text-emerald-600"
            )}
          >
            {trendText}
          </span>
        )}
      </div>

      <div className="flex items-end justify-between mt-6 z-10">
        <div className="flex flex-col justify-end">
          <div
            className="font-heading text-[50px] sm:text-[54px] font-black leading-none tracking-tight"
            style={{ color: numColor || '#1e293b' }}
          >
            {value}
          </div>

          <div className="mt-2.5 space-y-0.5">
            <div className={cn("text-[12px] font-black flex items-center gap-1", subtextColor || "text-slate-600")}>
              {subtextMain}
            </div>

          </div>
        </div>

        <div className="flex h-21 w-21 shrink-0 items-center justify-center -mr-1 -mb-1 pointer-events-none transition-transform duration-300 group-hover:scale-105">
          {illustrationType === 'assigned' && (
            <svg width="82" height="82" viewBox="0 0 100 100" fill="none">
              <defs>
                <linearGradient id="blueCardGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="100%" stopColor="#eff6ff" />
                </linearGradient>
                <linearGradient id="blueBadgeGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#1d4ed8" />
                </linearGradient>
                <filter id="shadow3d" x="-20%" y="-20%" width="150%" height="150%">
                  <feDropShadow dx="2" dy="5" stdDeviation="5" floodColor="#1e3a8a" floodOpacity="0.18" />
                </filter>
              </defs>
              <g filter="url(#shadow3d)">
                <rect x="20" y="24" width="46" height="54" rx="10" fill="url(#blueCardGrad)" stroke="#bfdbfe" strokeWidth="1.5" transform="rotate(-6 43 51)" />
                <rect x="28" y="36" width="28" height="5" rx="2.5" fill="#93c5fd" transform="rotate(-6 42 38.5)" />
                <circle cx="33" cy="48" r="3" fill="#3b82f6" transform="rotate(-6 33 48)" />
                <rect x="40" y="47" width="16" height="4" rx="2" fill="#bfdbfe" transform="rotate(-6 48 49)" />
                <circle cx="32" cy="58" r="3" fill="#3b82f6" transform="rotate(-6 32 58)" />
                <rect x="39" y="57" width="14" height="4" rx="2" fill="#bfdbfe" transform="rotate(-6 46 59)" />
                <circle cx="68" cy="64" r="16" fill="url(#blueBadgeGrad)" stroke="#ffffff" strokeWidth="2.5" />
                <path d="M60 64L66 70L76 59" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            </svg>
          )}

          {illustrationType === 'drafting' && (
            <svg width="82" height="82" viewBox="0 0 100 100" fill="none">
              <defs>
                <linearGradient id="trayGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fbbf24" />
                  <stop offset="100%" stopColor="#d97706" />
                </linearGradient>
                <linearGradient id="pencilGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#b45309" />
                </linearGradient>
                <filter id="shadow3dYellow" x="-20%" y="-20%" width="150%" height="150%">
                  <feDropShadow dx="2" dy="5" stdDeviation="5" floodColor="#78350f" floodOpacity="0.18" />
                </filter>
              </defs>
              <g filter="url(#shadow3dYellow)">
                <rect x="18" y="44" width="56" height="34" rx="10" fill="url(#trayGrad)" />
                <rect x="22" y="50" width="48" height="24" rx="6" fill="#b45309" opacity="0.35" />
                <rect x="24" y="24" width="42" height="48" rx="8" fill="#ffffff" stroke="#fde68a" strokeWidth="1.5" />
                <rect x="30" y="32" width="24" height="4" rx="2" fill="#93c5fd" />
                <rect x="30" y="40" width="28" height="4" rx="2" fill="#e0f2fe" />
                <rect x="30" y="48" width="18" height="4" rx="2" fill="#e0f2fe" />
                <g transform="translate(48, 22) rotate(35)">
                  <rect x="0" y="0" width="10" height="36" rx="4" fill="url(#pencilGrad)" stroke="#ffffff" strokeWidth="1.5" />
                  <path d="M0 36L5 45L10 36H0Z" fill="#78350f" />
                  <path d="M3 41.4L5 45L7 41.4H3Z" fill="#1e293b" />
                  <rect x="0" y="0" width="10" height="8" fill="#f43f5e" />
                  <rect x="0" y="7" width="10" height="3" fill="#cbd5e1" />
                </g>
              </g>
            </svg>
          )}

          {illustrationType === 'review' && (
            <svg width="82" height="82" viewBox="0 0 100 100" fill="none">
              <defs>
                <linearGradient id="clipGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f43f5e" />
                  <stop offset="100%" stopColor="#be123c" />
                </linearGradient>
                <linearGradient id="clockGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#fb7185" />
                  <stop offset="100%" stopColor="#e11d48" />
                </linearGradient>
                <filter id="shadow3dPink" x="-20%" y="-20%" width="150%" height="150%">
                  <feDropShadow dx="2" dy="5" stdDeviation="5" floodColor="#881337" floodOpacity="0.18" />
                </filter>
              </defs>
              <g filter="url(#shadow3dPink)">
                <rect x="22" y="24" width="46" height="56" rx="10" fill="url(#clipGrad)" />
                <rect x="35" y="18" width="20" height="10" rx="4" fill="#cbd5e1" stroke="#ffffff" strokeWidth="1.5" />
                <rect x="39" y="21" width="12" height="4" rx="2" fill="#94a3b8" />
                <rect x="26" y="30" width="38" height="44" rx="6" fill="#ffffff" />
                <circle cx="32" cy="40" r="2.5" fill="#f43f5e" />
                <rect x="38" y="38" width="18" height="4" rx="2" fill="#fecdd3" />
                <circle cx="32" cy="49" r="2.5" fill="#f43f5e" />
                <rect x="38" y="47" width="14" height="4" rx="2" fill="#fecdd3" />
                <circle cx="32" cy="58" r="2.5" fill="#f43f5e" />
                <rect x="38" y="56" width="16" height="4" rx="2" fill="#fecdd3" />
                <circle cx="68" cy="64" r="16" fill="url(#clockGrad)" stroke="#ffffff" strokeWidth="2.5" />
                <path d="M68 56V64L73 67" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            </svg>
          )}

          {illustrationType === 'closed' && (
            <svg width="82" height="82" viewBox="0 0 100 100" fill="none">
              <defs>
                <linearGradient id="pedestalGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" />
                  <stop offset="100%" stopColor="#059669" />
                </linearGradient>
                <linearGradient id="shieldGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="100%" stopColor="#d1fae5" />
                </linearGradient>
                <linearGradient id="checkGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#047857" />
                </linearGradient>
                <filter id="shadow3dGreen" x="-20%" y="-20%" width="150%" height="150%">
                  <feDropShadow dx="2" dy="5" stdDeviation="5" floodColor="#064e3b" floodOpacity="0.18" />
                </filter>
              </defs>
              <g filter="url(#shadow3dGreen)">
                <ellipse cx="50" cy="74" rx="28" ry="10" fill="#047857" />
                <ellipse cx="50" cy="70" rx="28" ry="10" fill="url(#pedestalGrad)" />
                <ellipse cx="50" cy="68" rx="24" ry="7" fill="#6ee7b7" opacity="0.6" />
                <path
                  d="M50 20C50 20 68 24 68 40C68 56 50 66 50 66C50 66 32 56 32 40C32 24 50 20 50 20Z"
                  fill="url(#shieldGrad)"
                  stroke="#a7f3d0"
                  strokeWidth="2"
                />
                <path
                  d="M42 42L47.5 48L58 35"
                  stroke="url(#checkGrad)"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </svg>
          )}
        </div>
      </div>
    </div>
  </div>
);
}
