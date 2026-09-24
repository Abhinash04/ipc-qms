import { useState } from "react";
import { Link } from "react-router-dom";
import { Lock, ArrowRight, ArrowRightLeft, RotateCcw } from "lucide-react";
import { useQueryCase } from "@/hooks/useQueryCase";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import {
  WORKFLOW_ACTION,
  CLARIFICATION_REQUIRED_ACTIONS,
} from "@/constants/workflowRules";
import { WORKFLOW_STATE } from "@/constants/statusEnums";
import { EMAIL_TYPE } from "@/constants/emailModel";
import { ROLES } from "@/constants/roles";
import { buildPath } from "@/constants/routePaths";
import { SECTION } from "@/constants/routeSections";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { TransferQueryModal } from "@/components/workflow/TransferQueryModal";
import { PullbackQueryModal } from "@/components/workflow/PullbackQueryModal";
import { notify } from "@/services/notify";

const ACTION_SECTIONS = {
  [WORKFLOW_ACTION.ASSIGN]: SECTION.ASSIGNMENT_DETAIL,
  [WORKFLOW_ACTION.GENERATE_AI_DRAFT]: SECTION.DRAFTING_DETAIL,
  [WORKFLOW_ACTION.SAVE_DRAFT]: SECTION.DRAFTING_DETAIL,
  [WORKFLOW_ACTION.SUBMIT_FOR_REVIEW]: SECTION.DRAFTING_DETAIL,
  [WORKFLOW_ACTION.APPROVE_REVIEW]: SECTION.REVIEW_DETAIL,
  [WORKFLOW_ACTION.REQUEST_REVISION]: SECTION.REVIEW_DETAIL,
  [WORKFLOW_ACTION.FINAL_APPROVE]: SECTION.APPROVAL_DETAIL,
  [WORKFLOW_ACTION.DISPATCH]: SECTION.DISPATCH_DETAIL,
};

const ACTION_LABELS = {
  [WORKFLOW_ACTION.ASSIGN]: "Assign query",
  [WORKFLOW_ACTION.GENERATE_AI_DRAFT]: "Start drafting",
  [WORKFLOW_ACTION.SUBMIT_FOR_REVIEW]: "Continue drafting",
  [WORKFLOW_ACTION.APPROVE_REVIEW]: "Review draft",
  [WORKFLOW_ACTION.FINAL_APPROVE]: "Final approval",
  [WORKFLOW_ACTION.DISPATCH]: "Dispatch response",
};

const STEP_OWNED_ACTIONS = [
  WORKFLOW_ACTION.APPROVE_REVIEW,
  WORKFLOW_ACTION.REQUEST_REVISION,
];

function buildActionLinks(can, paths, ownsCurrentStep) {
  const seen = new Set();
  const links = [];

  for (const [action, section] of Object.entries(ACTION_SECTIONS)) {
    if (!can(action) || !ACTION_LABELS[action] || !paths[section]) continue;
    if (STEP_OWNED_ACTIONS.includes(action) && !ownsCurrentStep) continue;
    if (seen.has(paths[section])) continue;

    seen.add(paths[section]);
    links.push({ action, path: paths[section], label: ACTION_LABELS[action] });
  }

  return links;
}

function deriveCaseActions({ query, currentStep, currentUser, can, paths }) {
  const ownsCurrentStep =
    !currentStep?.assignedUserId ||
    currentStep.assignedUserId === currentUser?.id;

  const role = currentUser?.role;
  const isAdminRole = role === ROLES.ADMIN || role === ROLES.SUPER_ADMIN;
  const isCurrentAssignee =
    query.currentAssigneeId === currentUser?.id || role === ROLES.SUPER_ADMIN;

  const canForward = can(WORKFLOW_ACTION.FORWARD);
  const canTransfer = can(WORKFLOW_ACTION.TRANSFER) && isCurrentAssignee;
  const canPullback = isAdminRole || can(WORKFLOW_ACTION.PULLBACK);

  const links = buildActionLinks(can, paths, ownsCurrentStep);

  return {
    canForward,
    canTransfer,
    canPullback,
    links,
    isClosed: query.workflowState === WORKFLOW_STATE.CLOSED,
    hasNoActions:
      !canForward && !canTransfer && !canPullback && links.length === 0,
  };
}

