import { Users } from "lucide-react";

import { buildCaseOfficials } from "@/constants/caseOfficials";
import { STAGE_STATUS } from "@/constants/queryLifecycle";
import { cn } from "@/utils/cn";

const STATUS_STYLES = {
  [STAGE_STATUS.COMPLETE]: "bg-emerald-50 text-emerald-700 border-emerald-200",
  [STAGE_STATUS.CURRENT]: "bg-blue-50 text-blue-700 border-blue-200",
  [STAGE_STATUS.PENDING]: "bg-slate-50 text-slate-400 border-slate-200",
};

const STATUS_LABELS = {
  [STAGE_STATUS.COMPLETE]: "Completed",
  [STAGE_STATUS.CURRENT]: "Current",
  [STAGE_STATUS.PENDING]: "Pending",
};

const initials = (name) =>
  (name || "?")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** Lightweight rows, not cards — this is supporting context, not the content. */
export function CaseOfficialsCard({ query, steps, audit }) {
  const officials = buildCaseOfficials({ query, steps, audit });
  if (officials.length === 0) return null;

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-sm select-none">
      <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3 mb-3">
        <Users className="h-4.5 w-4.5 text-slate-400" strokeWidth={2.2} />
        <h2 className="font-heading text-[17px] font-black text-slate-900 m-0">
          Officials
        </h2>
      </div>

      <ul className="m-0 list-none p-0 divide-y divide-slate-100">
        {officials.map((person) => (
          <li
            key={person.role}
            className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[11px] font-black border",
                person.name
                  ? "bg-purple-50 text-purple-700 border-purple-100"
                  : "bg-slate-50 text-slate-300 border-slate-200",
              )}
            >
              {initials(person.name)}
            </span>

            <div className="min-w-0 flex-1">
              <p className="m-0 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {person.role}
              </p>
              <p className="m-0 text-[13.5px] font-extrabold text-slate-800 truncate">
                {person.name || "Not yet assigned"}
              </p>
            </div>

            <span
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold",
                STATUS_STYLES[person.status],
              )}
            >
              {STATUS_LABELS[person.status]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
