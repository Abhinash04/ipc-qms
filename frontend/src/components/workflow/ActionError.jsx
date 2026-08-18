export function ActionError({ message, onDismiss }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="mb-4 rounded-md border border-status-red-line bg-status-red-bg px-4 py-3 text-sm text-status-red-fg"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Action refused</p>
          <p className="mt-0.5">{message}</p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 text-xs font-medium underline underline-offset-2"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
