import { axiosClient } from './axiosClient';

export async function fetchAllQueries() {
  const { data } = await axiosClient.get('/queries');
  return data;
}

export async function checkQueriesEmpty() {
  const { data } = await axiosClient.get('/queries/is-empty');
  return Boolean(data.isEmpty);
}

export async function persistQueryTransition(delta) {
  const { data } = await axiosClient.post('/queries/persist', delta);
  return data;
}

/**
 * Grant final approval, and let the server answer the inquirer.
 *
 * The browser used to do both halves: record the approval locally, then call
 * `/emails/response` itself. That second call went out from the Officer-in-
 * Charge's session, and sending is a Front Office permission — so every
 * approval ended in a 403 and the case stranded, approved but unanswered. The
 * server holds the Front Office identity and does the send itself.
 *
 * Resolves to `{ queryId, approved, dispatched, alreadyDispatched,
 * workflowState, recipient, errors }`. A failed send is reported, not thrown:
 * the approval still stands and the case stays retryable.
 */
export async function grantFinalApproval(queryId, { comment } = {}) {
  const { data } = await axiosClient.post(
    `/queries/${encodeURIComponent(queryId)}/final-approval`,
    { ...(comment ? { comment } : {}) },
  );
  return data;
}

/**
 * Record what a person found in the Sent folder, for an email whose send the
 * server could not verify.
 *
 * `SENT` records it exactly as a successful send would — for a final response
 * that also closes the case. `NOT_SENT` makes it an ordinary failure, which the
 * retry buttons can send again. Nothing is emailed by this call.
 */
export async function resolveOutboundEmail(queryId, { emailType, outcome }) {
  const { data } = await axiosClient.post(
    `/queries/${encodeURIComponent(queryId)}/outbound/resolve`,
    { emailType, outcome },
  );
  return data;
}

export async function resetQueries(seedState) {
  const { data } = await axiosClient.post('/queries/reset', seedState);
  return data;
}
