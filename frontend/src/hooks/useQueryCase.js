import { useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { canPerform } from '@/constants/workflowRules';
import { findUserById } from '@/constants/mockUsers';
import { SEED_QUERY_ID } from '@/constants/mockDomain';

/**
 * Everything a stage page needs about the current query, read from the single
 * workflow store — so no page keeps its own copy of workflow state.
 *
 * IMPORTANT: selectors below must return *stable references*. Zustand v5 hands
 * the selector result straight to `useSyncExternalStore`, which compares
 * snapshots with `Object.is` — so a selector that calls `.filter()`/`.sort()`
 * allocates a new array on every call and sends React into an infinite render
 * loop ("The result of getSnapshot should be cached"). Select the raw slice
 * and derive with `useMemo` here instead. `.find()` is safe: it returns an
 * existing element reference.
 *
 * Falls back to the seed query id when the route has no :queryId, keeping the
 * demo navigable.
 */
export function useQueryCase() {
  const params = useParams();
  const queryId = params.queryId || SEED_QUERY_ID;

  const currentUser = useAuthStore((state) => state.currentUser);

  // `.find` returns an existing element reference — stable, safe as a selector.
  const query = useWorkflowStore((state) => state.queries.find((q) => q.queryId === queryId) || null);

  // Raw slices: the store's own array references, stable until that slice changes.
  const allSteps = useWorkflowStore((state) => state.workflowSteps);
  const allVersions = useWorkflowStore((state) => state.responseVersions);
  const allReviews = useWorkflowStore((state) => state.reviews);
  const allAudit = useWorkflowStore((state) => state.auditEvents);

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

  const currentStep = useMemo(
    () =>
      query?.currentWorkflowStepId
        ? steps.find((s) => s.stepId === query.currentWorkflowStepId) || null
        : null,
    [query, steps],
  );

  const latestVersion = versions.length ? versions[versions.length - 1] : null;
  const assignee = query?.currentAssigneeId ? findUserById(query.currentAssigneeId) : null;

  /** Can the signed-in user perform `action` given the query's current state? */
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
      currentStep,
      assignee,
      currentUser,
      can,
    }),
    [queryId, query, steps, reviews, versions, latestVersion, audit, currentStep, assignee, currentUser, can],
  );
}
