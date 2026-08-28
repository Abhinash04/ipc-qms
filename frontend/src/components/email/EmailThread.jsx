import { useMemo, useState } from "react";
import { MailIcon, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/EmptyState";
import {
  EMAIL_DIRECTION,
  EMAIL_TYPE_LABELS,
  describeDirection,
  sortThreadMessages,
} from "@/constants/emailModel";
import { cn } from "@/utils/cn";

export function EmailThread({ messages = [] }) {
  const [filter, setFilter] = useState("ALL");
  // Which earlier messages the reader has opened, plus whether the older block
  // has been revealed. The newest message is always expanded.
  const [expanded, setExpanded] = useState(() => new Set());
  const [showPrevious, setShowPrevious] = useState(false);

  const ordered = sortThreadMessages(messages);

  const filteredMessages = useMemo(
    () => ordered.filter((msg) => filter === "ALL" || msg.direction === filter),
    [ordered, filter],
  );

  const latest = filteredMessages[filteredMessages.length - 1] || null;
  const previous = filteredMessages.slice(0, -1);
  const visiblePrevious = showPrevious ? previous : [];

  const toggle = (messageId) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-sm">
      <div className="border-b border-slate-100 pb-3 mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-[19px] font-black text-slate-900 m-0">
            Email thread
          </h2>
          <p className="mt-0.5 text-[13px] font-medium text-slate-400">
            {filteredMessages.length}{" "}
            {filteredMessages.length === 1 ? "message" : "messages"} exchanged
            with the inquirer.
          </p>
        </div>

        <div className="flex bg-slate-100/80 p-1 rounded-xl shrink-0">
          <button
            type="button"
            onClick={() => setFilter("ALL")}
            className={cn(
              "px-3 py-1.5 text-[12px] font-bold rounded-lg transition-all cursor-pointer",
              filter === "ALL"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            All Emails
          </button>
          <button
            type="button"
            onClick={() => setFilter(EMAIL_DIRECTION.INBOUND)}
            className={cn(
              "px-3 py-1.5 text-[12px] font-bold rounded-lg transition-all cursor-pointer",
              filter === EMAIL_DIRECTION.INBOUND
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            Received Only
          </button>
          <button
            type="button"
            onClick={() => setFilter(EMAIL_DIRECTION.OUTBOUND)}
            className={cn(
              "px-3 py-1.5 text-[12px] font-bold rounded-lg transition-all cursor-pointer",
              filter === EMAIL_DIRECTION.OUTBOUND
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            Sent Only
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {filteredMessages.length === 0 ? (
          <EmptyState
            icon={MailIcon}
            title={
              filter === "ALL" ? "No email on this case" : "No emails found"
            }
            description={
              filter === "ALL"
                ? "A query normally starts from an email, so this is unexpected."
                : `There are no ${filter === EMAIL_DIRECTION.INBOUND ? "received" : "sent"} emails in this thread.`
            }
          />
        ) : (
          <>
            {previous.length > 0 && !showPrevious && (
              <button
                type="button"
                onClick={() => setShowPrevious(true)}
                className="w-full rounded-2xl border border-slate-200/70 bg-slate-50 hover:bg-slate-100 py-2 text-[12.5px] font-bold text-slate-500 transition-all cursor-pointer"
              >
                Show {previous.length} previous{" "}
                {previous.length === 1 ? "message" : "messages"}
              </button>
            )}

            {visiblePrevious.map((message) =>
              expanded.has(message.messageId) ? (
                <ThreadMessage
                  key={message.messageId}
                  message={message}
                  isFilteredView={filter !== "ALL"}
                  onCollapse={() => toggle(message.messageId)}
                />
              ) : (
                <CollapsedMessage
                  key={message.messageId}
                  message={message}
                  onExpand={() => toggle(message.messageId)}
                />
              ),
            )}

            {/* The newest message is what the reader almost always wants. */}
            {latest && (
              <ThreadMessage
                key={latest.messageId}
                message={latest}
                isFilteredView={filter !== "ALL"}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

const shortTime = (timestamp) =>
  new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

/** One line: who, what, when. Click to open the full message. */
function CollapsedMessage({ message, onExpand }) {
  const inbound = message.direction === EMAIL_DIRECTION.INBOUND;

  return (
    <button
      type="button"
      onClick={onExpand}
      aria-expanded={false}
      className="w-full flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white hover:bg-slate-50 hover:border-slate-300 px-4 py-2.5 text-left transition-all cursor-pointer"
    >
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          inbound ? "bg-slate-300" : "bg-blue-400",
        )}
      />
      <span className="text-[13px] font-extrabold text-slate-700 shrink-0 max-w-40 truncate">
        {message.from}
      </span>
      <span className="text-[13px] font-medium text-slate-400 truncate flex-1 min-w-0">
        {message.subject}
      </span>
      <span className="text-[11.5px] font-bold text-slate-400 shrink-0 hidden sm:inline">
        {shortTime(message.timestamp)}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
    </button>
  );
}

function ThreadMessage({ message, isFilteredView, onCollapse }) {
  const inbound = message.direction === EMAIL_DIRECTION.INBOUND;
  const alignLeft = inbound || isFilteredView;

  return (
    <div
      className={cn(
        "flex flex-col w-full",
        alignLeft ? "items-start" : "items-end",
      )}
    >
      <article
        className={cn(
          "w-full sm:w-[92%] rounded-3xl p-4 shadow-sm border",
          inbound
            ? "bg-white border-slate-200 rounded-tl-sm shadow-[4px_4px_10px_rgba(0,0,0,0.02)]"
            : "bg-blue-50 border-blue-100 shadow-[4px_4px_10px_rgba(59,130,246,0.05)]",
          !inbound && alignLeft
            ? "rounded-tl-sm"
            : !inbound
              ? "rounded-tr-sm"
              : "",
        )}
      >
        <div className="flex flex-wrap items-center gap-2 mb-3 pb-2.5 border-b border-slate-100/60">
          <Badge
            variant={inbound ? "status-slate" : "status-blue"}
            className="shadow-none text-[13px] px-3 py-1"
          >
            {describeDirection(message.direction)}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "text-[13px] px-3 py-1",
              inbound
                ? "border-slate-200 bg-slate-50"
                : "border-blue-200 text-blue-700 bg-white/50",
            )}
          >
            {EMAIL_TYPE_LABELS[message.emailType] || message.emailType}
          </Badge>
          <span
            className={cn(
              "ml-auto text-[12px] font-bold tracking-wide uppercase",
              inbound ? "text-slate-400" : "text-blue-400",
            )}
          >
            {shortTime(message.timestamp)}
          </span>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              aria-expanded
              aria-label="Collapse message"
              className="shrink-0 rounded-lg p-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Flat meta lines rather than a boxed panel nested inside the bubble. */}
        <div className="text-[13px] space-y-0.5 mb-3">
          <div className="flex gap-2 items-start">
            <span className="font-extrabold shrink-0 w-8 text-slate-400">
              From
            </span>
            <span className="break-all font-semibold text-slate-600">
              {message.from}
            </span>
          </div>
          <div className="flex gap-2 items-start">
            <span className="font-extrabold shrink-0 w-8 text-slate-400">To</span>
            <span className="break-all font-semibold text-slate-600">
              {message.to.join(", ")}
            </span>
          </div>
        </div>

        <h3 className="text-[16px] font-black text-slate-900 mb-1.5 leading-snug">
          {message.subject}
        </h3>
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-slate-600 font-medium m-0">
          {message.body}
        </p>
      </article>
    </div>
  );
}
