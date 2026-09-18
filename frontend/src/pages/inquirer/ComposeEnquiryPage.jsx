import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  SendIcon,
  MailIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  InfoIcon,
  ShieldCheckIcon,
  ClockIcon,
} from "lucide-react";
import { Breadcrumb } from "@/components/common/Breadcrumb";
import { PageHeader } from "@/components/common/PageHeader";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { buildPath } from "@/constants/routePaths";
import { useAuthStore } from "@/store/useAuthStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { fetchEmailConfig, sendEnquiry } from "@/services/api/mailboxService";
import { uploadAttachments } from "@/services/api/attachmentService";
import { AttachmentPicker } from "@/components/attachments/AttachmentPicker";
import { hasBlockingErrors } from "@/constants/attachmentPolicy";
import { notify } from "@/services/notify";
import { cn } from "@/utils/cn";

const FIELD_LABEL =
  "text-[11.5px] font-bold text-slate-600 uppercase tracking-wider";
const READONLY_FIELD =
  "w-full rounded-xl border border-slate-200/90 bg-slate-50/90 px-3.5 py-2.5 text-xs font-mono font-medium text-slate-700 shadow-2xs focus:outline-none";

/**
 * Attachments upload first: a failed upload must block the send rather than
 * register a case that silently has no files.
 */
async function uploadPendingAttachments(pendingFiles) {
  if (pendingFiles.length === 0) return undefined;

  const plural = pendingFiles.length === 1 ? "" : "s";
  // One toast that follows the upload from progress to outcome, so the
  // success message cannot appear unless the request actually resolved.
  const toastId = notify.loading(
    `Uploading ${pendingFiles.length} file${plural}…`,
  );

  try {
    const attachments = await uploadAttachments(
      pendingFiles.map((entry) => entry.file),
      {
        onUploadProgress: (event) => {
          if (!event.total) return;
          const percent = Math.round((event.loaded / event.total) * 100);
          notify.loading(
            `Uploading ${pendingFiles.length} file${plural}…`,
            `${percent}%`,
            { id: toastId },
          );
        },
      },
    );
    notify.success("Attachments uploaded", null, { id: toastId });
    return attachments;
  } catch (caught) {
    notify.error(
      "Attachment upload failed",
      `${caught?.message || String(caught)} — your enquiry was not sent.`,
      { id: toastId },
    );
    throw caught;
  }
}

/** Upload, send, then register the case — each step reporting its own failure. */
function useSendEnquiry({ form, config, currentUser, raiseEnquiry, onRaised }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const attachments = await uploadPendingAttachments(form.pendingFiles);

      const enquiryPayload = { subject: form.subject.trim(), body: form.body };
      if (attachments) enquiryPayload.attachments = attachments;

      let sent;
      try {
        sent = await sendEnquiry(enquiryPayload);
      } catch (caught) {
        // Named separately from the upload so the user knows which step failed
        // and that the files themselves went through.
        notify.error("Could not send your enquiry", caught);
        throw caught;
      }

      const raised = raiseEnquiry({
        subject: form.subject.trim(),
        body: form.body,
        inquirer: {
          id: currentUser?.id || null,
          name: currentUser?.name || "",
          email: currentUser?.email || "",
        },
        to: config.data?.ipcQueryEmail || null,
        providerMessageId: sent?.providerMessageId || null,
        attachments,
      });
      return { ...sent, queryId: raised.queryId };
    },
    onSuccess: (result) => {
      // The enquiry lands in the front-office mailbox and is recorded in the
      // audit trail; both feeds are cached, so they are stale until refetched.
      queryClient.invalidateQueries({ queryKey: ["mailbox"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
      onRaised(result.queryId);
    },
  });
}

/**
 * Same box shape as the transport banners, so the form does not jump down when
 * the config resolves and the real banner replaces it.
 */
function ConfigSkeletonBanner() {
  return (
    <div
      aria-hidden="true"
      className="rounded-xl border border-slate-200 bg-slate-50/90 p-4 text-sm shadow-2xs flex items-start gap-3"
    >
      <div className="h-5 w-5 rounded-full bg-slate-200 animate-pulse shrink-0 mt-0.5" />
      <div className="flex-1">
        <div className="h-4 w-56 max-w-full rounded bg-slate-200 animate-pulse" />
        <div className="mt-2 space-y-1.5">
          <div className="h-4 w-full rounded bg-slate-100 animate-pulse" />
          <div className="h-4 w-full max-w-xl rounded bg-slate-100 animate-pulse" />
          <div className="h-4 w-3/5 rounded bg-slate-100 animate-pulse sm:hidden" />
        </div>
      </div>
    </div>
  );
}

