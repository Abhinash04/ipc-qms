import { useState } from "react";
import { Link } from "react-router-dom";
import { CircleDashed, TriangleAlert, UserCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CATEGORY_ORDER,
  CATEGORY_SOURCE_LABEL,
  MAIL_CATEGORY_META,
  RELATION_KINDS,
  RELATION_LABEL,
} from "@/constants/mailCategories";
import { cn } from "@/utils/cn";

const percent = (value) => `${Math.round((Number(value) || 0) * 100)}%`;

const NOT_CLASSIFIED = { label: "Not classified yet", short: "Not classified", icon: CircleDashed, variant: "status-gray" };

function RelatedLinks({ related, caseHref, messageHref }) {
  if (!related?.length) return null;

  return (
    <div>
      <h4 className="m-0 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Related</h4>
      <ul className="m-0 list-none space-y-1 p-0">
        {related.map((link) => {
          const toCase = link.queryId && caseHref ? caseHref(link.queryId) : null;
          const toMessage = link.mailboxMessageId && messageHref ? messageHref(link.mailboxMessageId) : null;
          const isCaseLink = link.kind === RELATION_KINDS.FOLLOW_UP || link.kind === RELATION_KINDS.RESEMBLES_CASE;

          return (
            <li key={`${link.kind}-${link.mailboxMessageId}-${link.queryId}`} className="text-[12.5px] font-medium text-slate-600">
              {RELATION_LABEL[link.kind] || link.kind}{" "}
              {isCaseLink ? (
                toCase ? (
                  <Link to={toCase} className="font-bold text-primary-700 hover:underline">
                    {link.queryId}
                  </Link>
                ) : (
                  <span className="font-bold">{link.queryId}</span>
                )
              ) : (
                <>
                  {toMessage && (
                    <Link to={toMessage} className="font-bold text-primary-700 hover:underline">
                      (open)
                    </Link>
                  )}
                  {link.queryId && (
                    <>
                      {" — case "}
                      {toCase ? (
                        <Link to={toCase} className="font-bold text-primary-700 hover:underline">
                          {link.queryId}
                        </Link>
                      ) : (
                        <span className="font-bold">{link.queryId}</span>
                      )}
                    </>
                  )}
                </>
              )}
              {typeof link.score === "number" && link.score < 1 && (
                <span className="text-slate-400"> · {percent(link.score)} alike</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CategorySummary({ triage, category, meta }) {
  const Icon = meta.icon;
  const corrected = triage?.categorySource === "human";
  const suggested = triage?.predictedCategory && triage.predictedCategory !== category ? MAIL_CATEGORY_META[triage.predictedCategory] : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
        <span className="text-[14px] font-bold text-slate-900">{meta.label}</span>
        {triage?.needsReview && (
          <Badge variant="status-amber">
            <TriangleAlert aria-hidden="true" />
            Needs review
          </Badge>
        )}
        {corrected && (
          <Badge variant="status-green">
            <UserCheck aria-hidden="true" />
            Corrected
          </Badge>
        )}
      </div>
      {category && (
        <p className="m-0 mt-1 text-[12px] font-medium text-slate-500">
          {corrected ? CATEGORY_SOURCE_LABEL.human : `Confidence ${percent(triage.categoryConfidence)}`}
          {!corrected && triage.categorySource ? ` · ${CATEGORY_SOURCE_LABEL[triage.categorySource] ?? triage.categorySource}` : ""}
        </p>
      )}
      {!corrected && triage?.categoryReason && (
        <p className="m-0 mt-1 text-[12.5px] font-medium italic text-slate-600">“{triage.categoryReason}”</p>
      )}
      {suggested && (
        <p className="m-0 mt-1 text-[12px] font-medium text-slate-500">
          {corrected ? "AI had predicted" : "AI suggested"} {suggested.label} ({percent(triage.predictedConfidence)})
        </p>
      )}
    </div>
  );
}

function CategoryCorrection({ category, correcting, onCorrect }) {
  return (
    <div>
      <h4 className="m-0 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Change category</h4>
      <div className="grid grid-cols-2 gap-1.5">
        {CATEGORY_ORDER.filter((key) => key !== category).map((key) => {
          const option = MAIL_CATEGORY_META[key];
          const OptionIcon = option.icon;
          return (
            <button
              key={key}
              type="button"
              disabled={correcting}
              onClick={() => onCorrect(key)}
              aria-label={`Move to ${option.label}`}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-start text-[11.5px] font-semibold text-slate-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <OptionIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{option.short}</span>
            </button>
          );
        })}
      </div>
      <p className="m-0 mt-2 text-[11.5px] font-medium text-slate-400">
        Changing the category never registers, rejects or deletes the email.
      </p>
    </div>
  );
}

export function MailCategoryDetails({ triage, onCorrect, correcting = false, caseHref, messageHref }) {
  const category = triage?.category ?? null;
  const meta = MAIL_CATEGORY_META[category] || NOT_CLASSIFIED;

  return (
    <div className="space-y-3">
      <CategorySummary triage={triage} category={category} meta={meta} />

      <RelatedLinks related={triage?.related} caseHref={caseHref} messageHref={messageHref} />

      {onCorrect && <CategoryCorrection category={category} correcting={correcting} onCorrect={onCorrect} />}
    </div>
  );
}

export function MailCategoryBadge({ triage, onCorrect, correcting = false, caseHref, messageHref, className }) {
  const [open, setOpen] = useState(false);
  const meta = MAIL_CATEGORY_META[triage?.category] || NOT_CLASSIFIED;
  const Icon = meta.icon;

  const correct = (category) => {
    setOpen(false);
    onCorrect?.(category);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Badge asChild variant={meta.variant} className={cn("shrink-0 cursor-pointer", className)}>
          <button
            type="button"
            aria-label={`Category: ${meta.label}${triage?.needsReview ? ", needs review" : ""}. Show details`}
          >
            <Icon aria-hidden="true" />
            {meta.short}
            {triage?.needsReview && <TriangleAlert aria-hidden="true" className="text-status-amber-fg" />}
          </button>
        </Badge>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <MailCategoryDetails
          triage={triage}
          onCorrect={onCorrect ? correct : undefined}
          correcting={correcting}
          caseHref={caseHref}
          messageHref={messageHref}
        />
      </PopoverContent>
    </Popover>
  );
}
