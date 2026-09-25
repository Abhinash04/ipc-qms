import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { useAuthStore } from "@/store/useAuthStore";
import {
  canPerform,
  ASSIGNEE_ONLY_ACTIONS,
  isCaseAssignee,
} from "@/constants/workflowRules";
import { findUserById } from "@/constants/mockUsers";

export function useQueryCase() {
  const params = useParams();
  const queryId = params.queryId || null;
  const currentUser = useAuthStore((state) => state.currentUser);
  const query = useWorkflowStore(
    (state) => state.queries.find((q) => q.queryId === queryId) || null,
  );
  const allSteps = useWorkflowStore((state) => state.workflowSteps);
  const allVersions = useWorkflowStore((state) => state.responseVersions);
  const allReviews = useWorkflowStore((state) => state.reviews);
  const allAudit = useWorkflowStore((state) => state.auditEvents);
  const allMessages = useWorkflowStore((state) => state.emailMessages);
  const [checkedId, setCheckedId] = useState(null);
  const missing = Boolean(queryId) && !query;

  useEffect(() => {
    if (!missing || checkedId === queryId) return undefined;
    let live = true;
    useWorkflowStore
      .getState()
      .revalidate()
      .finally(() => {
        if (live) setCheckedId(queryId);
      });
    return () => {
      live = false;
    };
  }, [missing, checkedId, queryId]);

  const resolving = missing && checkedId !== queryId;

  const steps = useMemo(
    () =>
      allSteps
        .filter((s) => s.queryId === queryId)
        .sort((a, b) => a.sequence - b.sequence),
    [allSteps, queryId],
  );

  const versions = useMemo(
    () => allVersions.filter((v) => v.queryId === queryId),
    [allVersions, queryId],
  );

  const reviews = useMemo(
    () => allReviews.filter((r) => r.queryId === queryId),
    [allReviews, queryId],
  );

  const audit = useMemo(
    () =>
      allAudit
        .filter((a) => a.queryId === queryId)
        .sort((a, b) => new Date(a.at) - new Date(b.at)),
    [allAudit, queryId],
  );

  const messages = useMemo(
    () => allMessages.filter((m) => m.queryId === queryId),
    [allMessages, queryId],
  );

  const currentStep = useMemo(
    () =>
      query?.currentWorkflowStepId
        ? steps.find((s) => s.stepId === query.currentWorkflowStepId) || null
        : null,
    [query, steps],
  );

  const latestVersion = versions.length ? versions[versions.length - 1] : null;
  const assignee = query?.currentAssigneeId
    ? findUserById(query.currentAssigneeId)
    : null;

  const can = useCallback(
    (action) =>
      Boolean(query) &&
      canPerform(currentUser?.role, action, query.workflowState) &&
      (!ASSIGNEE_ONLY_ACTIONS.includes(action) || isCaseAssignee(currentUser, query)),
    [query, currentUser],
  );

  return useMemo(
    () => ({
      queryId,
      query,
      steps,
      reviews,
      versions,
      latestVersion,
      audit,
      messages,
      currentStep,
      assignee,
      currentUser,
      can,
      resolving,
    }),
    [
      queryId,
      query,
      steps,
      reviews,
      versions,
      latestVersion,
      audit,
      messages,
      currentStep,
      assignee,
      currentUser,
      can,
      resolving,
    ],
  );
}
