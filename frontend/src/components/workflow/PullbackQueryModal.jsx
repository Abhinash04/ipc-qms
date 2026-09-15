import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { notify } from '@/services/notify';
import {
  PREDEFINED_PULLBACK_REASONS,
  STAGE_LABELS,
  getValidPullbackStages,
} from '@/constants/pullbackRules';
import { RotateCcw, AlertTriangle, AlertCircle, HelpCircle } from 'lucide-react';

export function PullbackQueryModal({ query, isOpen, onClose, currentUser }) {
  const pullBackQuery = useWorkflowStore((state) => state.pullBackQuery);
  const auditEvents = useWorkflowStore((state) => state.auditEvents);

  const [selectedStage, setSelectedStage] = useState('');
  const [selectedReason, setSelectedReason] = useState(PREDEFINED_PULLBACK_REASONS[0]);
  const [customRemarks, setCustomRemarks] = useState('');
  const [isConfirmStep, setIsConfirmStep] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const validStages = getValidPullbackStages(query, auditEvents);

  useEffect(() => {
    if (isOpen && validStages.length > 0 && !selectedStage) {
      setSelectedStage(validStages[0]);
    }
  }, [isOpen, validStages]);

  if (!query) return null;

  const handleNextOrConfirm = () => {
    setErrorMessage(null);

    if (!selectedStage) {
      setErrorMessage('Please select a valid previous workflow stage to pull back to.');
      return;
    }

    if (!selectedReason) {
      setErrorMessage('Please select a reason for the pullback.');
      return;
    }

    if (selectedReason === 'Other' && !customRemarks.trim()) {
      setErrorMessage('Please specify additional remarks when selecting "Other".');
      return;
    }

    if (!isConfirmStep) {
      setIsConfirmStep(true);
      return;
    }

    setIsSubmitting(true);
    try {
      pullBackQuery(query.queryId, selectedStage, selectedReason, customRemarks, currentUser);
      notify.success(
        'Query Pulled Back Successfully',
        `Query ${query.queryId} has been pulled back to ${STAGE_LABELS[selectedStage] || selectedStage}.`,
      );
      handleClose();
    } catch (err) {
      setErrorMessage(err?.message || 'Failed to pull back query.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setSelectedStage(validStages[0] || '');
    setSelectedReason(PREDEFINED_PULLBACK_REASONS[0]);
    setCustomRemarks('');
    setIsConfirmStep(false);
    setIsSubmitting(false);
    setErrorMessage(null);
    onClose();
  };

  const currentStageLabel = STAGE_LABELS[query.workflowState] || query.workflowState;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto rounded-3xl p-6 bg-white border border-slate-200/90 shadow-2xl">
        <DialogHeader className="border-b border-slate-100 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-700 border border-amber-200/80 flex items-center justify-center shrink-0">
              <RotateCcw className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="font-heading text-xl font-black text-slate-900 m-0">
                Pullback Query
              </DialogTitle>
              <DialogDescription className="text-sm font-semibold text-slate-500 mt-0.5">
                Case ID: <span className="font-extrabold text-amber-700">{query.queryId}</span> •{' '}
                {query.subject}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {errorMessage && (
          <div className="my-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="font-semibold">{errorMessage}</div>
          </div>
        )}

        {!isConfirmStep ? (
          <div className="space-y-4 py-2 select-none">
            {/* Current Stage Display */}
            <div className="rounded-2xl border border-amber-200/60 bg-amber-50/60 p-3.5 flex items-center justify-between text-sm">
              <span className="font-bold text-amber-800 uppercase tracking-wider text-xs">
                Current Stage
              </span>
              <span className="font-black text-amber-950 bg-white px-3 py-1 rounded-xl border border-amber-200 shadow-2xs">
                {currentStageLabel}
              </span>
            </div>

            {/* Select Destination Stage */}
            <div className="space-y-2">
              <label className="text-sm font-black uppercase tracking-wider text-slate-700 block m-0">
                Pull Back To <span className="text-rose-500">*</span>
              </label>

              {validStages.length === 0 ? (
                <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-medium text-slate-500">
                  No previous workflow stages recorded in history for this query.
                </div>
              ) : (
                <select
                  value={selectedStage}
                  onChange={(e) => setSelectedStage(e.target.value)}
                  className="w-full py-2.5 px-3.5 text-sm font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all cursor-pointer"
                >
                  {validStages.map((stg) => (
                    <option key={stg} value={stg}>
                      {STAGE_LABELS[stg] || stg}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Reason for Pullback */}
            <div className="space-y-2">
              <label className="text-sm font-black uppercase tracking-wider text-slate-700 block">
                Reason for Pullback <span className="text-rose-500">*</span>
              </label>

              <select
                value={selectedReason}
                onChange={(e) => setSelectedReason(e.target.value)}
                className="w-full py-2.5 px-3.5 text-sm font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all cursor-pointer"
              >
                {PREDEFINED_PULLBACK_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>

              <textarea
                placeholder={
                  selectedReason === 'Other'
                    ? 'Please specify additional details regarding the pullback (Required)...'
                    : 'Additional remarks or instructions regarding this pullback (Optional)...'
                }
                value={customRemarks}
                onChange={(e) => setCustomRemarks(e.target.value)}
                rows={2}
                className="w-full p-3.5 text-sm font-medium bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all resize-none"
              />
            </div>
          </div>
        ) : (
          /* Confirmation Step */
          <div className="py-4 space-y-4 select-none">
            <div className="rounded-2xl border border-amber-300 bg-amber-50/80 p-4 space-y-3">
              <div className="flex items-center gap-2 text-amber-950">
                <HelpCircle className="h-5 w-5 text-amber-600 shrink-0" />
                <h4 className="font-heading font-black text-base text-amber-950 m-0">
                  Confirm Query Pullback
                </h4>
              </div>

              <p className="text-sm font-bold text-slate-700 leading-relaxed">
                Are you sure you want to pull back query{' '}
                <span className="font-extrabold text-amber-800">{query.queryId}</span>?
              </p>

              <div className="bg-white rounded-xl border border-amber-200/80 p-3.5 space-y-2 text-sm divide-y divide-slate-100">
                <div className="flex justify-between py-1">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-xs">
                    Current Stage:
                  </span>
                  <span className="font-bold text-slate-800">{currentStageLabel}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-xs">
                    Pull Back To:
                  </span>
                  <span className="font-extrabold text-amber-700">
                    {STAGE_LABELS[selectedStage] || selectedStage}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-xs">
                    Reason:
                  </span>
                  <span className="font-bold text-slate-800 text-right max-w-[260px]">
                    {selectedReason}
                  </span>
                </div>
                {customRemarks.trim() && (
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400 font-bold uppercase tracking-wider text-xs">
                      Remarks:
                    </span>
                    <span className="font-semibold text-slate-700 text-right max-w-[260px]">
                      {customRemarks.trim()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                Warning: This action will move the query back to the selected stage and may require further processing by the respective department or official.
              </span>
            </div>
          </div>
        )}

        <DialogFooter className="border-t border-slate-100 pt-4 flex items-center justify-end gap-2">
          {isConfirmStep ? (
            <>
              <button
                type="button"
                onClick={() => setIsConfirmStep(false)}
                disabled={isSubmitting}
                className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 transition-all cursor-pointer disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleNextOrConfirm}
                disabled={isSubmitting}
                className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-black text-sm shadow-md shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Processing Pullback...</span>
                  </>
                ) : (
                  <span>Confirm Pullback</span>
                )}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleNextOrConfirm}
                disabled={!selectedStage || validStages.length === 0}
                className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-black text-sm shadow-md shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50"
              >
                Continue to Pullback
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
