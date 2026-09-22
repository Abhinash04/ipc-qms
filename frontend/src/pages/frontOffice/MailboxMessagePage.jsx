import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, MailIcon } from "lucide-react";

import { Breadcrumb } from "@/components/common/Breadcrumb";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { AttachmentList } from "@/components/attachments/AttachmentList";
import { MailHtmlFrame } from "@/components/email/MailHtmlFrame";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { buildPath } from "@/constants/routePaths";
import {
  fetchMailboxMessage,
  markMailboxMessageRead,
  mailboxAttachmentUrl,
} from "@/services/api/mailboxService";
import { parseSender, formatFullDate } from "@/utils/mailboxFormat";
import { cn } from "@/utils/cn";

const CARD = "bg-white rounded-3xl border border-slate-200/80 p-5 shadow-sm";
const CARD_TITLE = "font-heading text-[17px] font-black text-slate-900 m-0";

const BODY_FORMATS = [
  { formatted: false, label: "Plain text" },
  { formatted: true, label: "Formatted" },
];

/** A message with no case yet: what became of it, and where to decide. */
const UNLINKED = {
  REJECTED: ["Rejected", "No case was created for this message."],
  ACCEPTED: ["Accepted", null],
};
const AWAITING = ["Awaiting validation", "Accept or reject it from the IPC Mailbox list."];

function BackToInbox({ paths }) {
  return (
    <Link
      to={paths.INBOX}
      className="inline-flex items-center gap-1.5 text-[13px] font-bold text-blue-700 hover:underline"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to IPC Mailbox
    </Link>
  );
}

function MessageSkeleton() {
  return (
    <div role="status" aria-label="Loading message" className="space-y-4">
      <Skeleton className="h-32 w-full rounded-3xl" />
      <Skeleton className="h-64 w-full rounded-3xl" />
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex gap-3">
      <dt className="w-12 shrink-0 pt-px text-[11.5px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </dt>
      <dd className="m-0 min-w-0 wrap-break-word text-[13px] font-semibold text-slate-800">
        {children}
      </dd>
    </div>
  );
}

function MessageHeader({ message }) {
  const heading = useRef(null);
  const sender = parseSender(message.from);

  // Focus starts at the message, not at the top of the page it replaced.
  useEffect(() => {
    heading.current?.focus();
  }, [message.mailboxMessageId]);

  return (
    <section className={CARD}>
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-[24px] font-black text-slate-900 leading-tight wrap-break-word focus:outline-none"
      >
        {message.subject || "(No Subject)"}
      </h1>
      <dl className="mt-4 mb-0 space-y-1.5">
        <Field label="From">
          {sender.name}
          {sender.email && (
            <span className="font-medium text-slate-500"> &lt;{sender.email}&gt;</span>
          )}
        </Field>
        {[
          ["To", message.toAddresses],
          ["CC", message.cc],
          ["BCC", message.bcc],
        ].map(([label, addresses]) =>
          addresses?.length ? (
            <Field key={label} label={label}>
              {addresses.join(", ")}
            </Field>
          ) : null,
        )}
        <Field label="Date">
          <time dateTime={message.receivedAt ?? undefined}>
            {formatFullDate(message.receivedAt)}
          </time>
        </Field>
      </dl>
    </section>
  );
}

/**
 * Plain text by default. The HTML body, when the mail had one, is offered as
 * "Formatted" and only ever rendered inside the sandboxed frame.
 */
