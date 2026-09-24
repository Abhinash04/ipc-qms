import { useEffect, useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  MailIcon,
  RefreshCwIcon,
  ShieldAlert,
  ShieldCheck,
  Clock,
  CheckCircle2,
  ArrowRight,
  Trash2Icon,
  Check,
  X,
  Ban,
  PaperclipIcon,
  Search,
  CloudDownload,
} from "lucide-react";

import { Breadcrumb } from "@/components/common/Breadcrumb";
import { PageHeader } from "@/components/common/PageHeader";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  useMailboxIngestion,
  notifyMailboxCheck,
} from "@/hooks/useMailboxIngestion";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import {
  fetchMailboxMessages,
  fetchMailboxDecisions,
  deleteMailboxMessage,
  rescueMailboxMessage,
  syncMailbox,
} from "@/services/api/mailboxService";
import { notify } from "@/services/notify";
import {
  parseSender,
  formatReceived,
  toSnippet,
} from "@/utils/mailboxFormat";
import { buildPath } from "@/constants/routePaths";
import { useAuthStore } from "@/store/useAuthStore";
import { ROLE_SLUG } from "@/constants/permissions";
import { cn } from "@/utils/cn";

const AUTO_REFRESH_MS = 15000;
const SYNC_POLL_MS = 3000;
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

// A three-way view rather than two booleans. `awaiting` and `junkOnly` are
// mutually exclusive by construction on the server: rejecting a message sets
// `ingested`, and `awaiting` means `ingested: false`, so asking for both at once
// would always return nothing.
const MAIL_VIEWS = [
  { value: "all", label: "All mail", awaiting: false, junkOnly: false },
  { value: "awaiting", label: "Awaiting", awaiting: true, junkOnly: false },
  { value: "junk", label: "Junk", awaiting: false, junkOnly: true },
];

const viewByValue = (value) => MAIL_VIEWS.find((entry) => entry.value === value) || MAIL_VIEWS[0];

/**
 * How long before the retention sweep strips this message's content.
 *
 * Rounded coarsely on purpose: the sweep runs hourly, so a to-the-minute
 * countdown would promise a precision the schedule does not have.
 */
function describePurge(purgesAt, now = Date.now()) {
  if (!purgesAt) return null;
  const at = Date.parse(purgesAt);
  if (Number.isNaN(at)) return null;
  const hours = Math.round((at - now) / 3600000);
  if (hours <= 0) return "purges next sweep";
  if (hours < 48) return `purges in ${hours}h`;
  return `purges in ${Math.round(hours / 24)}d`;
}

function useDebouncedValue(value, ms) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (value === debounced) return undefined;
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, debounced, ms]);

  return debounced;
}

const ROW_GRID = "xl:grid-cols-[60px_220px_1fr_200px_160px_150px]";

function describeMailboxCheck(result) {
  const waiting = result.fetched || 0;
  if (waiting === 0) return "No new mail";
  return `${waiting} message${waiting === 1 ? "" : "s"} awaiting validation`;
}

function describeAccept(result, message) {
  const sender = parseSender(message.from).email || message.from;
  const done = [];
  const failed = [];

  if (result.aiSummaryStatus === "GENERATED") done.push("AI summary generated");
  else if (result.aiSummaryStatus === "FALLBACK") done.push("summary produced offline");
  else if (result.aiSummaryStatus === "FAILED") failed.push("no AI summary");

  const ackUnconfirmed = (result.errors || []).some(
    (entry) => entry.step === "acknowledgement" && entry.unconfirmed,
  );
  const ackError = (result.errors || []).find((entry) => entry.step === "acknowledgement")?.error;
  const reason = ackError ? ` Acknowledgement: ${ackError}` : "";

  if (result.acknowledged) done.push(`acknowledgement sent to ${sender}`);
  else failed.push(ackUnconfirmed ? "acknowledgement may already have been sent" : "acknowledgement not sent");

  (result.forwarded ? done : failed).push(
    result.forwarded
      ? "forwarded to the Officer-in-Charge"
      : "not forwarded to the Officer-in-Charge",
  );

  const sentence = [...done, ...failed].join(" · ");
  if (!failed.length) return `${sentence}.`;

  return ackUnconfirmed
    ? `${sentence}. The case is saved — check the NICeMail Sent folder before retrying, or ${sender} may receive the acknowledgement twice.${reason}`
    : `${sentence}. The case is saved — retry from the case page.${reason}`;
}

