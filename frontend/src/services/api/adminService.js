import { axiosClient } from './axiosClient';

const clean = (params) =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== ''));

export async function fetchAuditEvents(filters = {}) {
  const { data } = await axiosClient.get('/audit', { params: clean(filters) });
  return data;
}

export async function fetchAuditSummary(filters = {}) {
  const { data } = await axiosClient.get('/audit/summary', { params: clean(filters) });
  return data;
}

export async function fetchAuditForQuery(queryId) {
  const { data } = await axiosClient.get(`/audit/query/${encodeURIComponent(queryId)}`);
  return data;
}
