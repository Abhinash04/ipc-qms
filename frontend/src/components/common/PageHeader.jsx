export function PageHeader({ greeting, title, purpose, actions }) {
  return (
    <div className="glass-panel aurora-panel bento-card mb-6 flex flex-col gap-5 rounded-[30px] px-6 py-6 sm:flex-row sm:items-center sm:justify-between lg:px-7 lg:py-7">
      <div className="relative z-10">
        {greeting && (
          <div className="mb-2 text-[15px] font-semibold text-slate-600">
            {greeting}
          </div>
        )}
        <h1 className="m-0 bg-[linear-gradient(135deg,#0f172a_10%,#173B9C_55%,#1d4ed8_100%)] bg-clip-text font-heading text-[48px] leading-none font-black tracking-tight text-transparent sm:text-[58px]">
          {title}
        </h1>
        {purpose && (
          <p className="mt-2 text-[14.5px] font-medium text-slate-500">
            {purpose}
          </p>
        )}
      </div>
      {actions && <div className="relative z-10 flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}




