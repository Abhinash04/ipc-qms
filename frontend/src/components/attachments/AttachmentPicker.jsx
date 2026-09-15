import { useRef } from 'react';
import { PaperclipIcon, XIcon, UploadCloudIcon } from 'lucide-react';
import { validateFile, MAX_FILES, formatFileSize } from '@/constants/attachmentPolicy';
// hasBlockingErrors also lives in attachmentPolicy.js (not exported from this
// file) — react-refresh requires component files to export only components.
import { cn } from '@/utils/cn';

/**
 * Controlled file picker. `files` is an array of `{ file: File, error: string|null }`
 * entries — validation is pre-flight only (a nicer UX for an obviously-bad
 * file); the backend re-validates everything and is the actual authority.
 */
export function AttachmentPicker({ files, onChange, disabled = false }) {
  const inputRef = useRef(null);

  const addFiles = (list) => {
    const incoming = Array.from(list);
    const next = [...files];
    for (const file of incoming) {
      if (next.length >= MAX_FILES) break;
      const check = validateFile(file);
      next.push({ file, error: check.ok ? null : check.reason });
    }
    onChange(next);
  };

  const remove = (index) => onChange(files.filter((_, i) => i !== index));

  return (
    <div className="space-y-2">
      <label
        htmlFor="attachment-file-input"
        className="text-[11.5px] font-bold text-slate-600 uppercase tracking-wider"
      >
        Attachments
      </label>

      <div
        className={cn(
          'flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-3.5 py-2.5 text-xs',
          disabled && 'opacity-60',
        )}
      >
        <div className="flex items-center gap-2 text-slate-500">
          <UploadCloudIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Images, video, audio, PDF, Excel, Word, PPT — up to 10MB each</span>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || files.length >= MAX_FILES}
          className="rounded-lg bg-white border border-slate-200 px-3 py-1.5 text-[12px] font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed shrink-0"
        >
          Add files
        </button>
        <input
          id="attachment-file-input"
          ref={inputRef}
          type="file"
          multiple
          disabled={disabled}
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((entry, index) => (
            <li
              key={`${entry.file.name}-${index}`}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
                entry.error
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-slate-200 bg-white text-slate-700',
              )}
            >
              <PaperclipIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="flex-1 truncate font-semibold">{entry.file.name}</span>
              <span className="shrink-0 text-[11px] text-slate-400">{formatFileSize(entry.file.size)}</span>
              {entry.error && <span className="shrink-0 text-[11px] font-bold">{entry.error}</span>}
              <button
                type="button"
                onClick={() => remove(index)}
                disabled={disabled}
                aria-label={`Remove ${entry.file.name}`}
                className="shrink-0 text-slate-400 hover:text-rose-600 disabled:opacity-50"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
