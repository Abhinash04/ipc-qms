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

const FILTER_TABS = [
  {
    key: "ALL",
    label: "All Emails",
    activeClass: "bg-white text-slate-800 shadow-sm",
  },
  {
    key: EMAIL_DIRECTION.INBOUND,
    label: "Received Only",
    activeClass: "bg-white text-slate-800 shadow-sm",
  },
  {
    key: EMAIL_DIRECTION.OUTBOUND,
    label: "Sent Only",
    activeClass: "bg-white text-blue-600 shadow-sm",
  },
];

/** Direction filter for the thread. */
function ThreadFilterTabs({ filter, onChange }) {
  return (
    <div className="flex bg-slate-100/80 p-1 rounded-xl shrink-0">
      {FILTER_TABS.map(({ key, label, activeClass }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "px-3 py-1.5 text-[12px] font-bold rounded-lg transition-colors cursor-pointer",
            filter === key
              ? activeClass
              : "text-slate-500 hover:text-slate-700",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ThreadHeader({ count, filter, onFilterChange }) {
  return (
    <div className="border-b border-slate-100 pb-3 mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-heading text-[19px] font-black text-slate-900 m-0">
          Email thread
        </h2>
        <p className="mt-0.5 text-[13px] font-medium text-slate-400">
          {count} {count === 1 ? "message" : "messages"} exchanged with the
          inquirer.
        </p>
      </div>

      <ThreadFilterTabs filter={filter} onChange={onFilterChange} />
    </div>
  );
}

/** Why the thread is empty depends on whether a filter is narrowing it. */
function ThreadEmptyState({ filter }) {
  if (filter === "ALL") {
    return (
      <EmptyState
        icon={MailIcon}
        title="No email on this case"
        description="A query normally starts from an email, so this is unexpected."
      />
    );
  }

  const kind = filter === EMAIL_DIRECTION.INBOUND ? "received" : "sent";
  return (
    <EmptyState
      icon={MailIcon}
      title="No emails found"
      description={`There are no ${kind} emails in this thread.`}
    />
  );
}

function ShowPreviousButton({ count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl border border-slate-200/70 bg-slate-50 hover:bg-slate-100 py-2 text-[12.5px] font-bold text-slate-500 transition-colors cursor-pointer"
    >
      Show {count} previous {count === 1 ? "message" : "messages"}
    </button>
  );
}

/** An older message, shown as a one-liner until the reader opens it. */
function PreviousMessage({ message, isFilteredView, isExpanded, onToggle }) {
  if (!isExpanded) {
    return <CollapsedMessage message={message} onExpand={onToggle} />;
  }
  return (
    <ThreadMessage
      message={message}
      isFilteredView={isFilteredView}
      onCollapse={onToggle}
    />
  );
}

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
  const isFilteredView = filter !== "ALL";

  const toggle = (messageId) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-sm">
      <ThreadHeader
        count={filteredMessages.length}
        filter={filter}
        onFilterChange={setFilter}
      />

      <div className="space-y-3">
        {filteredMessages.length === 0 ? (
          <ThreadEmptyState filter={filter} />
        ) : (
          <>
            {previous.length > 0 && !showPrevious && (
              <ShowPreviousButton
                count={previous.length}
                onClick={() => setShowPrevious(true)}
              />
            )}

            {visiblePrevious.map((message) => (
              <PreviousMessage
                key={message.messageId}
                message={message}
                isFilteredView={isFilteredView}
                isExpanded={expanded.has(message.messageId)}
                onToggle={() => toggle(message.messageId)}
              />
            ))}

            {/* The newest message is what the reader almost always wants. */}
            {latest && (
              <ThreadMessage
                key={latest.messageId}
                message={latest}
                isFilteredView={isFilteredView}
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
      className="w-full flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white hover:bg-slate-50 hover:border-slate-300 px-4 py-2.5 text-left transition-colors cursor-pointer"
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
            <span className="font-extrabold shrink-0 w-8 text-slate-400">
              To
            </span>
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
