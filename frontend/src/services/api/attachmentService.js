import { axiosClient } from './axiosClient';

/**
 * Reading attachments, which is all the app does with them.
 *
 * There is no upload here any more. `uploadAttachments` existed for the enquiry
 * form's file picker, and both went with the in-app enquiry portal: an enquiry
 * arrives as email, and the server fetches its attachments from the mailbox
 * itself. `POST /attachments` still exists on the backend — mail ingestion writes
 * through the same store, and it is the seam a future "attach a file to the
 * response" would use — but nothing in this browser calls it.
 */

/** Byte URL for an attachment — inline preview by default, `?download=1` forces a download. */
export function attachmentUrl(attachmentId, { download = false } = {}) {
  const base = (axiosClient.defaults.baseURL || '').replace(/\/$/, '');
  return `${base}/attachments/${attachmentId}${download ? '?download=1' : ''}`;
}

export async function fetchAttachmentMeta(attachmentId) {
  const { data } = await axiosClient.get(`/attachments/${attachmentId}/meta`);
  return data;
}
