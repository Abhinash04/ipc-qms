import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  MailIcon,
  RefreshCwIcon,
  ShieldAlert,
  CheckCircle2,
  ArrowRight,
  Trash2Icon,
  X,
  PaperclipIcon,
} from "lucide-react";

import { Breadcrumb } from "@/components/common/Breadcrumb";
import { PageHeader } from "@/components/common/PageHeader";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  useMailboxIngestion,
  notifyIngestResult,
} from "@/hooks/useMailboxIngestion";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import {
  fetchMailboxMessages,
  deleteMailboxMessage,
} from "@/services/api/mailboxService";
import { buildPath } from "@/constants/routePaths";
import { useAuthStore } from "@/store/useAuthStore";
import { ROLE_SLUG } from "@/constants/permissions";

const AUTO_REFRESH_MS = 15000;

/** Column template shared by the header strip and every row. */
const ROW_GRID = "xl:grid-cols-[60px_220px_1fr_200px_160px_150px]";

/** "Jane Doe <jane@x.gov>" split into its display name and address. */
function parseSender(from) {
  if (!from) return { name: "Unknown Sender", email: "", initials: "M" };

  const name = from.split("<")[0].trim() || "Unknown Sender";
  const email = from.includes("<")
    ? from.split("<")[1].replace(">", "").trim()
    : "";
  const initials =
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "M";

  return { name, email, initials };
}

function formatReceived(receivedAt) {
  const date = receivedAt ? new Date(receivedAt) : new Date();
  return {
    date: date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    time: date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }),
  };
}

/** One line summarising what the last mailbox check actually did. */
function describeIngestResult(result) {
  const parts = [];

  if (result.created.length > 0) {
    parts.push(
      `${result.created.length} case${result.created.length > 1 ? "s" : ""} registered`,
    );
  } else {
    parts.push("No new mail to register");
  }

  if (result.skipped.length > 0) {
    parts.push(`${result.skipped.length} already registered`);
  }
  if (result.acknowledged?.length > 0) {
    parts.push(`${result.acknowledged.length} acknowledged`);
  }

  return parts.join(" · ");
}

function MailboxOfflineNotice() {
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
          Could not connect to the backend mailbox service. Please verify backend
          is running (`npm start` in `/backend`).
        </p>
      </div>
    </div>
  );
}

function IngestSummary({ result }) {
  return (
    <div className="rounded-2xl bg-[#f1f5fa] border border-white p-3.5 shadow-[4px_4px_8px_#d0d7e5,-4px_-4px_8px_#ffffff] text-[13px] font-bold text-slate-700 flex items-center gap-2">
      <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600 shrink-0" />
      <span>{describeIngestResult(result)}</span>
    </div>
  );
}

function InboxActions({ autoRefresh, onAutoRefreshChange, running, onCheck }) {
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
    </div>
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
        Incoming enquiries sent to the official mailbox will automatically appear
        here.
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

/** Whether the message already became a Query Case, or is still waiting. */
function QueryCaseCell({ known, queryId, detailPath }) {
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

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200/80 px-3 py-1 xl:px-3.5 xl:py-1.5 text-[10.5px] xl:text-[11.5px] font-extrabold shadow-2xs">
      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
      Not registered
    </span>
  );
}

/**
 * One action block for every breakpoint. It used to be rendered twice — once
 * `xl:hidden`, once `hidden xl:flex`. CSS hid one of them, but both stayed in
 * the accessibility tree and in the DOM, so every row exposed two identically
 * named "Yes" buttons and the compact copy's icon buttons carried no
 * accessible name at all.
 */
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
        {/* Desktop-only caption: the compact layout never showed one, and the
            buttons are self-explanatory next to the row they belong to. */}
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

