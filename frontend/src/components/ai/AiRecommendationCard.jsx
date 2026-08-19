import { useState, useEffect } from 'react';
import { SparklesIcon, CheckCircle2Icon, UserCheckIcon, Loader2Icon, RefreshCwIcon, AwardIcon } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fetchGemmaAiRecommendations } from '@/services/api/aiService';
import { recommendTopOfficials } from '@/services/ai/mockAiService';
import { MOCK_USERS } from '@/constants/mockUsers';

export function AiRecommendationCard({ query, onAssign, currentAssigneeId }) {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadRecommendations = async () => {
    if (!query) return;
    setLoading(true);
    try {
      const gemmaRecs = await fetchGemmaAiRecommendations({
        subject: query.subject,
        body: query.description,
        summaryText: query.aiSummary?.text || '',
      });

      if (gemmaRecs && gemmaRecs.length > 0) {
        setRecommendations(gemmaRecs);
      } else {
        const fallbackRecs = recommendTopOfficials(query, MOCK_USERS);
        setRecommendations(fallbackRecs);
      }
    } catch (error) {
      console.error('[AiRecommendationCard] Error loading recommendations:', error);
      const fallbackRecs = recommendTopOfficials(query, MOCK_USERS);
      setRecommendations(fallbackRecs);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecommendations();
  }, [query?.queryId]);

  if (!query) return null;

  return (
    <Card className="border-status-indigo-line bg-background shadow-sm">
      <CardHeader className="flex items-center justify-between gap-2 border-b border-border bg-muted/20 py-3">
        <div className="flex items-center gap-2">
          <SparklesIcon className="h-4 w-4 text-status-indigo-fg" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">AI Official Recommendations (Top 3)</h2>
          <Badge variant="status-indigo" className="text-[11px]">
            🤖 Gemma Match Engine
          </Badge>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={loadRecommendations}
          disabled={loading}
        >
          <RefreshCwIcon className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Analyzing...' : 'Re-analyze'}
        </Button>
      </CardHeader>

      <CardBody className="p-4 space-y-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-6 space-y-2">
            <Loader2Icon className="h-6 w-6 animate-spin text-status-indigo-fg" />
            <p className="text-sm font-medium text-status-indigo-fg">
              Analyzing query & matching with official expertise metadata...
            </p>
            <p className="text-xs text-muted-foreground">Evaluating domain fit, division, and workload</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recommendations.map((rec) => {
              const isAssigned = currentAssigneeId === rec.userId;
              const isRank1 = rec.rank === 1;

              return (
                <div
                  key={rec.userId}
                  className={`rounded-lg border p-3.5 transition-all ${
                    isAssigned
                      ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20'
                      : isRank1
                      ? 'border-indigo-300 bg-indigo-50/30 dark:bg-indigo-950/10'
                      : 'border-border bg-card'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {isRank1 && <AwardIcon className="h-4 w-4 text-amber-500" />}
                      <span className="text-xs font-semibold text-muted-foreground">
                        #{rec.rank} Match
                      </span>
                      <h3 className="font-semibold text-foreground text-sm">{rec.name}</h3>
                      <Badge
                        variant={isRank1 ? 'status-indigo' : 'outline'}
                        className="text-xs font-bold"
                      >
                        {rec.matchPercent}% Match
                      </Badge>
                    </div>

                    {onAssign && (
                      <Button
                        size="sm"
                        variant={isAssigned ? 'outline' : isRank1 ? 'default' : 'outline'}
                        className="h-8 text-xs font-medium"
                        onClick={() => onAssign(rec.userId)}
                        disabled={isAssigned}
                      >
                        {isAssigned ? (
                          <>
                            <CheckCircle2Icon className="h-3.5 w-3.5 mr-1 text-emerald-600" />
                            Currently Assigned
                          </>
                        ) : (
                          <>
                            <UserCheckIcon className="h-3.5 w-3.5 mr-1" />
                            Assign to {rec.name.split(' ')[0]}
                          </>
                        )}
                      </Button>
                    )}
                  </div>

                  <div className="mt-1 text-xs text-muted-foreground flex items-center gap-2">
                    <span className="font-medium text-foreground">{rec.divisionName}</span>
                    <span>•</span>
                    <span>{rec.email}</span>
                  </div>

                  <p className="mt-2 text-xs text-foreground/90 leading-relaxed font-normal bg-background/80 p-2 rounded border border-border/50">
                    {rec.reason}
                  </p>

                  {rec.expertise?.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className="text-[11px] font-medium text-muted-foreground">Expertise:</span>
                      {rec.expertise.map((exp) => {
                        const isMatched = rec.matchedKeywords?.includes(exp.toLowerCase());
                        return (
                          <Badge
                            key={exp}
                            variant={isMatched ? 'status-indigo' : 'outline'}
                            className={`text-[10px] py-0 px-1.5 ${isMatched ? 'font-semibold' : 'text-muted-foreground'}`}
                          >
                            {exp}
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