function MessageBody({ message }) {
  const [formatted, setFormatted] = useState(false);

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-2.5 mb-4">
        <h2 className={CARD_TITLE}>Message</h2>
        {message.bodyHtml && (
          <div role="group" aria-label="Body format" className="flex bg-slate-100/80 p-1 rounded-xl">
            {BODY_FORMATS.map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={formatted === option.formatted}
                onClick={() => setFormatted(option.formatted)}
                className={cn(
                  "px-3 py-1.5 text-[12px] font-bold rounded-lg transition-colors cursor-pointer",
                  formatted === option.formatted
                    ? "bg-white text-slate-800 shadow-sm"
                    : "text-slate-500 hover:text-slate-700",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {formatted ? (
        <>
          <MailHtmlFrame html={message.bodyHtml} />
          <p className="mt-2 mb-0 text-[12px] font-medium text-slate-400">
            Links and remote images are disabled in this view.
          </p>
        </>
      ) : (
        <div className="whitespace-pre-wrap wrap-break-word text-[13.5px] leading-relaxed text-slate-700">
          {message.body || "(No text)"}
        </div>
      )}
    </section>
  );
}

/** Where the message stands. Accepting and rejecting stay on the inbox list. */
function MessageCaseCard({ message, paths }) {
  const linked = message.linkedCase;
  const [state, hint] = UNLINKED[message.status] || AWAITING;

  return (
    <section className={CARD}>
      <h2 className={`${CARD_TITLE} border-b border-slate-100 pb-2.5 mb-3`}>Query case</h2>
      {linked ? (
        <div className="space-y-3">
          <Link
            to={buildPath(paths.QUERY_DETAIL, { queryId: linked.queryId })}
            className="inline-flex items-center gap-1.5 rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-4 py-2 text-[12px] font-black shadow-sm"
          >
            <span>{linked.queryId}</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <div className="flex flex-wrap gap-2">
            <StatusBadge type="workflow" value={linked.workflowState} />
            <StatusBadge type="business" value={linked.businessStatus} />
          </div>
        </div>
      ) : (
        <>
          <p className="m-0 text-[13.5px] font-extrabold text-slate-800">{state}</p>
          {hint && <p className="mt-1 mb-0 text-[12.5px] font-medium text-slate-500">{hint}</p>}
        </>
      )}
    </section>
  );
}

function MessageView({ message, paths }) {
  const attachments = message.attachments || [];

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        <MessageHeader message={message} />
        {/* Keyed so the Formatted choice never carries over to the next message. */}
        <MessageBody key={message.mailboxMessageId} message={message} />
        {attachments.length > 0 && (
          <section className={CARD}>
            <h2 className={`${CARD_TITLE} mb-3`}>Attachments ({attachments.length})</h2>
            <AttachmentList
              attachments={attachments}
              urlFor={(attachmentId) =>
                mailboxAttachmentUrl(message.mailboxMessageId, attachmentId)
              }
            />
          </section>
        )}
      </div>

      <div className="lg:sticky lg:top-6 self-start">
        <MessageCaseCard message={message} paths={paths} />
      </div>
    </div>
  );
}

export function MailboxMessagePage() {
  const { messageId } = useParams();
  const paths = useRoutePaths();
  const queryClient = useQueryClient();

  const message = useQuery({
    queryKey: ["mailbox", "message", messageId],
    queryFn: () => fetchMailboxMessage(messageId),
    retry: false,
  });

  // A failure is left silent: the message simply stays marked unread.
  const { mutate: markRead } = useMutation({
    mutationFn: (id) => markMailboxMessageRead(id),
    onSuccess: (_view, id) => {
      queryClient.setQueryData(["mailbox", "message", id], (current) =>
        current ? { ...current, isRead: true } : current,
      );
      queryClient.invalidateQueries({ queryKey: ["mailbox", "list"] });
    },
  });

  /**
   * Opening a message marks it read in QMS, once. The ref stops a refetch —
   * or StrictMode running effects twice — from asking again. `isRead: null` is
   * a mailbox that keeps no read state, and it is never asked.
   */
  const marked = useRef(null);
  const unread = message.data?.isRead === false;
  useEffect(() => {
    if (!unread || marked.current === messageId) return;
    marked.current = messageId;
    markRead(messageId);
  }, [unread, messageId, markRead]);

  let content;
  if (message.isPending) {
    content = <MessageSkeleton />;
  } else if (message.isError && message.error?.response?.status !== 404) {
    content = (
      <div className="space-y-3">
        <p
          role="alert"
          className="m-0 rounded-2xl border border-rose-200 bg-rose-50/90 px-4 py-3 text-[13px] font-bold text-rose-700"
        >
          Could not open this message.{" "}
          {message.error?.response?.data?.error || message.error?.message}
        </p>
        <BackToInbox paths={paths} />
      </div>
    );
  } else if (!message.data) {
    content = (
      <EmptyState
        icon={MailIcon}
        title="Message not found"
        description="It may have been deleted, or it is not in your mailbox."
        action={<BackToInbox paths={paths} />}
      />
    );
  } else {
    content = (
      <div className="space-y-4">
        <BackToInbox paths={paths} />
        <MessageView message={message.data} paths={paths} />
      </div>
    );
  }

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Dashboard", path: paths.DASHBOARD },
          { label: "IPC Mailbox", path: paths.INBOX },
          { label: message.data?.subject || "Message" },
        ]}
      />
      {content}
    </div>
  );
}
