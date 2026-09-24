import { axiosClient } from './axiosClient';

export function attachmentUrl(attachmentId, { download = false } = {}) {
  const base = (axiosClient.defaults.baseURL || '').replace(/\/$/, '');
  return `${base}/attachments/${attachmentId}${download ? '?download=1' : ''}`;
}

export async function fetchAttachmentMeta(attachmentId) {
  const { data } = await axiosClient.get(`/attachments/${attachmentId}/meta`);
  return data;
}
