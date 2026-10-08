import { Eye } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { QueryDetailPage } from '@/pages/queries/QueryDetailPage';

/**
 * The case page, read-only, in a window over the audit pages. Every section opens, expands and
 * filters as on the Queries page, but nothing here acts on the case and the admin never leaves
 * the audit trail.
 */
export function CaseViewSheet({ queryId, onClose }) {
  return (
    <Dialog open={Boolean(queryId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[92vh] flex-col gap-0 overflow-hidden bg-background p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 flex-row items-center gap-3 border-b border-slate-200 bg-card px-5 py-3 pe-14">
          <p className="m-0 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            View only
          </p>
          <DialogTitle className="font-mono text-[15px]">{queryId}</DialogTitle>
          <DialogDescription className="sr-only">The case as it stands, for viewing only.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <div className="pt-5">{queryId && <QueryDetailPage queryId={queryId} readOnly />}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
