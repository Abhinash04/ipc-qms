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
      className={`emoji-animated ${animClass} inline-flex items-center shrink-0 text-2xl sm:text-3xl leading-none select-none`}
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
  iconClassName = "bg-gradient-to-tr from-blue-600 to-indigo-600 text-white border-transparent shadow-blue-500/25",
}) {
  const greetingData = extractEmoji(greeting);
  const titleData = extractEmoji(title);
  const activeEmoji = titleData.emoji || greetingData.emoji;

  return (
    <div className="glass-panel aurora-panel bento-card mb-3.5 flex flex-col gap-2 rounded-2xl px-4 py-1.5 sm:flex-row sm:items-center sm:justify-between lg:px-5 lg:py-2 border border-blue-100/80 bg-[linear-gradient(135deg,#eff6ff_0%,#ffffff_50%,#f5f3ff_100%)] shadow-[0_2px_12px_rgba(37,99,235,0.05)] relative overflow-hidden">
      {/* Decorative gradient corner light */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-indigo-400/10 blur-2xl" />
      <div className="pointer-events-none absolute -left-10 -bottom-10 h-28 w-28 rounded-full bg-blue-400/10 blur-2xl" />

      <div className="relative z-10 flex items-center gap-3">
        {Icon && (
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-xs ${iconClassName}`}
          >
            <Icon className="h-4.5 w-4.5 text-white" strokeWidth={2.2} />
          </div>
        )}
        <div>
          {greetingData.text && (
            <div className="text-[10.5px] font-black text-blue-600 tracking-wider uppercase leading-none mb-1">
              {greetingData.text}
            </div>
          )}
          <h1 className="m-0 font-heading text-xl sm:text-2xl lg:text-[29px] font-black tracking-tight leading-snug flex items-center gap-1.5 flex-wrap">
            {renderBalancedAnimatedEmoji(activeEmoji)}
            <span className="bg-[linear-gradient(135deg,#1e3a8a_0%,#2563eb_45%,#4f46e5_100%)] bg-clip-text text-transparent inline-block pb-1.5 pt-0.5">
              {titleData.text}
            </span>
          </h1>
          {purpose && (
            <p className="mt-0.5 text-[11.5px] font-medium text-slate-500 leading-normal">
              {purpose}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="relative z-10 flex shrink-0 items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
