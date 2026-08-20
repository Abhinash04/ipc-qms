export function PageHeader({ greeting, title, purpose, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {greeting && (
          <div className="mb-1.5 text-[16px] font-semibold text-slate-600">
            {greeting}
          </div>
        )}
        <h1 className="font-heading text-[52px] sm:text-[60px] font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-slate-900 via-[#0f285d] to-blue-900 m-0 leading-none drop-shadow-2xs">
          {title}
        </h1>
        {purpose && (
          <p className="mt-2 text-[14.5px] font-medium text-slate-500">
            {purpose}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}




