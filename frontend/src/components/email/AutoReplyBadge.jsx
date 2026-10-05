import { Bot } from "lucide-react";

import { AUTO_REPLY_STATUS } from "@/constants/mailCategories";
import { cn } from "@/utils/cn";

const BADGE = {
  [AUTO_REPLY_STATUS.SUGGESTED]: { label: "Auto reply ready", tone: "bg-status-purple-bg text-status-purple-fg" },
  [AUTO_REPLY_STATUS.APPROVING]: { label: "Sending reply", tone: "bg-status-blue-bg text-status-blue-fg" },
  [AUTO_REPLY_STATUS.FAILED]: { label: "Reply not sent", tone: "bg-status-red-bg text-status-red-fg" },
  [AUTO_REPLY_STATUS.SENT]: { label: "Auto reply sent", tone: "bg-status-green-bg text-status-green-fg" },
};

/** Whether a mail has an automatic reply waiting, going out, failed or sent; nothing otherwise. */
export function AutoReplyBadge({ autoReply, className }) {
  const badge = BADGE[autoReply?.status];
  if (!badge) return null;

  const match = typeof autoReply.confidence === "number" ? ` (${Math.round(autoReply.confidence * 100)}% match)` : "";
  return (
    <span
      title={autoReply.topic ? `${autoReply.topic}${match}` : undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold",
        badge.tone,
        className,
      )}
    >
      <Bot className="h-3 w-3" aria-hidden="true" />
      {badge.label}
    </span>
  );
}