function MailboxSyncNotice({ sync }) {
  const since = sync.since ? new Date(sync.since).toLocaleTimeString() : null;

  return (
    <div
      role="alert"
      className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4.5 text-slate-700 shadow-sm flex items-start gap-3.5"
    >
      <ShieldAlert className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
      <div>
        <p className="font-bold text-[14px] text-amber-900">
          The mailbox could not be read — this list may be out of date
        </p>
        <p className="mt-1 text-[12.5px] font-medium text-amber-800 leading-relaxed">
          {sync.error || "The last mailbox sync failed."}
          {sync.stage ? ` (stage: ${sync.stage})` : ""}
          {since ? ` Failing since ${since}` : ""}
          {sync.failures > 1 ? `, ${sync.failures} attempts` : ""}. Checks continue
          automatically; for NICeMail, confirm the dedicated Chrome is running and
          signed in — see docs/NIC_BROWSER_AGENT.md.
        </p>
      </div>
    </div>
  );
}

function MailboxOfflineNotice({ reason }) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-rose-200 bg-rose-50/90 p-4.5 text-slate-700 shadow-sm flex items-start gap-3.5"
    >
      <ShieldAlert className="h-6 w-6 text-rose-600 shrink-0 mt-0.5" />
      <div>
        <p className="font-bold text-[14px] text-rose-900">
          Mailbox server offline / unreachable
        </p>
        <p className="mt-1 text-[12.5px] font-medium text-rose-700 leading-relaxed">
          {reason ||
            'Could not connect to the backend mailbox service. Please verify backend is running (`npm start` in `/backend`).'}
        </p>
      </div>
    </div>
  );
}

function MailboxCheckSummary({ result }) {
  return (
    <div className="rounded-2xl bg-[#f1f5fa] border border-white p-3.5 shadow-[4px_4px_8px_#d0d7e5,-4px_-4px_8px_#ffffff] text-[13px] font-bold text-slate-700 flex items-center gap-2">
      <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600 shrink-0" />
      <span>{describeMailboxCheck(result)}</span>
    </div>
  );
}

