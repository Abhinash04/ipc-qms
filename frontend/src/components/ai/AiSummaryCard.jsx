import { SparklesIcon } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function AiSummaryCard({ summary }) {
  if (!summary?.text) return null;

  return (
    <Card className="border-status-indigo-line bg-status-indigo-bg/30">
      <CardHeader className="flex items-center gap-2">
        <SparklesIcon className="h-4 w-4 text-status-indigo-fg" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">AI summary</h2>
        <Badge variant="status-indigo" className="ml-auto">
          AI-generated
        </Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-foreground">{summary.text}</p>

        {summary.keyPoints?.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">Points raised</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
              {summary.keyPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ol>
          </div>
        )}

        {summary.topics?.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Topics</span>
            {summary.topics.map((topic) => (
              <Badge key={topic} variant="outline">
                {topic}
              </Badge>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Generated from the inquirer&apos;s own message. Assistive only — verify before acting.
        </p>
      </CardBody>
    </Card>
  );
}
