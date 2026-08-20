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

export function EmailThread({ messages = [] }) {
  const ordered = sortThreadMessages(messages);

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-foreground">Email thread</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Every email exchanged with the inquirer for this query.
        </p>
      </CardHeader>
      <CardBody className="space-y-3">
        {ordered.length === 0 ? (
          <EmptyState
            icon={MailIcon}
            title="No email on this case"
            description="A query normally starts from an email, so this is unexpected."
          />
        ) : (
          ordered.map((message) => <ThreadMessage key={message.messageId} message={message} />)
        )}
      </CardBody>
    </Card>
  );
}

function ThreadMessage({ message }) {
  const inbound = message.direction === EMAIL_DIRECTION.INBOUND;

  return (
    <article className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={inbound ? 'status-blue' : 'status-green'}>
          {describeDirection(message.direction)}
        </Badge>
        <Badge variant="outline">{EMAIL_TYPE_LABELS[message.emailType] || message.emailType}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {new Date(message.timestamp).toLocaleString()}
        </span>
      </div>

      <dl className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        <div className="flex gap-2">
          <dt className="w-10 shrink-0 font-medium">From</dt>
          <dd className="min-w-0 break-all">{message.from}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-10 shrink-0 font-medium">To</dt>
          <dd className="min-w-0 break-all">{message.to.join(', ')}</dd>
        </div>
      </dl>

      <p className="mt-2 text-sm font-medium text-foreground">{message.subject}</p>
      <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">{message.body}</p>
    </article>
  );
}
