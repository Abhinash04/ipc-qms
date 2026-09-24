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

export async function grantFinalApproval(queryId, { comment } = {}) {
  const { data } = await axiosClient.post(
    `/queries/${encodeURIComponent(queryId)}/final-approval`,
    { ...(comment ? { comment } : {}) },
  );
  return data;
}

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
