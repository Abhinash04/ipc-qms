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

/** Re-checks the tamper-evident audit chain on the server. */
export async function verifyAuditChain() {
  const { data } = await axiosClient.get('/audit/verify');
  return data;
}

/**
 * Downloads the audit trail as CSV or PDF for the given filters and returns
 * the identifying digests the server attached to it.
 */
export async function downloadAuditReport(format, filters = {}) {
  const response = await axiosClient.get('/audit/export', {
    params: clean({ ...filters, format }),
    responseType: 'blob',
  });

  const disposition = response.headers['content-disposition'] || '';
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] || `audit-report.${format}`;

  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return {
    fileName,
    digest: response.headers['x-report-sha256'] || null,
    rows: Number(response.headers['x-report-rows'] || 0),
    truncated: response.headers['x-report-truncated'] === 'true',
    chainVerified: response.headers['x-chain-verified'] === 'true',
  };
}

export async function fetchAuditForQuery(queryId) {
  const { data } = await axiosClient.get(`/audit/query/${encodeURIComponent(queryId)}`);
  return data;
}
