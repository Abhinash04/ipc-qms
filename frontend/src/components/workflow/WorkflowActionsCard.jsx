import { useState } from "react";
import { Link } from "react-router-dom";
import { Lock, ArrowRight, Zap, ArrowRightLeft, RotateCcw } from "lucide-react";
import { useQueryCase } from "@/hooks/useQueryCase";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import {
  WORKFLOW_ACTION,
  CLARIFICATION_REQUIRED_ACTIONS,
} from "@/constants/workflowRules";
import { WORKFLOW_STATE } from "@/constants/statusEnums";
import { ROLES } from "@/constants/roles";
import { buildPath } from "@/constants/routePaths";
import { SECTION } from "@/constants/routeSections";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { useWorkflowAction } from "@/hooks/useWorkflowAction";
import { ActionError } from "@/components/workflow/ActionError";
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

/** One link per destination: several actions can lead to the same page. */
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

/**
 * Everything the card needs to decide what to offer: which buttons apply, where
 * they lead, and whether the user is left with nothing to do.
 */
function deriveCaseActions({ query, currentStep, currentUser, can, paths }) {
  const ownsCurrentStep =
    !currentStep?.assignedUserId ||
    currentStep.assignedUserId === currentUser?.id;

  const role = currentUser?.role;
  const isAdminRole = role === ROLES.ADMIN || role === ROLES.SUPER_ADMIN;
  const isCurrentAssignee =
    query.currentAssigneeId === currentUser?.id || role === ROLES.SUPER_ADMIN;

  const canVerify = can(WORKFLOW_ACTION.VERIFY);
  const canForward = can(WORKFLOW_ACTION.FORWARD);
  const canTransfer = can(WORKFLOW_ACTION.TRANSFER) && isCurrentAssignee;
  const canPullback = isAdminRole || can(WORKFLOW_ACTION.PULLBACK);

  const links = buildActionLinks(can, paths, ownsCurrentStep);

  return {
    canVerify,
    canForward,
    canTransfer,
    canPullback,
    links,
    isClosed: query.workflowState === WORKFLOW_STATE.CLOSED,
    hasNoActions:
      !canVerify &&
      !canForward &&
      !canTransfer &&
      !canPullback &&
      links.length === 0,
  };
}

/**
 * Verification registers the query even when the outgoing email fails, so the
 * two delivery failures are tracked separately and can each be retried.
 */
function useEmailDeliveryRetries(queryId, currentUser) {
  const validateAndForward = useWorkflowStore(
    (state) => state.validateAndForward,
  );
  const forwardToOic = useWorkflowStore((state) => state.forwardToOic);
  const acknowledgeInquirer = useWorkflowStore(
    (state) => state.acknowledgeInquirer,
  );

  const [ackError, setAckError] = useState(null);
  const [forwardError, setForwardError] = useState(null);
  const [retrying, setRetrying] = useState(false);

  const validate = async () => {
    setAckError(null);
    setForwardError(null);
    const result = await validateAndForward(queryId, currentUser);
    if (!result.acknowledged) {
      setAckError(result.acknowledgementError);
      notify.warning(
        "Acknowledgement email not sent",
        result.acknowledgementError,
      );
    }
    if (!result.forwarded) {
      setForwardError(result.forwardError);
      // Carries the "Missing attachment(s): …" text from the fail-closed
      // resolver, so the OIC never appears to have received an incomplete
      // forward without anyone being told.
      notify.error(
        "Forward to the Officer-in-Charge failed",
        result.forwardError,
      );
    }
  };

  const retryAcknowledgement = async () => {
    setRetrying(true);
    const result = await acknowledgeInquirer(queryId, currentUser);
    setRetrying(false);
    setAckError(result.acknowledged ? null : result.error);
    if (!result.acknowledged) {
      notify.warning("Acknowledgement email still not sent", result.error);
    }
  };

  const retryForward = async () => {
    setRetrying(true);
    try {
      await forwardToOic(queryId, currentUser);
      setForwardError(null);
    } catch (caught) {
      setForwardError(caught?.message || String(caught));
      notify.error("Forward to the Officer-in-Charge failed", caught);
    } finally {
      setRetrying(false);
    }
  };

  return {
    ackError,
    forwardError,
    retrying,
    validate,
    retryAcknowledgement,
    retryForward,
    forwardToOic,
  };
}

/**
 * The workflow step itself succeeded and only the email did not, so this is a
 * warning rather than the red "Action refused" banner.
 */
function EmailRetryNotice({
  title,
  description,
  retrying,
  busyLabel,
  idleLabel,
  onRetry,
}) {
  return (
    <div
      role="status"
      className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-900"
    >
      <p className="font-bold m-0">{title}</p>
      <p className="m-0 mt-0.5 text-[13px] font-medium text-amber-800">
        {description}
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="mt-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-1.5 text-[12.5px] font-extrabold transition-colors cursor-pointer disabled:opacity-60"
      >
        {retrying ? busyLabel : idleLabel}
      </button>
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

/** The actions this user can take on the case right now. */
function PrimaryActions({
  canVerify,
  canForward,
  canTransfer,
  canPullback,
  onValidate,
  onForward,
  onTransfer,
  onPullback,
}) {
  return (
    <>
      {canVerify && (
        <PrimaryActionButton
          onClick={onValidate}
          icon={Zap}
          className="bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20"
        >
          Validate Query
        </PrimaryActionButton>
      )}

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

/** Actions blocked pending a client decision, with the open questions. */
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
  const { run, error, clearError } = useWorkflowAction();
  const {
    ackError,
    forwardError,
    retrying,
    validate,
    retryAcknowledgement,
    retryForward,
    forwardToOic,
  } = useEmailDeliveryRetries(queryId, currentUser);

  const [showClarification, setShowClarification] = useState(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isPullbackModalOpen, setIsPullbackModalOpen] = useState(false);

  if (!query) return null;

  const {
    canVerify,
    canForward,
    canTransfer,
    canPullback,
    links,
    isClosed,
    hasNoActions,
  } = deriveCaseActions({ query, currentStep, currentUser, can, paths });

  const clarificationActions = Object.keys(CLARIFICATION_REQUIRED_ACTIONS);

  return (
    // No h-full: the card sizes to its actions rather than filling the row.
    <div className="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-sm select-none flex flex-col space-y-4">
      <div>
        <h2 className="font-heading text-[22px] font-black text-slate-900 m-0">
          Available actions
        </h2>
      </div>

      <div className="space-y-3">
        <ActionError message={error} onDismiss={clearError} />

        {ackError && (
          <EmailRetryNotice
            title="Acknowledgement email not sent"
            description={`The query is verified, but the inquirer was not emailed. ${ackError}`}
            retrying={retrying}
            busyLabel="Sending…"
            idleLabel="Retry sending"
            onRetry={retryAcknowledgement}
          />
        )}

        {forwardError && (
          <EmailRetryNotice
            title="Not forwarded to the Officer-in-Charge"
            description={`The query is registered, but the enquiry was not forwarded on. ${forwardError}`}
            retrying={retrying}
            busyLabel="Forwarding…"
            idleLabel="Retry forwarding"
            onRetry={retryForward}
          />
        )}

        {isClosed && !canPullback && (
          <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[15px] font-medium text-slate-500 leading-relaxed m-0">
            This query is closed. Its full audit history remains available
            below.
          </p>
        )}

        <PrimaryActions
          canVerify={canVerify}
          canForward={canForward}
          canTransfer={canTransfer}
          canPullback={canPullback}
          onValidate={() => run(validate)}
          onForward={() => run(() => forwardToOic(queryId, currentUser))}
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
