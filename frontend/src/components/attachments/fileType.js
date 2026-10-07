import { File, FileImage, FileSpreadsheet, FileText } from 'lucide-react';

/** A recognisable but restrained look for a file: its type label, icon and colour. */
const TYPES = [
  { label: 'PDF', Icon: FileText, tone: 'bg-rose-50 text-rose-700 ring-rose-200', test: /pdf$/i },
  { label: 'DOC', Icon: FileText, tone: 'bg-blue-50 text-blue-700 ring-blue-200', test: /(msword|wordprocessingml|\.docx?$|^docx?$|rtf|odt)/i },
  { label: 'XLS', Icon: FileSpreadsheet, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', test: /(ms-excel|spreadsheetml|\.xlsx?$|^xlsx?$|csv|ods)/i },
  { label: 'IMG', Icon: FileImage, tone: 'bg-violet-50 text-violet-700 ring-violet-200', test: /(^image\/|\.(png|jpe?g|gif|webp|bmp|tiff?)$)/i },
];

const OTHER = { label: 'FILE', Icon: File, tone: 'bg-slate-100 text-slate-600 ring-slate-200' };

export function fileTypeOf({ filename = '', mimeType = '' } = {}) {
  const extension = String(filename).split('.').pop() || '';
  const found = TYPES.find(({ test }) => test.test(mimeType || '') || test.test(`.${extension}`) || test.test(extension));
  const label = found ? found.label : extension && extension.length <= 4 && extension !== filename ? extension.toUpperCase() : OTHER.label;
  return { ...(found || OTHER), label };
}