/** Whether this send will leave the machine, stated before the user commits. */
function TransportBanner({ config, from, to }) {
  if (config.isLoading) return <ConfigSkeletonBanner />;

  if (config.isError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50/90 p-4 text-sm text-red-800 shadow-2xs flex items-start gap-3">
        <AlertCircleIcon className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-red-900">Backend unreachable</p>
          <p className="mt-0.5 text-red-700">
            Could not load the email configuration. Start the backend (npm start
            in /backend) and reload this page.
          </p>
        </div>
      </div>
    );
  }

  if (config.data?.transport === "mock") {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50/90 p-4 text-sm text-blue-900 shadow-2xs flex items-start gap-3">
        <InfoIcon className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-blue-950">
            Mock transport active — no mail leaves this machine
          </p>
          <p className="mt-0.5 text-blue-800">
            The enquiry is delivered straight into the mock IPC mailbox ({to}).
            Nothing is sent over the internet, and that address is a reserved
            test domain that cannot receive real mail.
          </p>
        </div>
      </div>
    );
  }

  if (config.data?.transport === "gmail") {
    // `transport` is the deployment-wide setting; whether THIS sender can use
    // it is a per-role question. Reading the global value alone is how this
    // banner came to promise a real email that the mock transport was quietly
    // swallowing.
    const inquirer = (config.data.participants || []).find(
      (p) => p.role === "INQUIRER",
    );

    if (!inquirer?.canSendReal) {
      return (
        <div className="rounded-xl border border-blue-200 bg-blue-50/90 p-4 text-sm text-blue-900 shadow-2xs flex items-start gap-3">
          <InfoIcon className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-blue-950">
              Simulated enquiry — no mail leaves this machine
            </p>
            <p className="mt-0.5 text-blue-800">
              This form exists to produce a test enquiry. Real inquirers are
              external: they write to the IPC mailbox ({to}) from their own mail
              client and hold no account here, so no Gmail credential is
              configured for this role.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-900 shadow-2xs flex items-start gap-3">
        <ShieldCheckIcon className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-amber-950">
            Gmail transport active — this sends a real email
          </p>
          <p className="mt-0.5 text-amber-800">
            The message is sent from {from} through Gmail and will appear in
            that account&apos;s Sent folder.
          </p>
        </div>
      </div>
    );
  }

  return null;
}