function InboxActions({
  autoRefresh,
  onAutoRefreshChange,
  running,
  onCheck,
  canSync,
  syncing,
  onSync,
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 bg-[#f1f5fa] border border-white px-3.5 py-2 rounded-2xl shadow-[inset_2px_2px_4px_#d0d7e5,inset_-2px_-2px_4px_#ffffff]">
        <Checkbox
          id="auto-refresh"
          checked={autoRefresh}
          onCheckedChange={(checked) => onAutoRefreshChange(checked === true)}
        />
        <Label
          htmlFor="auto-refresh"
          className="text-[12.5px] font-semibold text-slate-600 cursor-pointer"
        >
          Auto-refresh (15s)
        </Label>
      </div>

      <button
        type="button"
        onClick={onCheck}
        disabled={running}
        className="flex items-center gap-2 rounded-2xl bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-5 py-2.5 text-[13.5px] font-bold shadow-md shadow-blue-500/20 active:scale-95 transition-transform cursor-pointer disabled:opacity-60"
      >
        <RefreshCwIcon className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
        <span>{running ? "Checking Mailbox…" : "Check IPC Mailbox"}</span>
      </button>

      {canSync && (
        <button
          type="button"
          onClick={onSync}
          disabled={syncing}
          className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-4 py-2.5 text-[13.5px] font-bold shadow-sm active:scale-95 transition-transform cursor-pointer disabled:opacity-60"
        >
          <CloudDownload
            className={`h-4 w-4 ${syncing ? "animate-pulse" : ""}`}
            aria-hidden="true"
          />
          <span>{syncing ? "Syncing…" : "Sync now"}</span>
        </button>
      )}
    </div>
  );
}

function InboxToolbar({ search, onSearchChange, view, onViewChange }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
      <div role="search" className="relative flex-1">
        <label htmlFor="mailbox-search" className="sr-only">
          Search mail
        </label>
        <Search
          className="absolute left-4 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400"
          aria-hidden="true"
        />
        <input
          id="mailbox-search"
          type="search"
          maxLength={200}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search sender, subject or message text…"
          className="w-full rounded-2xl bg-slate-50/70 border border-slate-200/70 pl-11 pr-4 py-3 text-[13.5px] font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
        />
      </div>

      <div
        role="group"
        aria-label="Filter mail"
        className="flex self-start sm:self-auto bg-slate-100/80 p-1 rounded-xl shrink-0"
      >
        {MAIL_VIEWS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            aria-pressed={view === entry.value}
            onClick={() => onViewChange(entry.value)}
            className={cn(
              "px-3 py-1.5 text-[12px] font-bold rounded-lg transition-colors cursor-pointer",
              view === entry.value
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function InboxSkeleton() {
  return (
    <div role="status" aria-label="Loading mail" className="space-y-3">
      {[0, 1, 2].map((n) => (
        <Skeleton key={n} className="h-19 w-full rounded-2xl" />
      ))}
    </div>
  );
}

function NoMatchingMail() {
  return (
    <div className="py-12 px-4 text-center rounded-2xl border border-dashed border-slate-200/90 bg-slate-50/50">
      <h3 className="font-heading text-[16px] font-extrabold text-slate-800 m-0">
        No messages match
      </h3>
      <p className="text-[13px] font-medium text-slate-400 m-0 mt-1">
        Try another search, or show all mail.
      </p>
    </div>
  );
}

function InboxPager({ offset, shown, total, onPage }) {
  if (!(total > PAGE_SIZE || offset > 0)) return null;

  return (
    <nav
      aria-label="Mailbox pages"
      className="mt-5 flex flex-wrap items-center justify-between gap-3"
    >
      <p className="m-0 text-[12.5px] font-bold text-slate-500">
        {shown
          ? `Showing ${offset + 1}–${offset + shown} of ${total}`
          : "No messages on this page"}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0}
          onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={offset + PAGE_SIZE >= total}
          onClick={() => onPage(offset + PAGE_SIZE)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}

function EmptyInbox() {
  return (
    <div className="py-12 px-4 text-center rounded-2xl border border-dashed border-slate-200/90 bg-slate-50/50 flex flex-col items-center justify-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 border border-blue-100/60 shadow-2xs mb-3">
        <MailIcon className="h-7 w-7" strokeWidth={1.8} />
      </div>
      <h3 className="font-heading text-[16px] font-extrabold text-slate-800 m-0">
        No Mail in the IPC Mailbox
      </h3>
      <p className="text-[13px] font-medium text-slate-400 m-0 mt-1 max-w-sm">
        Enquiries sent to the official mailbox appear here for you to accept or
        reject. Nothing becomes a Query Case until you accept it.
      </p>
    </div>
  );
}

const COLUMN_HEADERS = [
  { label: "S.No.", center: true },
  { label: "From / Sender" },
  { label: "Subject & Content" },
  { label: "Received On" },
  { label: "Query Case", center: true },
  { label: "Actions", center: true },
];

function MailboxColumnHeader() {
  return (
    <div
      className={`hidden xl:grid ${ROW_GRID} gap-4 px-5 py-3.5 bg-slate-50/80 border border-slate-100 rounded-2xl text-[11px] font-extrabold text-slate-400 tracking-wider uppercase mb-3`}
    >
      {COLUMN_HEADERS.map(({ label, center }) => (
        <span key={label} className={center ? "text-center" : undefined}>
          {label}
        </span>
      ))}
    </div>
  );
}

function QueryCaseCell({ known, queryId, detailPath, rejected }) {
  if (known && detailPath) {
    return (
      <Link
        to={detailPath}
        className="inline-flex items-center gap-1.5 rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-3.5 py-1.5 xl:px-4 xl:py-2 text-[11.5px] xl:text-[12px] font-black shadow-sm transition-transform hover:scale-105"
      >
        <span>{queryId}</span>
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    );
  }

  if (rejected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 px-3 py-1 xl:px-3.5 xl:py-1.5 text-[10.5px] xl:text-[11.5px] font-extrabold shadow-2xs">
        <Ban className="h-3 w-3 shrink-0" aria-hidden="true" />
        Rejected
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200/80 px-3 py-1 xl:px-3.5 xl:py-1.5 text-[10.5px] xl:text-[11.5px] font-extrabold shadow-2xs">
      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
      Awaiting validation
    </span>
  );
}

function RowValidationControls({ message, decision, junk, pending, confirming, onAsk, onCancel, onConfirm, onRescue }) {
  if (decision) return null;

  if (confirming) {
    const accepting = confirming === "accept";
    return (
      <div className="flex flex-col items-center gap-1.5">
        <span className="hidden xl:block text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">
          {accepting ? "Register & forward?" : "Reject?"}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`rounded-xl px-3 py-1.5 text-[11.5px] font-extrabold text-white shadow-sm transition-[background-color,transform] active:scale-95 cursor-pointer disabled:opacity-60 ${
              accepting
                ? "bg-emerald-600 hover:bg-emerald-700"
                : "bg-slate-600 hover:bg-slate-700"
            }`}
          >
            {pending ? "Working…" : "Yes"}
          </button>
          <button
            type="button"
            aria-label={accepting ? "Cancel accept" : "Cancel reject"}
            onClick={onCancel}
            disabled={pending}
            className="rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-500 p-1.5 transition-colors cursor-pointer disabled:opacity-60"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Accept message ${message.mailboxMessageId}`}
              onClick={() => onAsk("accept")}
              className="border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-70 wrap-break-word">
            Register this as an IPC query case, acknowledge the sender and
            forward it to the Officer-in-Charge.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Reject message ${message.mailboxMessageId}`}
              onClick={() => onAsk("reject")}
              className="border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-70 wrap-break-word">
            Not an IPC query. No case is created and no acknowledgement is sent.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {junk ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Rescue message ${message.mailboxMessageId}`}
                onClick={onRescue}
                disabled={pending}
                className="border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-70 wrap-break-word">
              Not junk. Clears the verdict so it is never purged, without opening
              a Query Case the way accepting would.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </div>
  );
}

function RowDeleteControls({
  message,
  known,
  queryId,
  confirming,
  deleting,
  onAskConfirm,
  onCancel,
  onDelete,
}) {
  if (confirming) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <span className="hidden xl:block text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">
          Delete?
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 text-[11.5px] font-extrabold shadow-sm transition-[background-color,transform] active:scale-95 cursor-pointer disabled:opacity-60"
          >
            {deleting ? "Deleting…" : "Yes"}
          </button>
          <button
            type="button"
            aria-label="Cancel delete"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-500 p-1.5 transition-colors cursor-pointer disabled:opacity-60"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Delete message ${message.mailboxMessageId}`}
            onClick={onAskConfirm}
            className="rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-600 p-2 transition-[background-color,transform] active:scale-95 cursor-pointer"
          >
            <Trash2Icon className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-70 wrap-break-word">
          {known
            ? `Removes the mailbox copy only. Query Case ${queryId} will remain.`
            : "Remove this message from the IPC mailbox."}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const railColour = (known, rejected) => {
  if (known) return "bg-emerald-500";
  if (rejected) return "bg-slate-400";
  return "bg-amber-500";
};

function MailboxRow({
  message,
  index,
  openPath,
  known,
  queryId,
  detailPath,
  decision,
  confirming,
  pending,
  deleting,
  onAskConfirm,
  onCancel,
  onDelete,
  onAskDecision,
  onCancelDecision,
  onConfirmDecision,
  onRescue,
}) {
  const navigate = useNavigate();
  const sender = parseSender(message.from);
  const received = formatReceived(message.receivedAt);
  const rejected = decision?.decision === "REJECTED";
  const unread = message.isRead === false;
  const junk = message.triage?.verdict === "JUNK" && !message.triage?.rescuedAt;
  // Shown for both retention tiers, so nothing is destroyed without notice. A
  // message that already became a case is safe and says so through its case
  // link instead.
  const purge = describePurge(message.triage?.purgesAt);

  const openFromRow = (event) => {
    if (
      !event.currentTarget.contains(event.target) ||
      event.target.closest('a, button, input, [role="button"]') ||
      window.getSelection()?.toString()
    ) {
      return;
    }
    navigate(openPath);
  };

  return (
    <div
      onClick={openFromRow}
      className={`group relative flex flex-col xl:grid ${ROW_GRID} items-start xl:items-center gap-3 xl:gap-4 ${unread ? "bg-blue-50/40" : "bg-white"} rounded-2xl border border-slate-200/70 p-4 shadow-2xs hover:shadow-md hover:border-purple-300 transition-[border-color,box-shadow] duration-200 cursor-pointer`}
    >
      <div
        className={`absolute left-0 top-0 bottom-0 w-1.5 rounded-l-2xl ${railColour(known, rejected)}`}
      />

      <div className="hidden xl:flex justify-center pl-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 font-extrabold text-[12px] text-slate-700">
          {index + 1}
        </span>
      </div>

      <div className="flex items-center justify-between xl:justify-start w-full xl:w-auto gap-3 min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-700 font-extrabold text-[12px] border border-purple-100">
            {sender.initials}
            {unread && (
              <span
                className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-blue-600 ring-2 ring-white"
                aria-hidden="true"
              />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[13.5px] font-extrabold text-slate-900 truncate">
              {unread && <span className="sr-only">Unread </span>}
              {sender.name}
            </div>
            {sender.email && (
              <div className="text-[11px] font-medium text-slate-400 truncate">
                {sender.email}
              </div>
            )}
          </div>
        </div>

        <div className="xl:hidden flex flex-col items-end shrink-0 text-right pl-2">
          <div className="text-[12px] font-bold text-slate-800">
            {received.date}
          </div>
          <div className="text-[10px] font-medium text-slate-400 mt-0.5">
            {received.time}
          </div>
        </div>
      </div>

      <div className="min-w-0 w-full xl:w-auto px-1 xl:px-0">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to={openPath}
                className="block text-[14px] font-extrabold text-slate-900 truncate group-hover:text-purple-700 transition-colors"
              >
                {message.subject || "(No Subject)"}
              </Link>
            </TooltipTrigger>
            <TooltipContent className="max-w-100 wrap-break-word">
              {message.subject}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-400 mt-0.5">
          <MailIcon className="h-3.5 w-3.5 text-purple-500 shrink-0" />
          <span className="truncate">
            {toSnippet(message.body) || "Email Enquiry"}
          </span>
          {message.attachments?.length > 0 && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold text-slate-500">
              <PaperclipIcon className="h-3 w-3" aria-hidden="true" />
              {message.attachments.length}
            </span>
          )}
          {purge && !known ? (
            <span
              className={cn(
                "ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold",
                junk ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500",
              )}
            >
              <Clock className="h-3 w-3" aria-hidden="true" />
              {purge}
            </span>
          ) : null}
        </div>
      </div>

      <div className="hidden xl:block">
        <div className="text-[13px] font-bold text-slate-800">
          {received.date}
        </div>
        <div className="text-[11.5px] font-medium text-slate-400 mt-0.5">
          {received.time}
        </div>
      </div>

      <div className="flex items-center justify-between xl:justify-center w-full xl:w-auto mt-2 xl:mt-0 pt-3 xl:pt-0 border-t border-slate-100 xl:border-0">
        <div className="flex items-center gap-2">
          <span className="xl:hidden text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Query Case:
          </span>
          <QueryCaseCell
            known={known}
            queryId={queryId}
            detailPath={detailPath}
            rejected={rejected}
          />
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 w-full xl:w-auto">
        <RowValidationControls
          message={message}
          decision={decision}
          junk={junk}
          pending={pending}
          confirming={confirming?.action === "accept" || confirming?.action === "reject" ? confirming.action : null}
          onAsk={onAskDecision}
          onCancel={onCancelDecision}
          onConfirm={onConfirmDecision}
          onRescue={onRescue}
        />
        <RowDeleteControls
          message={message}
          known={known}
          queryId={queryId}
          confirming={confirming?.action === "delete"}
          deleting={deleting}
          onAskConfirm={onAskConfirm}
          onCancel={onCancel}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

const FEED_SUBTITLE = {
  'nic-browser': 'Email received in the NICeMail mailbox, from any sender.',
  nic: 'Email received in the NICeMail mailbox over IMAP, from any sender.',
  mongo: 'Messages in the local mailbox store — development and testing, not a live inbox.',
  'in-memory': 'Messages in the local mailbox store — development and testing, not a live inbox.',
};

function MailboxFeedCard({ count, backend, deleteMessage, children }) {
  return (
    <div className="glass-panel aurora-panel bento-card rounded-[30px] border border-white/80 p-6 sm:p-7 shadow-lg bg-white/95 backdrop-blur-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 mb-5 border-b border-slate-100/80">
        <div className="flex items-center gap-4">
          <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-blue-500/10 via-indigo-500/10 to-purple-500/10 text-blue-600 border border-blue-200/50 shadow-2xs">
            <MailIcon className="h-6.5 w-6.5" strokeWidth={2} />
          </div>
          <div>
            <h2 className="font-heading text-[22px] sm:text-[26px] font-black text-slate-900 m-0 leading-tight tracking-tight">
              Incoming Mailbox Feed 📬
            </h2>
            <p className="m-0 text-[13.5px] font-medium text-slate-500 mt-1">
              {FEED_SUBTITLE[backend] || 'Messages in the Front Office mailbox, from any sender.'}{' '}
              A message becomes a Query Case only when you accept it.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
          <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-1.5 text-[12.5px] font-extrabold text-blue-700 border border-blue-200/60 shadow-2xs">
            <span className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
            {count} Message{count === 1 ? "" : "s"} Total
          </span>
        </div>
      </div>

      {deleteMessage.isError && (
        <p
          role="alert"
          className="mb-4 rounded-2xl border border-rose-200 bg-rose-50/90 px-4 py-3 text-[13px] font-bold text-rose-700"
        >
          Could not delete that message.{" "}
          {deleteMessage.error?.response?.data?.error ||
            deleteMessage.error?.message ||
            "Please try again."}
        </p>
      )}

      {children}
    </div>
  );
}

export function MailboxInboxPage() {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);
  const queries = useWorkflowStore((state) => state.queries);
  const emailMessages = useWorkflowStore((state) => state.emailMessages);
  const { running, error, lastResult, accept, reject, checkMailbox } =
    useMailboxIngestion();

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [confirming, setConfirming] = useState(null);
  const [deciding, setDeciding] = useState(false);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("all");
  const current = viewByValue(view);
  const [offset, setOffset] = useState(0);
  const q = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);

  const queryClient = useQueryClient();

  const inbox = useQuery({
    queryKey: ["mailbox", "list", { q, view, offset }],
    queryFn: () =>
      fetchMailboxMessages({ unreadOnly: current.awaiting, junkOnly: current.junkOnly, q, limit: PAGE_SIZE, offset }),
    placeholderData: keepPreviousData,
    retry: false,
    refetchInterval: (query) => {
      if (query.state.status !== "error" && query.state.data?.sync?.running) {
        return SYNC_POLL_MS;
      }
      return autoRefresh ? AUTO_REFRESH_MS : false;
    },
  });

  const syncNow = useMutation({
    mutationFn: () => syncMailbox(),
    onSuccess: ({ started }) => {
      notify.info(
        started ? "NICeMail sync started" : "NICeMail is already syncing",
        started
          ? "New mail appears here as it is read."
          : "A sync is running or has just finished.",
        { id: "mailbox-sync" },
      );
      queryClient.invalidateQueries({ queryKey: ["mailbox", "list"] });
    },
    onError: (failure) => {
      notify.error(
        "Could not start a NICeMail sync",
        failure?.response?.data?.error || failure?.message,
        { id: "mailbox-sync" },
      );
    },
  });

  const decisions = useQuery({
    queryKey: ["mailbox", "decisions"],
    queryFn: fetchMailboxDecisions,
    retry: false,
  });

  const deleteMessage = useMutation({
    mutationFn: (mailboxMessageId) => deleteMailboxMessage(mailboxMessageId),
    onSuccess: () => {
      setConfirming(null);
      queryClient.invalidateQueries({ queryKey: ["mailbox"] });
    },
  });

  const rescueMessage = useMutation({
    mutationFn: (mailboxMessageId) => rescueMailboxMessage(mailboxMessageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mailbox"] });
      notify.success("Kept", {
        description: "The junk verdict is cleared. This message will not be purged.",
      });
    },
    onError: (error) => {
      notify.error("Could not keep that message", {
        description: error?.response?.data?.error || error?.message || "Please try again.",
      });
    },
  });

  const messages = inbox.data?.messages || [];

  if (!inbox.isPlaceholderData && inbox.data && !messages.length && offset > 0) {
    setOffset(Math.max(0, offset - PAGE_SIZE));
  }

  const loadFailure = inbox.isError
    ? (inbox.error?.response?.data ?? { error: inbox.error?.message })
    : null;
  const loadError = loadFailure?.error || null;
  const syncFailure = [inbox.data?.sync, loadFailure?.sync].find((sync) => sync?.ok === false) || null;

  const decisionFor = (mailboxMessageId) =>
    (decisions.data?.decisions || []).find(
      (d) => d.mailboxMessageId === mailboxMessageId,
    ) || null;

  const checkNow = async () => {
    notifyMailboxCheck(await checkMailbox());
    await inbox.refetch();
  };

  const settle = async () => {
    setConfirming(null);
    setDeciding(false);
    await Promise.all([
      inbox.refetch(),
      queryClient.invalidateQueries({ queryKey: ["mailbox", "decisions"] }),
    ]);
  };

  const onAcceptMessage = async (message) => {
    setDeciding(true);
    const result = await accept(message);

    if (result.error) {
      notify.error("Could not register that message", result.error);
    } else if (result.accepted) {
      notify.success(`Query case ${result.queryId} created`, describeAccept(result, message));
    } else {
      notify.info(
        "Already registered",
        `Query case ${result.queryId} — ${describeAccept(result, message)}`,
      );
    }

    await settle();
  };

  const onRejectMessage = async (message) => {
    setDeciding(true);
    const result = await reject(message);

    if (result.error) {
      notify.error("Could not reject that message", result.error);
    } else {
      notify.info(
        "Message rejected",
        "No case was created and no acknowledgement was sent.",
      );
    }

    await settle();
  };

  const queryIdFor = (mailboxMessageId) =>
    emailMessages.find((m) => m.sourceMessageId === mailboxMessageId)
      ?.queryId || null;

  const onSearchChange = (value) => {
    setSearch(value);
    setOffset(0);
  };

  const onViewChange = (value) => {
    setView(value);
    // Page 3 of the old view is rarely page 3 of the new one, and landing past
    // the end makes the pager walk itself back a page per render.
    setOffset(0);
  };

  const filtered = Boolean(q) || view !== "all";

  const getQueryDetailPath = (queryId) => {
    if (paths.QUERY_DETAIL) {
      return buildPath(paths.QUERY_DETAIL, { queryId });
    }
    const slug = ROLE_SLUG[currentUser?.role] || "front-officer";
    return `/${slug}/queries/${queryId}`;
  };

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: "Dashboard", path: paths.DASHBOARD },
          { label: "IPC Mailbox" },
        ]}
      />

      <PageHeader
        greeting="IPC Live Mailbox 📬"
        title="IPC Mailbox Inbox"
        purpose="Incoming enquiries awaiting your validation. Accept one to open a Query Case, acknowledge the sender and forward it to the Officer-in-Charge; reject anything that is not an IPC query."
        actions={
          <InboxActions
            autoRefresh={autoRefresh}
            onAutoRefreshChange={setAutoRefresh}
            running={running}
            onCheck={checkNow}
            canSync={inbox.data?.backend === "nic-browser"}
            syncing={syncNow.isPending || Boolean(inbox.data?.sync?.running)}
            onSync={() => syncNow.mutate()}
          />
        }
      />

      {(error || loadError) && !syncFailure && <MailboxOfflineNotice reason={loadError} />}

      {syncFailure && <MailboxSyncNotice sync={syncFailure} />}

      {lastResult?.fetched !== undefined && !error && (
        <MailboxCheckSummary result={lastResult} />
      )}

      <MailboxFeedCard
        count={inbox.data?.total ?? messages.length}
        backend={inbox.data?.backend}
        deleteMessage={deleteMessage}
      >
        <InboxToolbar
          search={search}
          onSearchChange={onSearchChange}
          view={view}
          onViewChange={onViewChange}
        />

        {inbox.isPending ? (
          <InboxSkeleton />
        ) : messages.length === 0 ? (
          filtered ? <NoMatchingMail /> : <EmptyInbox />
        ) : (
          <div
            aria-busy={inbox.isPlaceholderData}
            className={inbox.isPlaceholderData ? "opacity-60" : undefined}
          >
            <MailboxColumnHeader />

            <div className="space-y-3">
              {messages.map((message, index) => {
                const queryId =
                  message.linkedCase?.queryId ||
                  queryIdFor(message.mailboxMessageId);
                const known =
                  Boolean(message.linkedCase) ||
                  (queryId && queries.some((q) => q.queryId === queryId));

                return (
                  <MailboxRow
                    key={message.mailboxMessageId}
                    message={message}
                    index={offset + index}
                    openPath={buildPath(paths.INBOX_DETAIL, {
                      messageId: encodeURIComponent(message.mailboxMessageId),
                    })}
                    known={known}
                    queryId={queryId}
                    detailPath={
                      queryId && paths.QUERY_DETAIL
                        ? getQueryDetailPath(queryId)
                        : null
                    }
                    decision={decisionFor(message.mailboxMessageId)}
                    confirming={
                      confirming?.id === message.mailboxMessageId
                        ? confirming
                        : null
                    }
                    pending={deciding}
                    deleting={deleteMessage.isPending}
                    onAskConfirm={() =>
                      setConfirming({
                        id: message.mailboxMessageId,
                        action: "delete",
                      })
                    }
                    onCancel={() => setConfirming(null)}
                    onDelete={() =>
                      deleteMessage.mutate(message.mailboxMessageId)
                    }
                    onRescue={() => rescueMessage.mutate(message.mailboxMessageId)}
                    onAskDecision={(action) =>
                      setConfirming({ id: message.mailboxMessageId, action })
                    }
                    onCancelDecision={() => setConfirming(null)}
                    onConfirmDecision={() =>
                      confirming?.action === "accept"
                        ? onAcceptMessage(message)
                        : onRejectMessage(message)
                    }
                  />
                );
              })}
            </div>
          </div>
        )}

        <InboxPager
          offset={offset}
          shown={messages.length}
          total={inbox.data?.total}
          onPage={setOffset}
        />
      </MailboxFeedCard>
    </div>
  );
}