function MailboxRow({
  message,
  index,
  known,
  queryId,
  detailPath,
  confirming,
  deleting,
  onAskConfirm,
  onCancel,
  onDelete,
}) {
  const sender = parseSender(message.from);
  const received = formatReceived(message.receivedAt);

  return (
    <div
      className={`group relative flex flex-col xl:grid ${ROW_GRID} items-start xl:items-center gap-3 xl:gap-4 bg-white rounded-2xl border border-slate-200/70 p-4 shadow-2xs hover:shadow-md hover:border-purple-300 transition-[border-color,box-shadow] duration-200`}
    >
      <div
        className={`absolute left-0 top-0 bottom-0 w-1.5 rounded-l-2xl ${known ? "bg-emerald-500" : "bg-amber-500"}`}
      />

      <div className="hidden xl:flex justify-center pl-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 font-extrabold text-[12px] text-slate-700">
          {index + 1}
        </span>
      </div>

      <div className="flex items-center justify-between xl:justify-start w-full xl:w-auto gap-3 min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-700 font-extrabold text-[12px] border border-purple-100">
            {sender.initials}
          </div>
          <div className="min-w-0">
            <div className="text-[13.5px] font-extrabold text-slate-900 truncate">
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
              <div className="text-[14px] font-extrabold text-slate-900 truncate group-hover:text-purple-700 transition-colors cursor-pointer">
                {message.subject || "(No Subject)"}
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-100 wrap-break-word">
              {message.subject}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-400 mt-0.5">
          <MailIcon className="h-3.5 w-3.5 text-purple-500 shrink-0" />
          <span className="truncate">Email Enquiry</span>
          {message.attachments?.length > 0 && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold text-slate-500">
              <PaperclipIcon className="h-3 w-3" aria-hidden="true" />
              {message.attachments.length}
            </span>
          )}
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
          />
        </div>
      </div>

      <div className="flex justify-center w-full xl:w-auto">
        <RowDeleteControls
          message={message}
          known={known}
          queryId={queryId}
          confirming={confirming}
          deleting={deleting}
          onAskConfirm={onAskConfirm}
          onCancel={onCancel}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

function MailboxFeedCard({ messages, deleteMessage, children }) {
  return (
    <div className="glass-panel aurora-panel bento-card rounded-[30px] border border-white/80 p-6 sm:p-7 shadow-lg bg-white/95 backdrop-blur-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 mb-5 border-b border-slate-100/80">
        <div className="flex items-center gap-4">
          <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-blue-500/10 via-indigo-500/10 to-purple-500/10 text-blue-600 border border-blue-200/50 shadow-2xs">
            <MailIcon className="h-6.5 w-6.5" strokeWidth={2} />
          </div>
          <div>
            <h2 className="font-heading text-[22px] sm:text-[26px] font-black text-slate-900 m-0 leading-tight tracking-tight">
              Ingested Mailbox Feed 📬
            </h2>
            <p className="m-0 text-[13.5px] font-medium text-slate-500 mt-1">
              Live email messages received in the official IPC inbox.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
          <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-1.5 text-[12.5px] font-extrabold text-blue-700 border border-blue-200/60 shadow-2xs">
            <span className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
            {messages.length} Message{messages.length === 1 ? "" : "s"} Total
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
  const { running, error, lastResult, ingestNow } = useMailboxIngestion();

  const [autoRefresh, setAutoRefresh] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);

  const queryClient = useQueryClient();

  const inbox = useQuery({
    queryKey: ["mailbox", "all"],
    queryFn: () => fetchMailboxMessages({ unreadOnly: false }),
    retry: false,
    refetchInterval: autoRefresh ? AUTO_REFRESH_MS : false,
  });

  const deleteMessage = useMutation({
    mutationFn: (mailboxMessageId) => deleteMailboxMessage(mailboxMessageId),
    onSuccess: () => {
      setConfirmingId(null);
      queryClient.invalidateQueries({ queryKey: ["mailbox"] });
    },
  });

  const messages = inbox.data?.messages || [];
  const loadError = inbox.isError ? inbox.error?.message : null;

  const registerAll = async () => {
    notifyIngestResult(await ingestNow());
    await inbox.refetch();
  };

  const queryIdFor = (mailboxMessageId) =>
    emailMessages.find((m) => m.sourceMessageId === mailboxMessageId)
      ?.queryId || null;

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
        purpose="Incoming enquiries waiting to be ingested and registered as Query Cases."
        actions={
          <InboxActions
            autoRefresh={autoRefresh}
            onAutoRefreshChange={setAutoRefresh}
            running={running}
            onCheck={registerAll}
          />
        }
      />

      {(error || loadError) && <MailboxOfflineNotice />}

      {lastResult && !error && <IngestSummary result={lastResult} />}

      <MailboxFeedCard messages={messages} deleteMessage={deleteMessage}>
        {messages.length === 0 ? (
          <EmptyInbox />
        ) : (
          <div>
            <MailboxColumnHeader />

            <div className="space-y-3">
              {messages.map((message, index) => {
                const queryId = queryIdFor(message.mailboxMessageId);
                const known =
                  queryId && queries.some((q) => q.queryId === queryId);

                return (
                  <MailboxRow
                    key={message.mailboxMessageId}
                    message={message}
                    index={index}
                    known={known}
                    queryId={queryId}
                    detailPath={
                      queryId && paths.QUERY_DETAIL
                        ? getQueryDetailPath(queryId)
                        : null
                    }
                    confirming={confirmingId === message.mailboxMessageId}
                    deleting={deleteMessage.isPending}
                    onAskConfirm={() =>
                      setConfirmingId(message.mailboxMessageId)
                    }
                    onCancel={() => setConfirmingId(null)}
                    onDelete={() =>
                      deleteMessage.mutate(message.mailboxMessageId)
                    }
                  />
                );
              })}
            </div>
          </div>
        )}
      </MailboxFeedCard>
    </div>
  );
}