function EnquiryFormCard({ from, to, form, send, canSend }) {
  return (
    <div className="rounded-[20px] border border-slate-200/90 bg-white p-6 sm:p-7 shadow-[0_4px_20px_rgba(0,0,0,0.03)] space-y-6">
      <div className="flex items-center gap-3 pb-4.5 border-b border-slate-100">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-tr from-blue-600 to-indigo-600 text-white shadow-[0_6px_16px_rgba(37,99,235,0.3)]">
          <MailIcon className="h-5.5 w-5.5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 leading-tight tracking-tight">
            New enquiry
          </h2>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            Fill in the subject and message details to submit a new enquiry
            case.
          </p>
        </div>
      </div>

      <div className="space-y-4.5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="enquiry-from" className={FIELD_LABEL}>
              From
            </label>
            <div className="relative">
              <input
                id="enquiry-from"
                value={from}
                readOnly
                className={READONLY_FIELD}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="enquiry-to" className={FIELD_LABEL}>
              To
            </label>
            <div className="relative">
              <input
                id="enquiry-to"
                value={to}
                readOnly
                className={READONLY_FIELD}
              />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="enquiry-subject" className={FIELD_LABEL}>
            Subject
          </label>
          <input
            id="enquiry-subject"
            value={form.subject}
            onChange={(e) => form.setSubject(e.target.value)}
            placeholder="Clarification regarding submission requirements…"
            className="w-full rounded-xl border border-slate-200/90 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 shadow-2xs transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="enquiry-body" className={FIELD_LABEL}>
            Message
          </label>
          <textarea
            id="enquiry-body"
            value={form.body}
            onChange={(e) => form.setBody(e.target.value)}
            rows={12}
            className="w-full rounded-xl border border-slate-200/90 bg-white p-3.5 text-sm font-normal leading-relaxed text-slate-900 placeholder:text-slate-400 shadow-2xs transition-colors resize-none focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="Dear Sir/Madam,&#10;&#10;I am writing to seek clarification regarding…"
          />
        </div>

        <AttachmentPicker
          files={form.pendingFiles}
          onChange={form.setPendingFiles}
          disabled={send.isPending}
        />

        <div className="pt-2 flex items-center gap-4">
          <button
            type="button"
            onClick={() => send.mutate()}
            disabled={!canSend || send.isPending}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-xl px-6.5 py-3 text-sm font-bold text-white transition-colors duration-200 shadow-md",
              canSend && !send.isPending
                ? "bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-500/25 hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
                : "bg-slate-300 text-slate-500 cursor-not-allowed shadow-none",
            )}
          >
            <SendIcon className="h-4 w-4" aria-hidden="true" />
            <span>{send.isPending ? "Sending…" : "Send enquiry"}</span>
          </button>

          {send.isError && (
            <p className="text-xs font-semibold text-rose-600">
              Send failed: {send.error?.message || "unknown error"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function RaisedCaseNotice({ raisedQueryId, providerMessageId, paths }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 p-4 text-emerald-950 shadow-2xs space-y-1.5">
      <div className="flex items-center gap-2 font-bold text-emerald-950">
        <CheckCircle2Icon className="h-4.5 w-4.5 text-emerald-600" />
        <span>Enquiry raised successfully</span>
      </div>
      {raisedQueryId && (
        <p className="text-emerald-800">
          Your case is{" "}
          {paths.QUERY_DETAIL ? (
            <Link
              to={buildPath(paths.QUERY_DETAIL, { queryId: raisedQueryId })}
              className="font-bold text-emerald-950 underline hover:text-emerald-700"
            >
              {raisedQueryId}
            </Link>
          ) : (
            <span className="font-bold text-emerald-950">{raisedQueryId}</span>
          )}
          . It is already visible on your dashboard.
        </p>
      )}
      <p className="text-[11px] font-mono text-emerald-700 break-all pt-1">
        Message ID: {providerMessageId}
      </p>
    </div>
  );
}

const NEXT_STEPS = [
  {
    title: "Instant Query Creation:",
    text: "Your enquiry opens a Query Case straight away and is emailed to the IPC query mailbox.",
  },
  {
    title: "Verification & Processing:",
    text: "Front Office verifies it, then it is assigned, drafted, reviewed, approved, and dispatched back to you.",
  },
  {
    title: "Live Case Tracking:",
    text: "Track the case status live on your dashboard and receive reply updates by email once closed.",
  },
];

function NextStepsList() {
  return (
    <div className="space-y-4">
      {NEXT_STEPS.map((step, index) => (
        <div key={step.title} className="flex items-start gap-3">
          <div className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[11px] font-extrabold mt-0.5">
            {index + 1}
          </div>
          <p className="text-slate-600 leading-relaxed">
            <strong className="font-semibold text-slate-900">
              {step.title}
            </strong>{" "}
            {step.text}
          </p>
        </div>
      ))}
    </div>
  );
}

function WhatHappensNextCard({ send, raisedQueryId, paths }) {
  return (
    <div className="rounded-[20px] border border-slate-200/90 bg-white p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] space-y-5">
      <div className="flex items-center gap-2.5 pb-3.5 border-b border-slate-100">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600">
          <ClockIcon className="h-4.5 w-4.5" />
        </div>
        <h2 className="text-sm font-bold text-slate-900">What happens next</h2>
      </div>

      <div className="space-y-4 text-xs leading-relaxed text-slate-600">
        {send.isSuccess ? (
          <RaisedCaseNotice
            raisedQueryId={raisedQueryId}
            providerMessageId={send.data?.providerMessageId}
            paths={paths}
          />
        ) : (
          <NextStepsList />
        )}
      </div>
    </div>
  );
}

export function ComposeEnquiryPage() {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);
  const raiseEnquiry = useWorkflowStore((state) => state.raiseEnquiry);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pendingFiles, setPendingFiles] = useState([]);
  const [raisedQueryId, setRaisedQueryId] = useState(null);

  const config = useQuery({
    queryKey: ["emailConfig"],
    queryFn: fetchEmailConfig,
    retry: false,
  });

  const form = {
    subject,
    setSubject,
    body,
    setBody,
    pendingFiles,
    setPendingFiles,
  };

  const send = useSendEnquiry({
    form,
    config,
    currentUser,
    raiseEnquiry,
    onRaised: (queryId) => {
      setRaisedQueryId(queryId);
      setSubject("");
      setBody("");
      setPendingFiles([]);
    },
  });

  const from = config.data
    ? `${config.data.inquirer.name} <${config.data.inquirer.email}>`
    : "Loading…";
  const to = config.data?.ipcQueryEmail || "Loading…";
  const canSend =
    Boolean(config.data) &&
    subject.trim() !== "" &&
    body.trim() !== "" &&
    !hasBlockingErrors(pendingFiles);

  return (
    <div className="space-y-5">
      <Breadcrumb
        items={[
          { label: "Dashboard", path: paths.DASHBOARD },
          { label: "Raise Enquiry" },
        ]}
      />
      <PageHeader
        title="Raise Enquiry"
        purpose="Send an enquiry to the Indian Pharmacopoeia Commission query mailbox."
      />

      <TransportBanner config={config} from={from} to={to} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EnquiryFormCard
            from={from}
            to={to}
            form={form}
            send={send}
            canSend={canSend}
          />
        </div>

        <div>
          <WhatHappensNextCard
            send={send}
            raisedQueryId={raisedQueryId}
            paths={paths}
          />
        </div>
      </div>
    </div>
  );
}
