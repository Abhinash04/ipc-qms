import { useState } from 'react';
import { Paperclip } from 'lucide-react';
import { Segmented } from '@/components/common/CaseCard';
import { formatFileSize } from '@/constants/attachmentPolicy';
import { cn } from '@/utils/cn';
import { AttachmentList } from './AttachmentList';
import { fileTypeOf } from './fileType';

const LAYOUTS = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
];

const fileSize = (file) => (typeof file.size === 'number' ? file.size : typeof file.sizeKb === 'number' ? file.sizeKb * 1024 : 0);
const isFile = (file) => Boolean(file) && Boolean(file.attachmentId || file.id || file.filename || file.name);

/** The case's files: how many, how large, of which types, shown as tiles or rows. */
export function AttachmentsPanel({ attachments = [], emptyDescription }) {
  const [layout, setLayout] = useState('grid');
  const files = attachments.filter(isFile);

  if (files.length === 0) {
    return <AttachmentList attachments={files} emptyDescription={emptyDescription} />;
  }

  const total = files.reduce((sum, file) => sum + fileSize(file), 0);
  const byType = Object.entries(
    files.reduce((counts, file) => {
      const type = fileTypeOf({ filename: file.filename || file.name, mimeType: file.mimeType });
      counts[type.label] = { type, count: (counts[type.label]?.count || 0) + 1 };
      return counts;
    }, {}),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-primary-700" aria-hidden="true">
              <Paperclip className="h-4 w-4" />
            </span>
            <span className="leading-tight">
              <span className="block text-[13.5px] font-semibold text-slate-900">
                {files.length} {files.length === 1 ? 'file' : 'files'}
              </span>
              {total > 0 && <span className="block text-[11.5px] text-slate-500">{`${formatFileSize(total)} in total`}</span>}
            </span>
          </span>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="File types">
            {byType.map(([label, { type, count }]) => (
              <li
                key={label}
                className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1', type.tone)}
              >
                <type.Icon className="h-3 w-3" aria-hidden="true" />
                {`${label} ×${count}`}
              </li>
            ))}
          </ul>
        </div>
        <Segmented label="Attachment layout" options={LAYOUTS} value={layout} onChange={setLayout} />
      </div>

      <AttachmentList attachments={files} layout={layout} emptyDescription={emptyDescription} />
    </div>
  );
}
