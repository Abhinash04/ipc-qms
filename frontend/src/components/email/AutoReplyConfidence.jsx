import { Bot, Gauge, UserRound } from "lucide-react";

import { CaseCard } from "@/components/common/CaseCard";
import { confidenceOf } from "@/utils/autoReplyConfidence";
import { cn } from "@/utils/cn";

const TONE = {
  auto: { pill: "border-status-green-line bg-status-green-bg text-status-green-fg", ink: "text-status-green-fg", bar: "bg-status-green-fg" },
  human: { pill: "border-status-amber-line bg-status-amber-bg text-status-amber-fg", ink: "text-status-amber-fg", bar: "bg-status-amber-fg" },
  pending: { pill: "border-status-gray-line bg-status-gray-bg text-status-gray-fg", ink: "text-status-gray-fg", bar: "bg-status-gray-fg" },
};

/** "Confidence: 100% · Auto Reply" for a mail row. */
export function AutoReplyConfidence({ message, className }) {
  const confidence = confidenceOf(message);
  if (!confidence) return null;
  const Icon = confidence.pending ? Gauge : confidence.tone === "auto" ? Bot : UserRound;

  return (
    <span
      title={confidence.reason || undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold",
        TONE[confidence.tone].pill,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {confidence.pending ? (
        "Confidence: not checked yet"
      ) : (
        <>
          Confidence: {confidence.percent}%<span aria-hidden="true">·</span>
          {confidence.decision}
        </>
      )}
    </span>
  );
}

/** The confidence on the opened mail: the score, the decision, the bar it had to reach, and why. */
export function AutoReplyConfidenceCard({ message, className }) {
  const confidence = confidenceOf(message);
  if (!confidence) return null;
  const tone = TONE[confidence.tone];

  return (
    <CaseCard tone="ai" banner compact art={[Gauge]} icon={Gauge} title="AI confidence" className={className}>

      {confidence.pending ? (
        <p className="m-0 text-[13px] font-medium text-slate-500">This mail has not been checked yet. It is checked shortly after it arrives.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <span className={cn("font-heading text-[34px] font-bold leading-none tabular-nums", tone.ink)}>{confidence.percent}%</span>
            <span className={cn("rounded-full border px-2.5 py-0.5 text-[12px] font-bold", tone.pill)}>{confidence.decision}</span>
          </div>

          <div
            role="meter"
            aria-label="Confidence"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={confidence.percent}
            aria-valuetext={`${confidence.percent}%, ${confidence.decision}`}
            className="relative h-2 rounded-full bg-slate-100"
          >
            <span className={cn("absolute inset-y-0 left-0 rounded-full", tone.bar)} style={{ width: `${confidence.percent}%` }} />
            {confidence.threshold !== null && (
              <span aria-hidden="true" className="absolute -top-1 -bottom-1 w-0.5 rounded bg-slate-500" style={{ left: `calc(${confidence.threshold}% - 1px)` }} />
            )}
          </div>

          <dl className="m-0 space-y-1.5 text-[12.5px]">
            {confidence.threshold !== null && (
              <div>
                <dt className="inline font-bold text-slate-500">Auto Reply needs: </dt>
                <dd className="inline font-semibold text-slate-700">{confidence.threshold}%</dd>
              </div>
            )}
            {confidence.question && (
              <div>
                <dt className="inline font-bold text-slate-500">Closest supported question: </dt>
                <dd className="inline font-semibold text-slate-700">“{confidence.question}”</dd>
              </div>
            )}
            {confidence.reason && (
              <div>
                <dt className="inline font-bold text-slate-500">Why: </dt>
                <dd className="inline font-semibold text-slate-700">{confidence.reason}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </CaseCard>
  );
}
