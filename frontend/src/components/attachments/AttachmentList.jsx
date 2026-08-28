import { useState } from 'react';
import { PaperclipIcon, DownloadIcon, EyeIcon } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { attachmentUrl } from '@/services/api/attachmentService';
import { formatFileSize } from '@/constants/attachmentPolicy';
import { AttachmentViewerDialog } from './AttachmentViewerDialog';

/**
 * Normalises both shapes an attachment record can arrive in:
 *  - current: `{attachmentId, filename, mimeType, size}` — real bytes exist.
 *  - legacy: `{id, name, sizeKb}` — pre-existing demo data / metadata-only
 *    records from before this feature, which carry no attachmentId and so
 *    can never be previewed or downloaded.
 */
function normalise(raw) {
  return {
    attachmentId: raw.attachmentId ?? null,
    filename: raw.filename ?? raw.name ?? 'attachment',
    mimeType: raw.mimeType ?? null,
    size: typeof raw.size === 'number' ? raw.size : typeof raw.sizeKb === 'number' ? raw.sizeKb * 1024 : null,
  };
}

export function AttachmentList({ attachments = [] }) {
  const [previewing, setPreviewing] = useState(null);

  if (attachments.length === 0) {
    return <EmptyState icon={PaperclipIcon} title="No attachments" />;
  }

  return (
    <>
      <ul className="space-y-2">
        {attachments.map((raw, index) => {
          const att = normalise(raw);
          return (
            <li
              key={att.attachmentId || `${att.filename}-${index}`}
              className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold"
            >
              <PaperclipIcon className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
              <span className="flex-1 min-w-0 text-slate-800 truncate">{att.filename}</span>
              {att.mimeType && (
                <span className="text-[11px] font-bold text-slate-400 uppercase shrink-0">
                  {att.mimeType.split('/')[1] || att.mimeType}
                </span>
              )}
              {att.size != null && (
                <span className="text-xs font-bold text-slate-400 shrink-0">{formatFileSize(att.size)}</span>
              )}
              {att.attachmentId ? (
                <span className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPreviewing(att)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-100 flex items-center gap-1 cursor-pointer"
                  >
                    <EyeIcon className="h-3.5 w-3.5" aria-hidden="true" /> Preview
                  </button>
                  <a
                    href={attachmentUrl(att.attachmentId, { download: true })}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-100 flex items-center gap-1"
                  >
                    <DownloadIcon className="h-3.5 w-3.5" aria-hidden="true" /> Download
                  </a>
                </span>
              ) : (
                <span className="text-[11px] font-medium text-slate-400 shrink-0">Preview unavailable</span>
              )}
            </li>
          );
        })}
      </ul>
      {previewing && <AttachmentViewerDialog attachment={previewing} onClose={() => setPreviewing(null)} />}
    </>
  );
}
