import { useState } from 'react';
import { SparklesIcon, RefreshCwIcon, Loader2Icon } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fetchGemmaAiSummary } from '@/services/api/aiService';

export function AiSummaryCard({ summary: initialSummary, query, onSummaryUpdated }) {
  const [summary, setSummary] = useState(initialSummary);
  const [loading, setLoading] = useState(false);

  const handleGenerateAiSummary = async () => {
    if (!query) return;
    setLoading(true);
    try {
      const gemmaSummary = await fetchGemmaAiSummary({
        subject: query.subject,
        body: query.description,
        inquirerName: query.inquirer?.name,
      });

      if (gemmaSummary) {
        setSummary(gemmaSummary);
        if (onSummaryUpdated) {
          onSummaryUpdated(gemmaSummary);
        }
      }
    } catch (error) {
      console.error('[AiSummaryCard] Error generating AI summary:', error);
    } finally {
      setLoading(false);
    }
  };

  const currentSummary = summary || initialSummary;

  return (
    <Card className="border-status-indigo-line bg-status-indigo-bg/30 shadow-sm transition-all">
      <CardHeader className="flex items-center justify-between gap-2 border-b border-status-indigo-line/40 pb-3">
        <div className="flex items-center gap-2">
          {loading ? (
            <Loader2Icon className="h-4 w-4 animate-spin text-status-indigo-fg" />
          ) : (
            <SparklesIcon className="h-4 w-4 text-status-indigo-fg" />
          )}
          <h2 className="text-sm font-semibold text-foreground">
            {loading ? 'Generating Gemma AI Summary...' : 'AI Summary (Gemma LLM)'}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {currentSummary?.fallback ? (
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50">
              Rule Fallback
            </Badge>
          ) : (
            <Badge variant="status-indigo" className="text-xs font-medium">
              🤖 Gemma AI
            </Badge>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={handleGenerateAiSummary}
            disabled={loading}
            title="Re-generate summary using Gemma AI"
          >
            <RefreshCwIcon className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Generating...' : 'Re-generate'}
          </Button>
        </div>
      </CardHeader>

      <CardBody className="space-y-3 pt-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-6 space-y-2">
            <Loader2Icon className="h-6 w-6 animate-spin text-status-indigo-fg" />
            <p className="text-sm font-medium text-status-indigo-fg">
              Analyzing query & generating crisp AI summary with Gemma LLM...
            </p>
            <p className="text-xs text-muted-foreground">Extracting main request, key points, and domain topics</p>
          </div>
        ) : !currentSummary?.text ? (
          <div className="flex items-center justify-between py-2">
            <p className="text-sm text-muted-foreground">No AI summary generated yet for this query.</p>
            <Button size="sm" variant="outline" onClick={handleGenerateAiSummary}>
              <SparklesIcon className="h-3.5 w-3.5 mr-1 text-status-indigo-fg" />
              Generate Gemma AI Summary
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-foreground leading-relaxed font-normal">
              {currentSummary.text}
            </p>

            {currentSummary.keyPoints?.length > 0 && (
              <div className="rounded-md bg-background/60 p-2.5 border border-status-indigo-line/30">
                <p className="text-xs font-semibold text-foreground mb-1">Key Points Raised:</p>
                <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                  {currentSummary.keyPoints.map((point, index) => (
                    <li key={index} className="leading-snug">{point}</li>
                  ))}
                </ul>
              </div>
            )}

            {currentSummary.topics?.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-xs font-medium text-muted-foreground">Topics:</span>
                {currentSummary.topics.map((topic, index) => (
                  <Badge key={index} variant="outline" className="text-xs bg-background/80">
                    {topic}
                  </Badge>
                ))}
              </div>
            )}

            <p className="text-[11px] text-muted-foreground/80 pt-1 border-t border-status-indigo-line/20">
              Generated by Gemma LLM from inquirer&apos;s email. Assistive only — verify before taking official action.
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
