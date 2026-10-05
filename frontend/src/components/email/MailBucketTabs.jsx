import { Bot, Inbox, UserRound } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MAIL_BUCKETS, MAIL_BUCKET_META } from "@/constants/mailCategories";

const ICON = {
  [MAIL_BUCKETS.ALL]: Inbox,
  [MAIL_BUCKETS.AUTO_REPLY]: Bot,
  [MAIL_BUCKETS.HUMAN]: UserRound,
};

/** All Mails · Auto Reply · Human Intervention, each with how many mails it holds. */
export function MailBucketTabs({ value, counts = {}, onChange }) {
  return (
    <Tabs value={value} onValueChange={onChange} className="mb-5">
      <TabsList aria-label="Mailbox views">
        {Object.values(MAIL_BUCKETS).map((bucket) => {
          const Icon = ICON[bucket];
          const count = counts[bucket] ?? 0;
          return (
            <TabsTrigger key={bucket} value={bucket} title={MAIL_BUCKET_META[bucket].description} className="gap-1.5">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {MAIL_BUCKET_META[bucket].label}
              <span className="rounded-full bg-slate-100 px-1.5 py-px text-[11px] font-bold tabular-nums text-slate-600">
                {count.toLocaleString("en-IN")}
              </span>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
