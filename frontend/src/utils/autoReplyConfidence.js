import { AUTO_REPLY_STATUS } from "@/constants/mailCategories";

const AUTO = new Set([AUTO_REPLY_STATUS.SUGGESTED, AUTO_REPLY_STATUS.APPROVING, AUTO_REPLY_STATUS.FAILED, AUTO_REPLY_STATUS.SENT]);

const sentence = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : "");

/**
 * How sure the system is about a mail, and what it decided: { percent, decision, tone, ... }.
 * Null for a mail the auto-reply check never looks at (outside the NICeMail mailbox).
 */
export function confidenceOf(message) {
  const autoReply = message?.autoReply;
  if (!autoReply) {
    return message?.source === "nic-browser" ? { pending: true, decision: "Not checked yet", tone: "pending" } : null;
  }
  const auto = AUTO.has(autoReply.status);
  return {
    pending: false,
    percent: Math.round((autoReply.confidence ?? 0) * 100),
    threshold: typeof autoReply.threshold === "number" ? Math.round(autoReply.threshold * 100) : null,
    decision: auto ? "Auto Reply" : "Human Intervention",
    tone: auto ? "auto" : "human",
    question: autoReply.question || null,
    reason: sentence(autoReply.reason),
  };
}
