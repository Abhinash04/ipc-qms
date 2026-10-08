import { useState } from 'react';
import { Sparkles, RefreshCw, Loader2, Lightbulb, Tag, ShieldAlert, BrainCircuit } from 'lucide-react';
import { fetchGemmaAiSummary } from '@/services/api/aiService';
import { CaseCard, CardAction, Pill } from '@/components/common/CaseCard';
import { cn } from '@/utils/cn';
import { useIsClamped } from '@/hooks/useIsClamped';

const KEY_POINT_PREVIEW = 3;

function ProvenanceBadge({ summary }) {
  if (!summary?.text) return null;

  const status = summary.status ?? (summary.fallback ? 'FALLBACK' : 'GENERATED');
  if (status === 'GENERATED') return <Pill tone="ai">AI generated</Pill>;

  const failed = status === 'FAILED';
  return (
    <Pill
      tone={failed ? 'danger' : 'warning'}
      title={
        failed
          ? summary?.error || 'The AI service could not be reached.'
          : 'The AI service did not answer, so this was produced from the enquiry text without a model.'
      }
    >
      {failed ? 'Not generated' : 'Offline summary'}
    </Pill>
  );
}

function SummaryBody({ summary, expanded, onToggleExpanded }) {
  const keyPoints = summary.keyPoints || [];
  const visibleKeyPoints = expanded ? keyPoints : keyPoints.slice(0, KEY_POINT_PREVIEW);
  // Offer the full summary only when something is actually hidden: the text is cut off by its
  // clamp, or there are key points beyond the preview.
  const [textRef, textClamped] = useIsClamped(summary.text, expanded);
  const hasMore = expanded || textClamped || keyPoints.length > KEY_POINT_PREVIEW;

  return (
    <div className="space-y-5">
      <blockquote className="m-0 border-s-4 border-violet-400 bg-violet-50/60 py-3 ps-4 pe-3 rounded-e-lg">
        <p ref={textRef} className={cn('m-0 max-w-[75ch] text-[15.5px] leading-relaxed font-medium text-slate-800', !expanded && 'line-clamp-4')}>
          {summary.text}
        </p>
      </blockquote>

      {keyPoints.length > 0 && (
        <div>
          <h3 className="m-0 mb-2 flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-violet-700">
            <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> Key points raised
          </h3>
          <ol className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 md:grid-cols-2">
            {visibleKeyPoints.map((point, index) => (
              <li
                key={point}
                className="flex items-start gap-3 rounded-xl border border-violet-100 bg-card p-3 text-[13.5px] leading-snug text-slate-700 shadow-xs"
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[11.5px] font-bold text-white"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {summary.topics?.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-slate-500">
            <Tag className="h-3.5 w-3.5" aria-hidden="true" /> Topics
          </h3>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {summary.topics.map((topic) => (
              <li
                key={topic}
                className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[12px] font-semibold text-violet-800"
              >
                {topic}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="cursor-pointer text-[12.5px] font-semibold text-violet-700 hover:text-violet-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {expanded ? 'Show less' : 'View full summary'}
        </button>
      )}
    </div>
  );
}

export function AiSummaryCard({ summary, query, onSummaryUpdated, readOnly = false }) {
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleGenerateAiSummary = async () => {
    if (!query) return;
    setLoading(true);
    try {
      const gemmaSummary = await fetchGemmaAiSummary({
        subject: query.subject,
        body: query.description,
        inquirerName: query.inquirer?.name,
      });

      if (gemmaSummary) onSummaryUpdated?.(gemmaSummary);
    } catch (error) {
      console.error('[AiSummaryCard] Error generating AI summary:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <CaseCard
      tone="ai"
      banner
      art={[BrainCircuit, Sparkles, Lightbulb]}
      icon={loading ? Loader2 : Sparkles}
      title={loading ? 'Generating AI summary…' : 'AI Summary'}
      meta="Pravah AI's reading of the inquirer's email"
      badge={!loading && <ProvenanceBadge summary={summary} />}
      actions={
        !readOnly &&
        summary?.text && (
          <CardAction
            onClick={handleGenerateAiSummary}
            disabled={loading}
            className="border-white/30 bg-white/10 text-white hover:border-white/50 hover:bg-white/20 hover:text-white"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden="true" />
            {loading ? 'Generating…' : 'Re-generate'}
          </CardAction>
        )
      }
      footer={
        summary?.text && !loading ? (
          <span className="inline-flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
            AI-assisted summary — verify before taking official action.
          </span>
        ) : null
      }
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center gap-1.5 py-6 text-center" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-violet-600" aria-hidden="true" />
          <p className="m-0 text-[13.5px] font-semibold text-slate-800">Reading the enquiry and summarising it…</p>
          <p className="m-0 text-[12px] text-slate-500">Main request, key points and topics</p>
        </div>
      ) : !summary?.text ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-[13.5px] text-slate-600">No AI summary generated yet for this query.</p>
          {!readOnly && (
            <button
              type="button"
              onClick={handleGenerateAiSummary}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Generate AI Summary
            </button>
          )}
        </div>
      ) : (
        <SummaryBody summary={summary} expanded={expanded} onToggleExpanded={() => setExpanded((open) => !open)} />
      )}
    </CaseCard>
  );
}
