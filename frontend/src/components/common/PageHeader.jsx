function extractEmoji(text) {
  if (typeof text !== "string") return { text, emoji: null };
  const regex = /(\p{Extended_Pictographic})/gu;
  const matches = text.match(regex);
  const emoji =
    matches && matches.length > 0 ? matches[matches.length - 1] : null;
  const cleanText = text.replace(regex, "").trim();
  return { text: cleanText, emoji };
}

function renderBalancedAnimatedEmoji(emoji) {
  if (!emoji) return null;

  let animClass = "emoji-float";
  if (emoji === "👋") animClass = "emoji-wave";
  else if (emoji === "📬" || emoji === "📫" || emoji === "✉️")
    animClass = "emoji-mailbox";
  else if (emoji === "📋" || emoji === "📂" || emoji === "❓" || emoji === "📜")
    animClass = "emoji-query";
  else if (emoji === "🚀") animClass = "emoji-rocket";
  else if (emoji === "🔔" || emoji === "🔕") animClass = "emoji-bell";
  else if (emoji === "☀️" || emoji === "🌞") animClass = "emoji-query";
  else if (emoji === "🌅" || emoji === "🌙" || emoji === "⭐")
    animClass = "emoji-float";
  else if (emoji === "✍️" || emoji === "📝") animClass = "emoji-query";

  return (
    <span
      className={`emoji-animated ${animClass} inline-flex shrink-0 items-center text-2xl leading-none select-none`}
    >
      {emoji}
    </span>
  );
}

export function PageHeader({
  greeting,
  title,
  purpose,
  actions,
  icon: Icon,
  iconClassName = "bg-primary-50 text-primary",
}) {
  const greetingData = extractEmoji(greeting);
  const titleData = extractEmoji(title);
  const activeEmoji = titleData.emoji || greetingData.emoji;

  return (
    <div className="relative mb-5 flex flex-col gap-3 overflow-hidden rounded-2xl border border-transparent bg-surface px-5 py-4 shadow-card sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
      <span aria-hidden="true" className="absolute inset-y-0 start-0 w-1 bg-primary" />
      <div className="flex items-center gap-3.5">
        {Icon && (
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconClassName}`}
          >
            <Icon className="h-5 w-5" strokeWidth={2.2} />
          </div>
        )}
        <div className="min-w-0">
          {greetingData.text && (
            <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wider text-primary">
              {greetingData.text}
            </div>
          )}
          <h1 className="m-0 flex flex-wrap items-center gap-2 font-heading text-[22px] font-bold leading-tight tracking-tight text-ink sm:text-[26px]">
            {renderBalancedAnimatedEmoji(activeEmoji)}
            <span>{titleData.text}</span>
          </h1>
          {purpose && (
            <p className="mt-1 text-[13px] leading-normal text-ink-muted">{purpose}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="relative flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
