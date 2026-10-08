import { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Mail,
  MailOpen,
  Send,
  Inbox,
  MoreHorizontal,
} from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { CaseCard, Pill, Segmented } from '@/components/common/CaseCard';
import { initials } from '@/utils/initials';
import { fileTypeOf } from '@/components/attachments/fileType';
import { attachmentUrl } from '@/services/api/attachmentService';
import { formatFileSize } from '@/constants/attachmentPolicy';
import { EMAIL_DIRECTION, EMAIL_TYPE_LABELS, describeDirection, sortThreadMessages } from '@/constants/emailModel';
import { brandedFrom } from '@/constants/orgBranding';
import { cn } from '@/utils/cn';

const FILTERS = [
  { value: 'ALL', label: 'All Emails' },
  { value: EMAIL_DIRECTION.INBOUND, label: 'Received' },
  { value: EMAIL_DIRECTION.OUTBOUND, label: 'Sent' },
];

const fullTime = (timestamp) =>
  new Date(timestamp).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

const shortTime = (timestamp) => new Date(timestamp).toLocaleString('en-IN', { day: 'numeric', month: 'short' });

function party(address) {
  const text = String(address || '');
  const match = text.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1] || match[2], email: match[2] };
  return text.includes('@') ? { name: text.split('@')[0], email: text } : { name: text, email: null };
}

const senderOf = (message) =>
  party(message.direction === EMAIL_DIRECTION.INBOUND ? message.from : brandedFrom(message.from));

function splitQuoted(body) {
  const text = String(body || '');
  const marker = text.search(/^(On .+wrote:|-{2,}\s*Original Message\s*-{2,}|>)/m);
  if (marker <= 0) return { main: text, quoted: '' };
  return { main: text.slice(0, marker).trimEnd(), quoted: text.slice(marker).trim() };
}

function Avatar({ name, outbound, size = 'md' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-bold ring-1',
        size === 'sm' ? 'h-8 w-8 text-[11px]' : 'h-10 w-10 text-[12.5px]',
        outbound ? 'bg-primary-100 text-primary-700 ring-primary-200' : 'bg-slate-100 text-slate-700 ring-slate-200',
      )}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

