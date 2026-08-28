import { axiosClient } from './axiosClient';

/**
 * Uploads one or more files and returns their stored metadata records
 * (`{attachmentId, filename, mimeType, size}` each) — never bytes back.
 */
export async function uploadAttachments(files, { onUploadProgress } = {}) {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));

  const { data } = await axiosClient.post('/attachments', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress,
  });
  return data.attachments;
}

/** Byte URL for an attachment — inline preview by default, `?download=1` forces a download. */
export function attachmentUrl(attachmentId, { download = false } = {}) {
  const base = (axiosClient.defaults.baseURL || '').replace(/\/$/, '');
  return `${base}/attachments/${attachmentId}${download ? '?download=1' : ''}`;
}

export async function fetchAttachmentMeta(attachmentId) {
  const { data } = await axiosClient.get(`/attachments/${attachmentId}/meta`);
  return data;
}
