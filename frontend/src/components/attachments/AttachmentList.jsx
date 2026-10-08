import { useState } from 'react';
import { PaperclipIcon, DownloadIcon, EyeIcon } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { stableKey } from '@/utils/stableKey';
import { attachmentUrl } from '@/services/api/attachmentService';
import { formatFileSize } from '@/constants/attachmentPolicy';
import { cn } from '@/utils/cn';
import { AttachmentViewerDialog } from './AttachmentViewerDialog';
import { fileTypeOf } from './fileType';
const SCROLL_AFTER = 6;

function normalise(raw) {
  return {
    attachmentId: raw.attachmentId ?? null,
    filename: raw.filename ?? raw.name ?? 'attachment',
    mimeType: raw.mimeType ?? null,
    size: typeof raw.size === 'number' ? raw.size : typeof raw.sizeKb === 'number' ? raw.sizeKb * 1024 : null,
    uploadedBy: raw.uploadedByName ?? raw.uploadedBy ?? null,
    uploadedAt: raw.uploadedAt ?? raw.createdAt ?? null,
  };
}

const describesAFile = (raw) => Boolean(raw) && Boolean(raw.attachmentId || raw.id || raw.filename || raw.name);

const BUTTON =
  'inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-card px-2.5 py-1 text-[12px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const uploadedLine = (att) =>
  [
    att.uploadedBy && `Uploaded by ${att.uploadedBy}`,
    att.uploadedAt && new Date(att.uploadedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
  ]
    .filter(Boolean)
    .join(' • ');

function FileActions({ raw, att, urlFor, onPreview, className }) {
  if (att.attachmentId) {
    return (
      <span className={cn('flex shrink-0 items-center gap-1.5', className)}>
        <button type="button" onClick={() => onPreview(att)} className={BUTTON}>
          <EyeIcon className="h-3.5 w-3.5" aria-hidden="true" /> Preview
        </button>
        <a href={urlFor ? urlFor(att.attachmentId) : attachmentUrl(att.attachmentId, { download: true })} className={BUTTON}>
          <DownloadIcon className="h-3.5 w-3.5" aria-hidden="true" /> Download
        </a>
      </span>
    );
  }
  if (raw.materializeError) {
    return <span className={cn('shrink-0 text-[11.5px] font-medium text-rose-600', className)}>Unavailable: {raw.materializeError}</span>;
  }
  return <span className={cn('shrink-0 text-[11.5px] font-medium text-slate-400', className)}>Preview unavailable</span>;
}

function FileRow({ raw, att, type, ...actions }) {
  const uploaded = uploadedLine(att);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 transition-colors hover:bg-slate-50/70">
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1', type.tone)} aria-hidden="true">
        <type.Icon className="h-4.5 w-4.5" />
      </span>

      <div className="min-w-0 flex-1 basis-48">
        <p className="m-0 truncate text-[13.5px] font-semibold text-slate-900" title={att.filename}>
          {att.filename}
        </p>
        <p className="m-0 text-[12px] text-slate-500">
          {att.size != null && <span>{formatFileSize(att.size)}</span>}
          {att.size != null && ' • '}
          <span>{type.label}</span>
          {uploaded && <span className="text-slate-400"> · {uploaded}</span>}
        </p>
      </div>

      <FileActions raw={raw} att={att} {...actions} />
    </li>
  );
}

function FileTile({ raw, att, type, ...actions }) {
  const uploaded = uploadedLine(att);
  return (
    <li className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-card transition-colors hover:border-slate-300 hover:shadow-xs">
      <div className={cn('relative flex h-24 items-center justify-center', type.tone)} aria-hidden="true">
        <type.Icon className="h-10 w-10 opacity-80 transition-transform group-hover:scale-105" strokeWidth={1.5} />
        <span className="absolute end-2 top-2 rounded-md bg-card/80 px-1.5 py-0.5 text-[10.5px] font-bold tracking-wide">
          {type.label}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="m-0 truncate text-[13.5px] font-semibold text-slate-900" title={att.filename}>
          {att.filename}
        </p>
        <p className="m-0 text-[12px] text-slate-500">
          {att.size != null ? <span>{formatFileSize(att.size)}</span> : <span>Size unknown</span>}
          {uploaded && <span className="text-slate-400"> · {uploaded}</span>}
        </p>
        <FileActions raw={raw} att={att} {...actions} className="mt-auto pt-2" />
      </div>
    </li>
  );
}


export function AttachmentList({ attachments = [], urlFor, emptyDescription, layout = 'list' }) {
  const [previewing, setPreviewing] = useState(null);
  const real = attachments.filter(describesAFile);

  if (real.length === 0) {
    return <EmptyState icon={PaperclipIcon} title="No attachments" description={emptyDescription} />;
  }

  const grid = layout === 'grid';

  return (
    <>
      <ul
        className={cn(
          'm-0 list-none p-0',
          grid
            ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'
            : 'divide-y divide-slate-200/70 rounded-xl border border-slate-200',
          real.length > SCROLL_AFTER && 'max-h-[26rem] overflow-y-auto',
        )}
      >
        {real.map((raw) => {
          const att = normalise(raw);
          const props = { raw, att, type: fileTypeOf(att), urlFor, onPreview: setPreviewing };
          const key = att.attachmentId || stableKey(raw);
          return grid ? <FileTile key={key} {...props} /> : <FileRow key={key} {...props} />;
        })}
      </ul>
      {previewing && <AttachmentViewerDialog attachment={previewing} onClose={() => setPreviewing(null)} />}
    </>
  );
}
