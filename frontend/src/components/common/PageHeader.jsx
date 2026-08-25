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
      className={`emoji-animated ${animClass} inline-flex items-center shrink-0 text-[26px] sm:text-[34px] leading-none select-none`}
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
  iconClassName = "bg-blue-50 text-blue-600 border-blue-100/60",
}) {
  const greetingData = extractEmoji(greeting);
  const titleData = extractEmoji(title);
  const activeEmoji = titleData.emoji || greetingData.emoji;

  return (
    <div className="glass-panel aurora-panel bento-card mb-6 flex flex-col gap-5 rounded-[30px] px-6 py-6 sm:flex-row sm:items-center sm:justify-between lg:px-7 lg:py-7">
      <div className="relative z-10 flex items-center gap-4">
        {Icon && (
          <div
            className={`flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl border shadow-2xs ${iconClassName}`}
          >
            <Icon className="h-6.5 w-6.5" strokeWidth={2} />
          </div>
        )}
        <div>
          {greetingData.text && (
            <div className="mb-1 text-[13.5px] font-bold text-slate-500 tracking-wide">
              {greetingData.text}
            </div>
          )}
          <h1 className="m-0 font-heading text-[32px] sm:text-[44px] font-black tracking-tight leading-none drop-shadow-2xs flex items-center gap-2.5 flex-wrap">
            {renderBalancedAnimatedEmoji(activeEmoji)}
            <span className="bg-[linear-gradient(135deg,#0f172a_10%,#173B9C_55%,#1d4ed8_100%)] bg-clip-text text-transparent">
              {titleData.text}
            </span>
          </h1>
          {purpose && (
            <p className="mt-2 text-[14px] font-medium text-slate-500">
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
