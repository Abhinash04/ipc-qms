import { useState, useEffect, useCallback, useMemo } from 'react';
import { Sparkles, CheckCircle2, UserCheck, Loader2, RefreshCw, Award } from 'lucide-react';
import { fetchGemmaAiRecommendations } from '@/services/api/aiService';
import { recommendTopOfficials } from '@/services/ai/mockAiService';
import { MOCK_USERS } from '@/constants/mockUsers';

export function AiRecommendationCard({ query, onAssign, currentAssigneeId, variant = 'card' }) {
  const localRecommendations = useMemo(
    () => (query ? recommendTopOfficials(query, MOCK_USERS) : []),
    [query],
  );

  const [gemma, setGemma] = useState({ queryId: null, recs: null });
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const recommendations =
    (gemma.queryId === query?.queryId ? gemma.recs : null) ?? localRecommendations;

  const loadRecommendations = useCallback(
    async (isCurrent = () => true) => {
      if (!query) return;
      try {
        const gemmaRecs = await fetchGemmaAiRecommendations({
          subject: query.subject,
          body: query.description,
          summaryText: query.aiSummary?.text || '',
        });
        if (isCurrent() && gemmaRecs && gemmaRecs.length > 0) {
          setGemma({ queryId: query.queryId, recs: gemmaRecs });
        }
      } catch (error) {
        if (isCurrent()) {
          console.error('[AiRecommendationCard] Error loading recommendations:', error);
        }
      }
    },
    [query],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadRecommendations(() => !cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRecommendations]);

  const reanalyse = async () => {
    setLoading(true);
    try {
      await loadRecommendations();
    } finally {
      setLoading(false);
    }
  };

  if (!query) return null;

  const outerClass = variant === 'embedded'
    ? "select-none"
    : "bg-linear-to-br from-indigo-50/80 via-purple-50/30 to-white rounded-3xl border border-indigo-200/80 p-6 shadow-sm select-none";

  return (
    <div className={outerClass}>
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-indigo-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center shadow-2xs">
            <Sparkles className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <h2 className="font-heading text-[20px] font-black text-slate-900 m-0">
            AI Official Recommendations
          </h2>
        </div>

        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-500 hover:text-purple-700 bg-white hover:bg-purple-50 px-3 py-1.5 rounded-xl border border-slate-200/80 transition-all cursor-pointer disabled:opacity-50"
          onClick={reanalyse}
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Analyzing...' : 'Re-analyze'}</span>
        </button>
      </div>

      <div className="pt-4 space-y-3.5">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-8 space-y-2">
            <Loader2 className="h-7 w-7 animate-spin text-purple-600" />
            <p className="text-[14px] font-bold text-slate-800">
              Analyzing query & matching with official expertise metadata...
            </p>
            <p className="text-[12px] font-medium text-slate-400">Evaluating domain fit, division, and workload</p>
          </div>
        ) : (
          <div className="space-y-3.5">
            {(showAll ? recommendations : recommendations.slice(0, 2)).map((rec) => {
              const isAssigned = currentAssigneeId === rec.userId;
              const isRank1 = rec.rank === 1;

              return (
                <div
                  key={rec.userId}
                  className={`rounded-2xl border p-4 transition-all shadow-2xs ${
                    isAssigned
                      ? 'border-emerald-300 bg-emerald-50/60'
                      : isRank1
                      ? 'border-indigo-200 bg-indigo-50/50'
                      : 'border-slate-200/80 bg-white'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {isRank1 && <Award className="h-4 w-4 text-amber-500" />}
                      <span className="text-[14px] font-black text-slate-400 uppercase tracking-wider">
                        #{rec.rank} Match
                      </span>
                      <h3 className="font-heading text-[18px] font-black text-slate-900 m-0">{rec.name}</h3>
                      <span className="text-[13px] font-black text-purple-700 bg-purple-100/90 px-2.5 py-0.5 rounded-full border border-purple-200">
                        {rec.matchPercent}% Match
                      </span>
                    </div>

                    {onAssign && (
                      <button
                        type="button"
                        onClick={() => onAssign(rec.userId)}
                        disabled={isAssigned}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-bold transition-all cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed ${
                          isAssigned
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : isRank1
                            ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-xs'
                            : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {isAssigned ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            <span>Currently Assigned</span>
                          </>
                        ) : (
                          <>
                            <UserCheck className="h-3.5 w-3.5" />
                            <span>Assign to {rec.name.split(' ')[0]}</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  <div className="mt-1 text-[14px] font-semibold text-slate-400 flex items-center gap-2">
                    <span className="font-extrabold text-slate-700">{rec.divisionName}</span>
                    <span>•</span>
                    <span>{rec.email}</span>
                  </div>

                  {rec.expertise?.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <span className="text-[14px] font-bold text-slate-400">Expertise:</span>
                      {rec.expertise.map((exp) => {
                        const isMatched = rec.matchedKeywords?.includes(exp.toLowerCase());
                        return (
                          <span
                            key={exp}
                            className={`text-[13px] font-bold px-2 py-0.5 rounded-lg border ${
                              isMatched
                                ? 'bg-purple-100 text-purple-800 border-purple-200'
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}
                          >
                            {exp}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {recommendations.length > 2 && (
              <button
                type="button"
                onClick={() => setShowAll(!showAll)}
                className="w-full mt-2 py-2 text-[12.5px] font-bold text-slate-500 bg-slate-50 hover:bg-slate-100 hover:text-slate-700 border border-slate-200/60 rounded-xl transition-colors cursor-pointer"
              >
                {showAll ? 'Show less' : `Show ${recommendations.length - 2} more matches`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
