import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bot, Loader2, Send, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AutoReplyBadge } from "@/components/email/AutoReplyBadge";
import { AUTO_REPLY_STATUS } from "@/constants/mailCategories";
import { approveAutoReply, declineAutoReply } from "@/services/api/mailboxService";
import { notify } from "@/services/notify";
import { formatFullDate, parseSender } from "@/utils/mailboxFormat";

const CARD = "bg-card rounded-2xl border border-status-purple-line/60 p-5 shadow-card";
const SHOWN = new Set([AUTO_REPLY_STATUS.SUGGESTED, AUTO_REPLY_STATUS.APPROVING, AUTO_REPLY_STATUS.FAILED, AUTO_REPLY_STATUS.SENT]);

const errorOf = (failure) => failure?.response?.data?.error || failure?.message || "Please try again.";

function SentReply({ autoReply, caseHref }) {
  return (
    <div className="space-y-3">
      <p className="m-0 text-[13px] font-semibold text-slate-700">
        Sent on {formatFullDate(autoReply.sentAt)}. The query case is closed.
      </p>
      <div className="whitespace-pre-wrap wrap-break-word rounded-xl bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-700">
        {autoReply.approvedBody}
      </div>
      {autoReply.queryId && caseHref && (
        <Link
          to={caseHref(autoReply.queryId)}
          className="inline-flex items-center gap-1.5 text-[13px] font-bold text-primary-700 hover:underline"
        >
          {autoReply.queryId}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/**
 * The automatic reply offered for a mail: the supported question it matched, and a draft the
 * Front Office can edit. Nothing is sent until the Front Office approves it here.
 */
export function AutoReplyPanel({ message, caseHref = null }) {
  const autoReply = message.autoReply;
  const textId = useId();
  const queryClient = useQueryClient();
  const recipient = parseSender(message.from).email || message.from;
  const [text, setText] = useState(autoReply?.approvedBody || autoReply?.draft || "");
  const [confirming, setConfirming] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["mailbox"] });

  const approve = useMutation({
    mutationFn: (body) => approveAutoReply(message.mailboxMessageId, body),
    onSuccess: (result) => {
      setConfirming(false);
      refresh();
      if (result.sent) notify.success("Reply sent", `Sent to ${recipient}. Query case ${result.queryId} is closed.`);
      else notify.error("The reply was not sent", result.error || "Please retry.");
    },
    onError: (failure) => {
      setConfirming(false);
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
  // Once the case exists the approved text is fixed; a retry sends that same reply.
  const fixed = Boolean(autoReply.queryId);
  const busy = approve.isPending || decline.isPending || status === AUTO_REPLY_STATUS.APPROVING;
  const body = fixed ? autoReply.approvedBody : text;
  const percent = Math.round((autoReply.confidence ?? 0) * 100);

  return (
    <section className={CARD} aria-labelledby={`${textId}-title`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
        <h2 id={`${textId}-title`} className="m-0 flex items-center gap-2 font-heading text-[17px] font-bold text-slate-900">
          <Bot className="h-5 w-5 text-status-purple-fg" aria-hidden="true" />
          Automatic reply
        </h2>
        <AutoReplyBadge autoReply={autoReply} />
      </div>

      <p className="mt-0 mb-3 text-[12.5px] font-medium text-slate-500">
        Matched the supported question “{autoReply.question}” ({percent}% match).
      </p>

      {status === AUTO_REPLY_STATUS.SENT ? (
        <SentReply autoReply={autoReply} caseHref={caseHref} />
      ) : (
        <div className="space-y-3">
          {status === AUTO_REPLY_STATUS.FAILED && (
            <p role="alert" className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] font-bold text-rose-700">
              The reply was not sent: {autoReply.error || "unknown error"}
            </p>
          )}

          <label htmlFor={textId} className="block text-[12px] font-bold text-slate-600">
            Reply to {recipient}
          </label>
          <Textarea
            id={textId}
            value={body}
            onChange={(event) => setText(event.target.value)}
            readOnly={fixed}
            disabled={busy}
            rows={8}
            className="text-[13px] leading-relaxed"
          />
          <p className="m-0 text-[11.5px] font-medium text-slate-400">
            {fixed
              ? "This reply was approved; retrying sends it as it is."
              : "Edit the reply as needed. The official IPC closing is added when it is sent."}
          </p>

          {confirming ? (
            <div role="group" aria-label="Confirm sending" className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
              <span className="text-[12.5px] font-semibold text-slate-700">Send this reply to {recipient}?</span>
              <Button size="sm" disabled={busy} onClick={() => approve.mutate(body)}>
                {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                Yes, send
              </Button>
              <Button size="sm" variant="outline" disabled={approve.isPending} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy || !body.trim()} onClick={() => setConfirming(true)}>
                <Send className="h-4 w-4" aria-hidden="true" />
                {status === AUTO_REPLY_STATUS.FAILED && fixed ? "Retry sending" : "Approve and send"}
              </Button>
              {!fixed && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => decline.mutate()}>
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                  Send to Human Intervention
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
