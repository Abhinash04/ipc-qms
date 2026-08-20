import { useState } from 'react';
import { Sparkles, RefreshCw, Loader2, Bot } from 'lucide-react';
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
    <div className="bg-linear-to-br from-indigo-50/80 via-purple-50/30 to-white rounded-3xl border border-indigo-200/80 p-6 shadow-sm select-none">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-indigo-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center shadow-2xs">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" strokeWidth={2.2} />
            )}
          </div>
          <h2 className="font-heading text-[16px] font-black text-slate-900 m-0">
            {loading ? 'Generating Gemma AI Summary...' : 'AI Summary (Gemma LLM)'}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {currentSummary?.fallback ? (
            <span className="text-[11.5px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
              Rule Fallback
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-black text-purple-700 bg-purple-100/90 px-3 py-1 rounded-full border border-purple-200 shadow-2xs">
              <Bot className="h-3.5 w-3.5" />
              Gemma AI
            </span>
          )}

          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-500 hover:text-purple-700 bg-white hover:bg-purple-50 px-3 py-1.5 rounded-xl border border-slate-200/80 transition-all cursor-pointer disabled:opacity-50"
            onClick={handleGenerateAiSummary}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Generating...' : 'Re-generate'}</span>
          </button>
        </div>
      </div>

      {/* Body Content */}
      <div className="pt-4 space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-8 space-y-2">
            <Loader2 className="h-7 w-7 animate-spin text-purple-600" />
            <p className="text-[14px] font-bold text-slate-800">
              Analyzing query & generating crisp AI summary with Gemma LLM...
            </p>
            <p className="text-[12px] font-medium text-slate-400">Extracting main request, key points, and domain topics</p>
          </div>
        ) : !currentSummary?.text ? (
          <div className="flex items-center justify-between py-2">
            <p className="text-[13.5px] font-medium text-slate-500">No AI summary generated yet for this query.</p>
            <button
              type="button"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 text-white font-bold text-[13px] shadow-sm hover:bg-purple-700 transition-colors cursor-pointer"
              onClick={handleGenerateAiSummary}
            >
              <Sparkles className="h-4 w-4" />
              <span>Generate Gemma AI Summary</span>
            </button>
          </div>
        ) : (
          <>
            <p className="text-[14px] font-semibold text-slate-800 leading-relaxed m-0">
              {currentSummary.text}
            </p>

            {currentSummary.keyPoints?.length > 0 && (
              <div className="rounded-2xl bg-white/90 p-4 border border-purple-100 shadow-2xs space-y-2">
                <p className="text-[12.5px] font-black text-slate-900 m-0">Key Points Raised:</p>
                <ul className="space-y-1.5 pl-0 m-0 list-none">
                  {currentSummary.keyPoints.map((point, index) => (
                    <li key={index} className="flex items-start gap-2 text-[12.5px] font-medium text-slate-600 leading-snug">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0 mt-1.5" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {currentSummary.topics?.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[12px] font-bold text-slate-400">Topics:</span>
                {currentSummary.topics.map((topic, index) => (
                  <span key={index} className="text-[11.5px] font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-lg border border-purple-100">
                    {topic}
                  </span>
                ))}
              </div>
            )}

            <p className="text-[11.5px] font-medium text-slate-400 pt-3 border-t border-indigo-100/60 m-0">
              Generated by Gemma LLM from inquirer&apos;s email. Assistive only — verify before taking official action.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