function AttachmentStrip({ attachments = [] }) {
  const files = attachments.filter((file) => file && (file.attachmentId || file.filename || file.name));
  if (files.length === 0) return null;
  return (
    <ul className="m-0 mt-4 flex list-none flex-wrap gap-2 border-t border-slate-200/70 p-0 pt-3" aria-label="Attachments">
      {files.map((file) => {
        const filename = file.filename || file.name || 'attachment';
        const type = fileTypeOf({ filename, mimeType: file.mimeType });
        const chip = (
          <>
            <span className={cn('flex h-7 w-7 items-center justify-center rounded-md ring-1', type.tone)} aria-hidden="true">
              <type.Icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block max-w-44 truncate text-[12.5px] font-semibold text-slate-800">{filename}</span>
              <span className="block text-[11px] text-slate-500">
                {[type.label, typeof file.size === 'number' ? formatFileSize(file.size) : null].filter(Boolean).join(' • ')}
              </span>
            </span>
          </>
        );
        return (
          <li key={file.attachmentId || filename}>
            {file.attachmentId ? (
              <a
                href={attachmentUrl(file.attachmentId, { download: true })}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-card px-2 py-1.5 transition-colors hover:border-slate-300 hover:bg-slate-50"
                aria-label={`Download ${filename}`}
              >
                {chip}
                <Download className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              </a>
            ) : (
              <span className="flex items-center gap-2 rounded-lg border border-slate-200 bg-card px-2 py-1.5">{chip}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ThreadMessage({ message }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const outbound = message.direction === EMAIL_DIRECTION.OUTBOUND;
  const sender = senderOf(message);
  const { main, quoted } = splitQuoted(message.body);

  return (
    <article
      className={cn('overflow-hidden rounded-xl border', outbound ? 'border-primary-100' : 'border-slate-200')}
      aria-label={`${describeDirection(message.direction)}: ${message.subject}`}
    >
      <div className={cn('border-b px-4 py-3 sm:px-5', outbound ? 'border-primary-100 bg-primary-50/60' : 'border-slate-200 bg-slate-50/70')}>
        <h3 className="m-0 text-[17px] font-semibold leading-snug text-slate-900">{message.subject}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Pill tone={outbound ? 'info' : 'neutral'}>{describeDirection(message.direction)}</Pill>
          <Pill tone={message.emailType === 'OUTGOING_RESPONSE' ? 'success' : 'neutral'}>
            {EMAIL_TYPE_LABELS[message.emailType] || message.emailType}
          </Pill>
        </div>
      </div>

      <div className="bg-card px-4 py-4 sm:px-5">
        <header className="flex items-start gap-3">
          <Avatar name={sender.name} outbound={outbound} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[14px] font-semibold text-slate-900">{sender.name}</span>
              {sender.email && <span className="break-all text-[12.5px] text-slate-500">&lt;{sender.email}&gt;</span>}
            </div>
            <p className="m-0 text-[12.5px] text-slate-500">
              <span className="text-slate-400">to</span> <span className="break-all">{message.to.join(', ')}</span>
            </p>
          </div>
          <time dateTime={message.timestamp} className="shrink-0 pt-0.5 text-end text-[12px] text-slate-500">
            {fullTime(message.timestamp)}
          </time>
        </header>

        <div className="mt-4 sm:ps-13">
          <div className="max-w-[72ch] whitespace-pre-wrap text-[14px] leading-[1.75] text-slate-700">{main}</div>

          {quoted && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowQuoted((open) => !open)}
                aria-expanded={showQuoted}
                aria-label={showQuoted ? 'Hide quoted text' : 'Show quoted text'}
                className="cursor-pointer rounded-md bg-slate-100 px-1.5 text-slate-500 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </button>
              {showQuoted && (
                <blockquote className="m-0 mt-2 max-w-[72ch] whitespace-pre-wrap border-s-2 border-slate-300 ps-3 text-[13px] leading-relaxed text-slate-500">
                  {quoted}
                </blockquote>
              )}
            </div>
          )}

          <AttachmentStrip attachments={message.attachments} />
        </div>
      </div>
    </article>
  );
}

function InboxRow({ message, selected, onSelect }) {
  const outbound = message.direction === EMAIL_DIRECTION.OUTBOUND;
  const sender = senderOf(message);
  const preview = splitQuoted(message.body).main.replace(/\s+/g, ' ').slice(0, 120);
  const Direction = outbound ? ArrowUpRight : ArrowDownLeft;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        aria-label={`${outbound ? 'Sent' : 'Received'}: ${message.subject}, ${sender.name}, ${shortTime(message.timestamp)}`}
        className={cn(
          'flex w-full cursor-pointer gap-2.5 border-s-[3px] px-3 py-3 text-start transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
          selected ? 'border-s-primary-600 bg-primary-50/70' : 'border-s-transparent hover:bg-slate-50',
        )}
      >
        <Avatar name={sender.name} outbound={outbound} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn('truncate text-[13px]', selected ? 'font-bold text-slate-900' : 'font-semibold text-slate-800')}>
              {sender.name}
            </span>
            <span className="ms-auto shrink-0 text-[11.5px] tabular-nums text-slate-500">{shortTime(message.timestamp)}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <Direction
              className={cn('h-3.5 w-3.5 shrink-0', outbound ? 'text-primary-600' : 'text-emerald-600')}
              aria-label={outbound ? 'Sent' : 'Received'}
            />
            <span className="truncate text-[12.5px] font-medium text-slate-700">{message.subject}</span>
          </span>
          <span className="mt-0.5 line-clamp-1 text-[12px] text-slate-500">{preview}</span>
        </span>
      </button>
    </li>
  );
}

function ThreadEmptyState({ filter }) {
  if (filter === 'ALL') {
    return (
      <EmptyState
        icon={Mail}
        title="No email on this case"
        description="A query normally starts from an email, so this is unexpected."
      />
    );
  }
  const kind = filter === EMAIL_DIRECTION.INBOUND ? 'received' : 'sent';
  return <EmptyState icon={Mail} title="No emails found" description={`There are no ${kind} emails in this thread.`} />;
}


export function EmailThread({ messages = [] }) {
  const [filter, setFilter] = useState('ALL');
  const [selectedId, setSelectedId] = useState(null);

  const ordered = sortThreadMessages(messages);
  const filtered = ordered.filter((msg) => filter === 'ALL' || msg.direction === filter);
  const inbox = [...filtered].reverse();

  const selected = filtered.find((msg) => msg.messageId === selectedId) || filtered[filtered.length - 1] || null;
  const position = selected ? inbox.indexOf(selected) : -1;
  const newer = position > 0 ? inbox[position - 1] : null;
  const older = position >= 0 && position < inbox.length - 1 ? inbox[position + 1] : null;
  const received = ordered.filter((msg) => msg.direction === EMAIL_DIRECTION.INBOUND).length;

  return (
    <CaseCard
      tone="email"
      banner
      art={[MailOpen, Send, Inbox]}
      icon={Mail}
      title="Email thread"
      meta={`${filtered.length} ${filtered.length === 1 ? 'message' : 'messages'} exchanged with the inquirer`}
      toolbar={
        <>
          <Segmented label="Show emails" options={FILTERS} value={filter} onChange={setFilter} />
          <span className="text-[12px] font-medium text-slate-500">
            {received} received · {ordered.length - received} sent
          </span>
        </>
      }
      bodyClassName="p-0 sm:p-0"
    >
      {filtered.length === 0 ? (
        <div className="p-5">
          <ThreadEmptyState filter={filter} />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
          <div className="border-b border-slate-200/70 bg-slate-50/50 lg:border-e lg:border-b-0">
            <p className="m-0 border-b border-slate-200/70 px-3 py-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
              Inbox · newest first
            </p>
            <ul aria-label="Messages" className="m-0 max-h-72 list-none divide-y divide-slate-200/70 overflow-y-auto p-0 lg:max-h-[38rem]">
              {inbox.map((message) => (
                <InboxRow
                  key={message.messageId}
                  message={message}
                  selected={message === selected}
                  onSelect={() => setSelectedId(message.messageId)}
                />
              ))}
            </ul>
          </div>

          <div className="min-w-0 p-3 sm:p-4">
            {selected && <ThreadMessage key={selected.messageId} message={selected} />}
            {(newer || older) && (
              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={!older}
                  onClick={() => older && setSelectedId(older.messageId)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /> Older
                </button>
                <span className="text-[12px] text-slate-500">
                  {inbox.length - position} of {inbox.length}
                </span>
                <button
                  type="button"
                  disabled={!newer}
                  onClick={() => newer && setSelectedId(newer.messageId)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Newer <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </CaseCard>
  );
}
