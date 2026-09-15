import { axiosClient } from './axiosClient';

/**
 * The Administration data API.
 *
 * Everything here is a persisted server-side record of something that actually
 * happened — GET /audit is backed by the audit collection, not by anything
 * derived in the browser. Case counts are deliberately NOT served from here;
 * they come from the client workflow store and are labelled as such in the UI.
 */

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