function useEmailDeliveryRetries(queryId, currentUser, query) {
  const forwardToOic = useWorkflowStore((state) => state.forwardToOic);
  const acknowledgeInquirer = useWorkflowStore(
    (state) => state.acknowledgeInquirer,
  );
  const resolveOutboundEmail = useWorkflowStore(
    (state) => state.resolveOutboundEmail,
  );
  const emailMessages = useWorkflowStore((state) => state.emailMessages);
  const outboundEmails = useWorkflowStore((state) => state.outboundEmails);

  const [retryError, setRetryError] = useState(null);
  const [forwardFailure, setForwardFailure] = useState(null);
  const [retrying, setRetrying] = useState(false);

  const statusOf = (emailType) =>
    outboundEmails.find((row) => row.queryId === queryId && row.emailType === emailType) || null;

  const ackDispatch = statusOf(EMAIL_TYPE.ACKNOWLEDGEMENT);
  const forwardDispatch = statusOf(EMAIL_TYPE.FORWARD);
  const ackUncertain = ackDispatch?.status === 'UNCERTAIN';
  const forwardUncertain = forwardDispatch?.status === 'UNCERTAIN';

  const acknowledged = emailMessages.some(
    (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT,
  );
  const registered = query && query.workflowState !== WORKFLOW_STATE.RECEIVED;
  const ackError =
    retryError ||
    (ackUncertain || ackDispatch?.status === 'FAILED' ? ackDispatch.lastError : null) ||
    (registered && !acknowledged
      ? "The inquirer has not been told their query was received."
      : null);

  const forwarded = emailMessages.some(
    (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.FORWARD,
  );
  const forwardError =
    forwardFailure ||
    (forwardUncertain ? forwardDispatch.lastError : null) ||
    (query?.workflowState === WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION && !forwarded
      ? "The Officer-in-Charge has not received this case."
      : null);

  const askForAcknowledgement = async () => {
    const result = await acknowledgeInquirer(queryId, currentUser);
    setRetryError(result.acknowledged ? null : result.error);

    if (!result.acknowledged) {
      notify.warning(
        result.unconfirmed ? "Acknowledgement not confirmed" : "Acknowledgement email still not sent",
        result.error,
      );
    }
    return result;
  };

  const retryAcknowledgement = async () => {
    setRetrying(true);
    try {
      await askForAcknowledgement();
    } finally {
      setRetrying(false);
    }
  };

  const resolveAcknowledgement = async (outcome) => {
    setRetrying(true);
    try {
      await resolveOutboundEmail(queryId, { emailType: EMAIL_TYPE.ACKNOWLEDGEMENT, outcome });
      setRetryError(null);
      if (outcome === "NOT_SENT") await askForAcknowledgement();
    } catch (caught) {
      notify.error("Could not record what happened to the acknowledgement", caught);
    } finally {
      setRetrying(false);
    }
  };

  const resolveForward = async (outcome) => {
    setRetrying(true);
    try {
      await resolveOutboundEmail(queryId, { emailType: EMAIL_TYPE.FORWARD, outcome });
      setForwardFailure(null);
      if (outcome === "NOT_SENT") await forwardToOic(queryId, currentUser);
    } catch (caught) {
      notify.error("Could not record what happened to the forward", caught);
    } finally {
      setRetrying(false);
    }
  };

  const forward = async () => {
    setForwardFailure(null);
    try {
      await forwardToOic(queryId, currentUser);
    } catch (caught) {
      setForwardFailure(caught?.message || String(caught));
      notify.error("Forward to the Officer-in-Charge failed", caught);
    }
  };

  const retryForward = async () => {
    setRetrying(true);
    try {
      await forwardToOic(queryId, currentUser);
      setForwardFailure(null);
    } catch (caught) {
      setForwardFailure(caught?.message || String(caught));
      notify.error("Forward to the Officer-in-Charge failed", caught);
    } finally {
      setRetrying(false);
    }
  };

  return {
    ackError,
    ackUncertain,
    forwardError,
    forwardUncertain,
    retrying,
    forward,
    retryAcknowledgement,
    resolveAcknowledgement,
    retryForward,
    resolveForward,
  };
}

function EmailRetryNotice({
  title,
  description,
  retrying,
  busyLabel,
  idleLabel,
  onRetry,
  uncertain = false,
  onResolve = null,
  urgent = false,
}) {
  const action =
    "rounded-xl px-3.5 py-1.5 text-[12.5px] font-extrabold transition-colors cursor-pointer disabled:opacity-60";

  return (
    <div
      role={urgent ? "alert" : "status"}
      className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-900"
    >
      <p className="font-bold m-0">{title}</p>
      <p className="m-0 mt-0.5 text-[13px] font-medium text-amber-800">
        {description}
      </p>

      {uncertain && onResolve ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onResolve("SENT")}
            disabled={retrying}
            className={`${action} bg-amber-600 hover:bg-amber-700 text-white`}
          >
            It was sent
          </button>
          <button
            type="button"
            onClick={() => onResolve("NOT_SENT")}
            disabled={retrying}
            className={`${action} border border-amber-300 bg-white hover:bg-amber-100 text-amber-900`}
          >
            {retrying ? busyLabel : "It was not sent — send it"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className={`mt-2 ${action} bg-amber-600 hover:bg-amber-700 text-white`}
        >
          {retrying ? busyLabel : idleLabel}
        </button>
      )}
    </div>
  );
}

function PrimaryActionButton({
  onClick,
  className,
  icon: Icon,
  iconClassName,
  children,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full py-3 px-4 rounded-2xl font-extrabold text-[16px] transition-colors cursor-pointer flex items-center justify-center gap-2 ${className}`}
    >
      <Icon className={iconClassName || "h-4 w-4"} />
      <span>{children}</span>
    </button>
  );
}

function PrimaryActions({
  canForward,
  canTransfer,
  canPullback,
  onForward,
  onTransfer,
  onPullback,
}) {
  return (
    <>
      {canForward && (
        <PrimaryActionButton
          onClick={onForward}
          icon={ArrowRight}
          className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-500/20"
        >
          Forward to Officer-in-Charge
        </PrimaryActionButton>
      )}

      {canTransfer && (
        <PrimaryActionButton
          onClick={onTransfer}
          icon={ArrowRightLeft}
          className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 shadow-2xs"
        >
          Transfer Query
        </PrimaryActionButton>
      )}

      {canPullback && (
        <PrimaryActionButton
          onClick={onPullback}
          icon={RotateCcw}
          iconClassName="h-4 w-4 text-amber-700"
          className="bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300/80 shadow-2xs"
        >
          Pullback Query
        </PrimaryActionButton>
      )}
    </>
  );
}

function ActionLinks({ links, queryId }) {
  return links.map((link) => (
    <Link
      key={link.path}
      to={buildPath(link.path, { queryId })}
      className="block"
    >
      <button
        type="button"
        className="w-full py-3 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold text-[16px] transition-colors cursor-pointer flex items-center justify-center gap-2"
      >
        <span>{link.label}</span>
        <ArrowRight className="h-4 w-4 text-slate-400" />
      </button>
    </Link>
  ));
}

function ClarificationList({ actions, openAction, onToggle }) {
  if (actions.length === 0) return null;

  return (
    <div className="space-y-2 pt-3 border-t border-slate-100">
      {actions.map((action) => (
        <div key={action}>
          <button
            type="button"
            onClick={() => onToggle(action)}
            className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-[15px] border border-slate-200/60 transition-colors cursor-pointer"
          >
            <Lock className="h-4 w-4 text-slate-400 shrink-0" />
            <span>{CLARIFICATION_REQUIRED_ACTIONS[action].label}</span>
          </button>
          {openAction === action && (
            <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50/90 p-3.5 text-[14px] font-medium text-amber-900 space-y-1.5">
              <p className="font-bold text-[14.5px] text-amber-950">
                Client clarification required before this can be enabled:
              </p>
              <ul className="list-disc space-y-1 pl-4 text-amber-900/90">
                {CLARIFICATION_REQUIRED_ACTIONS[action].openQuestions.map(
                  (q) => (
                    <li key={q}>{q}</li>
                  ),
                )}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function WorkflowActionsCard() {
  const { queryId, query, currentStep, currentUser, can } = useQueryCase();
  const paths = useRoutePaths();
  const {
    ackError,
    ackUncertain,
    forwardError,
    forwardUncertain,
    retrying,
    forward,
    retryAcknowledgement,
    resolveAcknowledgement,
    retryForward,
    resolveForward,
  } = useEmailDeliveryRetries(queryId, currentUser, query);

  const [showClarification, setShowClarification] = useState(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isPullbackModalOpen, setIsPullbackModalOpen] = useState(false);

  if (!query) return null;

  const { canForward, canTransfer, canPullback, links, isClosed, hasNoActions } =
    deriveCaseActions({ query, currentStep, currentUser, can, paths });

  const clarificationActions = Object.keys(CLARIFICATION_REQUIRED_ACTIONS);

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-sm select-none flex flex-col space-y-4">
      <div>
        <h2 className="font-heading text-[22px] font-black text-slate-900 m-0">
          Available actions
        </h2>
      </div>

      <div className="space-y-3">

        {ackError && (
          <EmailRetryNotice
            title={
              ackUncertain
                ? "Acknowledgement may already have been sent"
                : "Acknowledgement email not sent"
            }
            description={
              ackUncertain
                ? `The case is registered. The inquirer may or may not have been emailed — check the Sent folder and say what is there. ${ackError}`
                : `The case is registered, but the inquirer was not emailed. ${ackError}`
            }
            retrying={retrying}
            busyLabel="Sending…"
            idleLabel="Retry sending"
            onRetry={retryAcknowledgement}
            uncertain={ackUncertain}
            onResolve={resolveAcknowledgement}
          />
        )}

        {forwardError && (
          <EmailRetryNotice
            urgent
            title={
              forwardUncertain
                ? "The forward may already have been sent"
                : "Not forwarded to the Officer-in-Charge"
            }
            description={
              forwardUncertain
                ? `The Officer-in-Charge may or may not have received this case — check the Sent folder and say what is there. ${forwardError}`
                : `The query is registered, but the enquiry was not forwarded on. ${forwardError}`
            }
            retrying={retrying}
            busyLabel="Forwarding…"
            idleLabel="Retry forwarding"
            onRetry={retryForward}
            uncertain={forwardUncertain}
            onResolve={resolveForward}
          />
        )}

        {isClosed && !canPullback && (
          <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[15px] font-medium text-slate-500 leading-relaxed m-0">
            This query is closed. Its full audit history remains available
            below.
          </p>
        )}

        <PrimaryActions
          canForward={canForward}
          canTransfer={canTransfer}
          canPullback={canPullback}
          onForward={forward}
          onTransfer={() => setIsTransferModalOpen(true)}
          onPullback={() => setIsPullbackModalOpen(true)}
        />

        <ActionLinks links={links} queryId={queryId} />

        {!isClosed && hasNoActions && (
          <div className="rounded-2xl border border-slate-200/90 bg-slate-50/80 p-4 text-[15px] font-medium text-slate-500 leading-relaxed">
            No actions available to you at this stage.
          </div>
        )}

        <ClarificationList
          actions={clarificationActions}
          openAction={showClarification}
          onToggle={(action) =>
            setShowClarification(showClarification === action ? null : action)
          }
        />
      </div>

      <TransferQueryModal
        query={query}
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        currentUser={currentUser}
      />

      <PullbackQueryModal
        query={query}
        isOpen={isPullbackModalOpen}
        onClose={() => setIsPullbackModalOpen(false)}
        currentUser={currentUser}
      />
    </div>
  );
}
