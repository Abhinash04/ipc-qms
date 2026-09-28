export function PageBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-dot-grid opacity-90 dark:opacity-90" />
      <div className="page-blob-a absolute -top-40 -end-32 h-[34rem] w-[34rem] rounded-full bg-primary/20 blur-3xl dark:bg-primary/14" />
      <div className="page-blob-b absolute -bottom-48 -start-40 h-[30rem] w-[30rem] rounded-full bg-info/16 blur-3xl dark:bg-info/10" />
      <div className="page-blob-a absolute top-1/3 start-1/3 h-72 w-72 rounded-full bg-violet-400/10 blur-3xl dark:bg-violet-500/8" />
      <div className="page-blob-b absolute top-1/2 -end-24 h-80 w-80 rounded-full bg-primary-300/20 blur-3xl dark:bg-primary/10" />
    </div>
  );
}
