import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { cn } from "@/utils/cn";

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
  const send = useMutation({
    mutationFn: async () => {
      // Attachments upload first: a failed upload must block the send rather
      // than register a case that silently has no files.
      let attachments;
      if (pendingFiles.length > 0) {
        const uploaded = await uploadAttachments(pendingFiles.map((entry) => entry.file));
        attachments = uploaded;
      }

      const enquiryPayload = { subject: subject.trim(), body };
      if (attachments) enquiryPayload.attachments = attachments;
      const sent = await sendEnquiry(enquiryPayload);

      const raised = raiseEnquiry({
        subject: subject.trim(),
        body,
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
      setRaisedQueryId(result.queryId);
      setSubject("");
      setBody("");
      setPendingFiles([]);
    },
  });

  const from = config.data
    ? `${config.data.inquirer.name} <${config.data.inquirer.email}>`
    : "Loading…";
  const to = config.data?.ipcQueryEmail || "Loading…";
  const transport = config.data?.transport;
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

      {config.isError && (
        <div className="rounded-xl border border-red-200 bg-red-50/90 p-4 text-sm text-red-800 shadow-2xs flex items-start gap-3">
          <AlertCircleIcon className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-red-900">Backend unreachable</p>
            <p className="mt-0.5 text-red-700">
              Could not load the email configuration. Start the backend (npm
              start in /backend) and reload this page.
            </p>
          </div>
        </div>
      )}

      {transport === "mock" && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/90 p-4 text-sm text-blue-900 shadow-2xs flex items-start gap-3">
          <InfoIcon className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-blue-950">
              Mock transport active — no mail leaves this machine
            </p>
            <p className="mt-0.5 text-blue-800">
              The enquiry is delivered straight into the mock IPC mailbox ({to}
              ). Nothing is sent over the internet, and that address is a
              reserved test domain that cannot receive real mail.
            </p>
          </div>
        </div>
      )}

      {transport === "gmail" && (
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
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
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
                  Fill in the subject and message details to submit a new
                  enquiry case.
                </p>
              </div>
            </div>

            <div className="space-y-4.5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label
                    htmlFor="enquiry-from"
                    className="text-[11.5px] font-bold text-slate-600 uppercase tracking-wider"
                  >
                    From
                  </label>
                  <div className="relative">
                    <input
                      id="enquiry-from"
                      value={from}
                      readOnly
                      className="w-full rounded-xl border border-slate-200/90 bg-slate-50/90 px-3.5 py-2.5 text-xs font-mono font-medium text-slate-700 shadow-2xs focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="enquiry-to"
                    className="text-[11.5px] font-bold text-slate-600 uppercase tracking-wider"
                  >
                    To
                  </label>
                  <div className="relative">
                    <input
                      id="enquiry-to"
                      value={to}
                      readOnly
                      className="w-full rounded-xl border border-slate-200/90 bg-slate-50/90 px-3.5 py-2.5 text-xs font-mono font-medium text-slate-700 shadow-2xs focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="enquiry-subject"
                  className="text-[11.5px] font-bold text-slate-600 uppercase tracking-wider"
                >
                  Subject
                </label>
                <input
                  id="enquiry-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Clarification regarding submission requirements…"
                  className="w-full rounded-xl border border-slate-200/90 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 shadow-2xs transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="enquiry-body"
                  className="text-[11.5px] font-bold text-slate-600 uppercase tracking-wider"
                >
                  Message
                </label>
                <textarea
                  id="enquiry-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                  className="w-full rounded-xl border border-slate-200/90 bg-white p-3.5 text-sm font-normal leading-relaxed text-slate-900 placeholder:text-slate-400 shadow-2xs transition-all resize-none focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="Dear Sir/Madam,&#10;&#10;I am writing to seek clarification regarding…"
                />
              </div>

              <AttachmentPicker
                files={pendingFiles}
                onChange={setPendingFiles}
                disabled={send.isPending}
              />

              <div className="pt-2 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => send.mutate()}
                  disabled={!canSend || send.isPending}
                  className={cn(
                    "inline-flex items-center justify-center gap-2 rounded-xl px-6.5 py-3 text-sm font-bold text-white transition-all duration-200 shadow-md",
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
        </div>

        {/* Right Info Container */}
        <div>
          <div className="rounded-[20px] border border-slate-200/90 bg-white p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] space-y-5">
            <div className="flex items-center gap-2.5 pb-3.5 border-b border-slate-100">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600">
                <ClockIcon className="h-4.5 w-4.5" />
              </div>
              <h2 className="text-sm font-bold text-slate-900">
                What happens next
              </h2>
            </div>

            <div className="space-y-4 text-xs leading-relaxed text-slate-600">
              {send.isSuccess ? (
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
                          to={buildPath(paths.QUERY_DETAIL, {
                            queryId: raisedQueryId,
                          })}
                          className="font-bold text-emerald-950 underline hover:text-emerald-700"
                        >
                          {raisedQueryId}
                        </Link>
                      ) : (
                        <span className="font-bold text-emerald-950">
                          {raisedQueryId}
                        </span>
                      )}
                      . It is already visible on your dashboard.
                    </p>
                  )}
                  <p className="text-[11px] font-mono text-emerald-700 break-all pt-1">
                    Message ID: {send.data?.providerMessageId}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[11px] font-extrabold mt-0.5">
                      1
                    </div>
                    <p className="text-slate-600 leading-relaxed">
                      <strong className="font-semibold text-slate-900">
                        Instant Query Creation:
                      </strong>{" "}
                      Your enquiry opens a Query Case straight away and is
                      emailed to the IPC query mailbox.
                    </p>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[11px] font-extrabold mt-0.5">
                      2
                    </div>
                    <p className="text-slate-600 leading-relaxed">
                      <strong className="font-semibold text-slate-900">
                        Verification & Processing:
                      </strong>{" "}
                      Front Office verifies it, then it is assigned, drafted,
                      reviewed, approved, and dispatched back to you.
                    </p>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[11px] font-extrabold mt-0.5">
                      3
                    </div>
                    <p className="text-slate-600 leading-relaxed">
                      <strong className="font-semibold text-slate-900">
                        Live Case Tracking:
                      </strong>{" "}
                      Track the case status live on your dashboard and receive
                      reply updates by email once closed.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
