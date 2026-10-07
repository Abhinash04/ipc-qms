import { useId } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bot, Loader2, MessageSquareText, RotateCcw, Send, UserRound } from "lucide-react";

import { CaseCard } from "@/components/common/CaseCard";
import { Button } from "@/components/ui/button";
import { AutoReplyBadge } from "@/components/email/AutoReplyBadge";
import { AUTO_REPLY_STATUS } from "@/constants/mailCategories";
import { declineAutoReply, retryAutoReply } from "@/services/api/mailboxService";
import { notify } from "@/services/notify";
import { formatFullDate, parseSender } from "@/utils/mailboxFormat";

const SHOWN = new Set([AUTO_REPLY_STATUS.SUGGESTED, AUTO_REPLY_STATUS.APPROVING, AUTO_REPLY_STATUS.FAILED, AUTO_REPLY_STATUS.SENT]);

const errorOf = (failure) => failure?.response?.data?.error || failure?.message || "Please try again.";

/**
 * The automatic reply for a mail, read-only: the supported question it matched and the reply the
 * AI drafted from it. It is sent on its own when the Front Office accepts the mail, after the
 * acknowledgement; here the Front Office can only send the mail to Human Intervention instead,
 * or retry a reply that could not be sent.
 */
export function AutoReplyPanel({ message, caseHref = null }) {
  const autoReply = message.autoReply;
  const textId = useId();
  const queryClient = useQueryClient();
  const recipient = parseSender(message.from).email || message.from;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["mailbox"] });

  const retry = useMutation({
    mutationFn: () => retryAutoReply(message.mailboxMessageId),
    onSuccess: (result) => {
      refresh();
      if (result.sent) notify.success("Reply sent", `Sent to ${recipient}. Query case ${result.queryId} is closed.`);
      else notify.error("The reply was not sent", result.error || "Please retry.");
    },
    onError: (failure) => {
      refresh();
      notify.error("Could not send the reply", errorOf(failure));
    },
  });

  const decline = useMutation({
    mutationFn: () => declineAutoReply(message.mailboxMessageId),
    onSuccess: () => {
      refresh();
      notify.info("Moved to Human Intervention", "This mail now follows the standard workflow.");
    },
    onError: (failure) => notify.error("Could not move the mail", errorOf(failure)),
  });

  if (!SHOWN.has(autoReply?.status)) return null;

  const status = autoReply.status;
  const percent = Math.round((autoReply.confidence ?? 0) * 100);
  const busy = retry.isPending || decline.isPending || status === AUTO_REPLY_STATUS.APPROVING;

  const note = {
    [AUTO_REPLY_STATUS.SUGGESTED]: `Sent automatically to ${recipient} when you accept this mail, after the acknowledgement. It is not forwarded to the Officer-in-Charge.`,
    [AUTO_REPLY_STATUS.APPROVING]: `Sending to ${recipient}…`,
    [AUTO_REPLY_STATUS.FAILED]: null,
    [AUTO_REPLY_STATUS.SENT]: `Sent to ${recipient} on ${formatFullDate(autoReply.sentAt)}. The query case is closed.`,
  }[status];

  return (
    <CaseCard
      tone="ai"
      banner
      art={[MessageSquareText, Bot, Send]}
      icon={Bot}
      title="Automatic reply"
      badge={<AutoReplyBadge autoReply={autoReply} />}
    >
      <div className="space-y-3">
        <p className="m-0 text-[12.5px] font-medium text-slate-500">
          Matched the supported question “{autoReply.question}” ({percent}% match).
        </p>

        {status === AUTO_REPLY_STATUS.FAILED && (
          <p role="alert" className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] font-bold text-rose-700">
            The reply was not sent: {autoReply.error || "unknown error"}
          </p>
        )}
        {note && (
          <p className="m-0 flex items-center gap-1.5 text-[13px] font-semibold text-slate-700">
            {status === AUTO_REPLY_STATUS.APPROVING && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {note}
          </p>
        )}

        <h3 id={`${textId}-reply`} className="m-0 text-[12px] font-bold text-slate-600">
          Reply to {recipient}
        </h3>
        <div
          aria-labelledby={`${textId}-reply`}
          className="whitespace-pre-wrap wrap-break-word rounded-xl bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-700"
        >
          {autoReply.draft}
        </div>
        <p className="m-0 text-[11.5px] font-medium text-slate-400">The official IPC closing is added when it is sent.</p>

        {autoReply.queryId && caseHref && (
          <Link
            to={caseHref(autoReply.queryId)}
            className="inline-flex items-center gap-1.5 text-[13px] font-bold text-primary-700 hover:underline"
          >
            {autoReply.queryId}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}

        {status === AUTO_REPLY_STATUS.SUGGESTED && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => decline.mutate()}>
            <UserRound className="h-4 w-4" aria-hidden="true" />
            Send to Human Intervention
          </Button>
        )}
        {status === AUTO_REPLY_STATUS.FAILED && autoReply.queryId && (
          <Button size="sm" disabled={busy} onClick={() => retry.mutate()}>
            {retry.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
            Retry sending
          </Button>
        )}
      </div>
    </CaseCard>
  );
}
