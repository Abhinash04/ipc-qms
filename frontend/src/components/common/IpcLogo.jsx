export function AshokaEmblem({ className = "w-10 h-14" }) {
  return (
    <img
      src="/imageFile1.png"
      alt="State Emblem of India & IPC Logo"
      className={`object-contain ${className}`}
    />
  );
}

export function IpcInsignia({ className = "h-6 w-auto" }) {
  return (
    <img
      src="/imageFile1.png"
      alt="IPC Insignia"
      className={`object-contain ${className}`}
    />
  );
}

export function IpcLogo({ className = '', variant = 'light', showText = true }) {
  const isDark = variant === 'dark';

  return (
    <div className={`flex items-center gap-3.5 select-none ${className}`}>
      <img
        src="/imageFile1.png"
        alt="IPC Emblem Logo"
        className="h-12 w-auto sm:h-14 lg:h-16 object-contain shrink-0"
      />

      {showText && (
        <div className="flex flex-col justify-center leading-tight flex-1 min-w-0">
          <div className={`font-bold tracking-tight text-[10px] sm:text-[12px] lg:text-[14px] ${isDark ? 'text-slate-100' : 'text-slate-900'} break-words whitespace-normal`}>
            भारतीय भेषज संहिता आयोग
          </div>
          <div className={`font-black tracking-tight uppercase text-[10px] sm:text-[12px] lg:text-[14px] ${isDark ? 'text-amber-500' : 'text-slate-900'} break-words whitespace-normal`}>
            INDIAN PHARMACOPOEIA COMMISSION
          </div>
          <div className={`font-medium text-[8px] sm:text-[9px] lg:text-[10.5px] ${isDark ? 'text-slate-300' : 'text-slate-700'} break-words whitespace-normal`}>
            स्वास्थ्य एवं परिवार कल्याण मंत्रालय, भारत सरकार
          </div>
          <div className={`font-bold tracking-wider uppercase text-[8px] sm:text-[9px] lg:text-[10.5px] ${isDark ? 'text-slate-300/90' : 'text-slate-800'} break-words whitespace-normal`}>
            MINISTRY OF HEALTH & FAMILY WELFARE, GOVERNMENT OF INDIA
          </div>
        </div>
      )}
    </div>
  );
}
