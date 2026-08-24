import { useState } from 'react';
import { MailIcon } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/EmptyState';
import {
  EMAIL_DIRECTION,
  EMAIL_TYPE_LABELS,
  describeDirection,
  sortThreadMessages,
} from '@/constants/emailModel';
import { cn } from '@/utils/cn';

export function EmailThread({ messages = [] }) {
  const [filter, setFilter] = useState('ALL');
  const ordered = sortThreadMessages(messages);

  const filteredMessages = ordered.filter(msg => {
    if (filter === 'ALL') return true;
    return msg.direction === filter;
  });

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm">
      <div className="border-b border-slate-100 pb-4 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-[22px] font-black text-slate-900 m-0">Email thread</h2>
          <p className="mt-1 text-[15px] font-medium text-slate-400">
            Every email exchanged with the inquirer for this case.
          </p>
        </div>

        <div className="flex bg-slate-100/80 p-1 rounded-xl shrink-0">
          <button 
            type="button"
            onClick={() => setFilter('ALL')}
            className={cn("px-3 py-1.5 text-[12px] font-bold rounded-lg transition-all cursor-pointer", filter === 'ALL' ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700")}
          >
            All Emails
          </button>
          <button 
            type="button"
            onClick={() => setFilter(EMAIL_DIRECTION.INBOUND)}
            className={cn("px-3 py-1.5 text-[12px] font-bold rounded-lg transition-all cursor-pointer", filter === EMAIL_DIRECTION.INBOUND ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700")}
          >
            Received Only
          </button>
          <button 
            type="button"
            onClick={() => setFilter(EMAIL_DIRECTION.OUTBOUND)}
            className={cn("px-3 py-1.5 text-[12px] font-bold rounded-lg transition-all cursor-pointer", filter === EMAIL_DIRECTION.OUTBOUND ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}
          >
            Sent Only
          </button>
        </div>
      </div>
      
      <div className="space-y-6">
        {filteredMessages.length === 0 ? (
          <EmptyState
            icon={MailIcon}
            title={filter === 'ALL' ? "No email on this case" : "No emails found"}
            description={filter === 'ALL' ? "A query normally starts from an email, so this is unexpected." : `There are no ${filter === EMAIL_DIRECTION.INBOUND ? 'received' : 'sent'} emails in this thread.`}
          />
        ) : (
          filteredMessages.map((message) => <ThreadMessage key={message.messageId} message={message} isFilteredView={filter !== 'ALL'} />)
        )}
      </div>
    </div>
  );
}

function ThreadMessage({ message, isFilteredView }) {
  const inbound = message.direction === EMAIL_DIRECTION.INBOUND;
  const alignLeft = inbound || isFilteredView;

  return (
    <div className={cn("flex flex-col w-full", alignLeft ? "items-start" : "items-end")}>
      <article 
        className={cn(
          "w-full sm:w-[85%] lg:w-[75%] rounded-3xl p-5 shadow-sm border",
          inbound 
            ? "bg-white border-slate-200 rounded-tl-sm shadow-[4px_4px_10px_rgba(0,0,0,0.02)]" 
            : "bg-blue-50 border-blue-100 shadow-[4px_4px_10px_rgba(59,130,246,0.05)]",
          !inbound && alignLeft ? "rounded-tl-sm" : !inbound ? "rounded-tr-sm" : ""
        )}
      >
        <div className="flex flex-wrap items-center gap-2.5 mb-4 pb-3 border-b border-slate-100/60">
          <Badge variant={inbound ? 'status-slate' : 'status-blue'} className="shadow-none text-[13px] px-3 py-1">
            {describeDirection(message.direction)}
          </Badge>
          <Badge variant="outline" className={cn("text-[13px] px-3 py-1", inbound ? "border-slate-200 bg-slate-50" : "border-blue-200 text-blue-700 bg-white/50")}>
            {EMAIL_TYPE_LABELS[message.emailType] || message.emailType}
          </Badge>
          <span className={cn("ml-auto text-[13.5px] font-bold tracking-wide uppercase", inbound ? "text-slate-400" : "text-blue-400")}>
            {new Date(message.timestamp).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short'
            })}
          </span>
        </div>

        <div className={cn("text-[15px] space-y-2 mb-4 p-3.5 rounded-2xl border", inbound ? "bg-slate-50 border-slate-100" : "bg-white/60 border-blue-100/50")}>
          <div className="flex gap-3 items-start">
            <span className={cn("font-extrabold shrink-0 w-11 text-right", inbound ? "text-slate-400" : "text-blue-400")}>From</span>
            <span className="break-all font-semibold text-slate-700">{message.from}</span>
          </div>
          <div className="flex gap-3 items-start">
            <span className={cn("font-extrabold shrink-0 w-11 text-right", inbound ? "text-slate-400" : "text-blue-400")}>To</span>
            <span className="break-all font-semibold text-slate-700">{message.to.join(', ')}</span>
          </div>
        </div>

        <h3 className="text-[18px] font-black text-slate-900 mb-2 leading-snug">{message.subject}</h3>
        <p className="text-[16px] leading-relaxed whitespace-pre-wrap text-slate-600 font-medium">
          {message.body}
        </p>
      </article>
    </div>
  );
}
