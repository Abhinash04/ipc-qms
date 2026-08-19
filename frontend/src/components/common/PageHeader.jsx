const formatDate = () => {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(new Date());
};

export function PageHeader({ title, purpose, actions, showDate = true }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {showDate && (
          <div className="mb-[5px] text-[11px] font-semibold text-[#6366f1] tracking-[0.09em] uppercase">
            {formatDate()}
          </div>
        )}
        <h1 className="font-heading text-[24px] font-bold text-[#0f172a] tracking-[-0.025em] m-0">
          {title}
        </h1>
        {purpose && (
          <p className="mt-1 text-[13px] font-normal text-[#94a3b8]">
            {purpose}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
