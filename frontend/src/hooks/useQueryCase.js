import { useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { canPerform } from '@/constants/workflowRules';
import { findUserById } from '@/constants/mockUsers';

export function useQueryCase() {
  const params = useParams();
  const queryId = params.queryId || null;
  const currentUser = useAuthStore((state) => state.currentUser);
  const query = useWorkflowStore((state) => state.queries.find((q) => q.queryId === queryId) || null);
  const allSteps = useWorkflowStore((state) => state.workflowSteps);
  const allVersions = useWorkflowStore((state) => state.responseVersions);
  const allReviews = useWorkflowStore((state) => state.reviews);
  const allAudit = useWorkflowStore((state) => state.auditEvents);
  const allMessages = useWorkflowStore((state) => state.emailMessages);

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
  const assignee = query?.currentAssigneeId ? findUserById(query.currentAssigneeId) : null;

  const can = useCallback(
    (action) => Boolean(query) && canPerform(currentUser?.role, action, query.workflowState),
    [query, currentUser?.role],
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
    }),
    [queryId, query, steps, reviews, versions, latestVersion, audit, messages, currentStep, assignee, currentUser, can],
  );
}
