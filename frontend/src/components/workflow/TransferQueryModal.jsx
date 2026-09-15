import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { MOCK_USERS, findUserById } from '@/constants/mockUsers';
import { ROLES } from '@/constants/roles';
import { recommendTopOfficials } from '@/services/ai/mockAiService';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { notify } from '@/services/notify';
import {
  UserCheck,
  Search,
  ArrowRightLeft,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Sparkles,
} from 'lucide-react';

const PREDEFINED_REASONS = [
  'Query belongs to another department',
  'Colleague has better expertise',
  'Workload redistribution',
  'Official is unavailable',
  'Other',
];

export function TransferQueryModal({ query, isOpen, onClose, currentUser }) {
  const transferQuery = useWorkflowStore((state) => state.transferQuery);
  const [selectedAssigneeId, setSelectedAssigneeId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReasonCategory, setSelectedReasonCategory] = useState(PREDEFINED_REASONS[0]);
  const [customReasonDetails, setCustomReasonDetails] = useState('');
  const [isConfirmStep, setIsConfirmStep] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const [aiRecommendations, setAiRecommendations] = useState([]);
  const [isLoadingAiRecs, setIsLoadingAiRecs] = useState(false);
  const [aiRecError, setAiRecError] = useState(null);

  useEffect(() => {
    if (!isOpen || !query) return;
    setIsLoadingAiRecs(true);
    setAiRecError(null);

    const timer = setTimeout(() => {
      try {
        const openQueries = useWorkflowStore.getState().queries.filter((q) => q.workflowState !== 'CLOSED');
        const recs = recommendTopOfficials(query, MOCK_USERS, openQueries, query.currentAssigneeId);
        setAiRecommendations(recs || []);
      } catch (err) {
        console.warn('[AI Rec] Failed to compute recommendations:', err);
        setAiRecError('AI recommendations are currently unavailable. You can select an official manually.');
      } finally {
        setIsLoadingAiRecs(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [isOpen, query?.queryId]);

  if (!query) return null;

  // Filter eligible colleagues: assigned officials, active, excluding current assignee
  const eligibleColleagues = MOCK_USERS.filter((user) => {
    if (user.id === query.currentAssigneeId) return false;
    if (user.role !== ROLES.ASSIGNED_OFFICIAL) return false;
    if (!searchQuery.trim()) return true;

    const term = searchQuery.toLowerCase();
    const nameMatch = user.name?.toLowerCase().includes(term);
    const emailMatch = user.email?.toLowerCase().includes(term);
    const expertiseMatch = user.expertise?.some((exp) => exp.toLowerCase().includes(term));
    return nameMatch || emailMatch || expertiseMatch;
  });

  const displayedOfficials = searchQuery.trim()
    ? eligibleColleagues.map((col) => {
      const aiRec = aiRecommendations.find((r) => r.userId === col.id);
      return aiRec || { ...col, userId: col.id };
    })
    : aiRecommendations.length > 0
      ? aiRecommendations
      : eligibleColleagues.map((col) => ({ ...col, userId: col.id }));

  const currentAssigneeUser = findUserById(query.currentAssigneeId);
  const selectedColleague = findUserById(selectedAssigneeId);

  const getCombinedReason = () => {
    if (selectedReasonCategory === 'Other') {
      return customReasonDetails.trim();
    }
    if (customReasonDetails.trim()) {
      return `${selectedReasonCategory} — ${customReasonDetails.trim()}`;
    }
    return selectedReasonCategory;
  };

  const handleNextOrConfirm = () => {
    setErrorMessage(null);

    if (!selectedAssigneeId) {
      setErrorMessage('Please select a colleague/official to transfer this query to.');
      return;
    }

    const finalReason = getCombinedReason();
    if (!finalReason) {
      setErrorMessage('Please provide a reason for the transfer.');
      return;
    }

    if (!isConfirmStep) {
      setIsConfirmStep(true);
      return;
    }

    // Process transfer
    setIsSubmitting(true);
    try {
      transferQuery(query.queryId, selectedAssigneeId, finalReason, currentUser);
      notify.success(
        'Query Transferred Successfully',
        `Query ${query.queryId} has been transferred to ${selectedColleague?.name || selectedAssigneeId}.`,
      );
      handleClose();
    } catch (err) {
      setErrorMessage(err?.message || 'Failed to transfer query.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setSelectedAssigneeId('');
    setSearchQuery('');
    setSelectedReasonCategory(PREDEFINED_REASONS[0]);
    setCustomReasonDetails('');
    setIsConfirmStep(false);
    setIsSubmitting(false);
    setErrorMessage(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto rounded-3xl p-6 bg-white border border-slate-200/90 shadow-2xl">
        <DialogHeader className="border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-700 border border-indigo-100 flex items-center justify-center shrink-0">
              <ArrowRightLeft className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="font-heading text-xl font-black text-slate-900 m-0">
                Transfer Query
              </DialogTitle>
              <DialogDescription className="text-sm font-semibold text-slate-500 mt-0.5">
                Case ID: <span className="font-extrabold text-indigo-700">{query.queryId}</span> •{' '}
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
          <div className="space-y-4.5 pt-2 pb-1 select-none">
            {/* Current Assignee Info */}
            <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-3.5 py-2.5 flex items-center justify-between text-sm">
              <span className="font-bold text-slate-500 uppercase tracking-wider text-xs">
                Current Assignee
              </span>
              <span className="font-black text-slate-800 flex items-center gap-1.5 text-sm">
                <UserCheck className="h-4 w-4 text-indigo-600" />
                {currentAssigneeUser?.name || query.currentAssigneeId || 'Unassigned'}
              </span>
            </div>

            {/* Select Colleague Section */}
            <div className="space-y-3 pt-1.5">
              <label className="text-sm font-black uppercase tracking-wider text-slate-700 block m-0">
                1. Select Colleague / Official <span className="text-rose-500">*</span>
              </label>

              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search colleague by name, email, or expertise..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 text-sm font-medium bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>

              {/* AI Recommended / Search Results Area */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-sm font-black text-indigo-700">
                    <Sparkles className="h-4 w-4 text-amber-500 fill-amber-400" />
                    <span>{searchQuery.trim() ? 'SEARCH RESULTS' : 'AI RECOMMENDED OFFICIALS'}</span>
                  </div>
                  {/* {!searchQuery.trim() && aiRecommendations.length > 0 && !isLoadingAiRecs && (
                    <span className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">
                      ✨ Ranked by expertise &amp; workload
                    </span>
                  )} */}
                </div>

                {isLoadingAiRecs ? (
                  <div className="p-4 rounded-2xl border border-indigo-100 bg-indigo-50/50 flex items-center justify-center gap-2 text-sm font-bold text-indigo-700 animate-pulse">
                    <Sparkles className="h-4 w-4 text-indigo-500 animate-spin" />
                    <span>Analyzing query and finding suitable officials...</span>
                  </div>
                ) : aiRecError ? (
                  <div className="p-3.5 rounded-2xl border border-slate-200/80 bg-slate-50 text-sm font-semibold text-slate-500 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                    <span>{aiRecError}</span>
                  </div>
                ) : displayedOfficials.length === 0 ? (
                  <div className="p-4 text-center text-sm text-slate-500 font-medium bg-slate-50 rounded-2xl border border-slate-200">
                    {searchQuery.trim()
                      ? `No eligible colleagues found matching "${searchQuery}"`
                      : 'No strong AI recommendations found.'}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2.5 max-h-80 overflow-y-auto pr-0.5">
                    {displayedOfficials.map((rec) => {
                      const officialId = rec.userId || rec.id;
                      const isSelected = selectedAssigneeId === officialId;
                      return (
                        <div
                          key={officialId}
                          onClick={() => setSelectedAssigneeId(officialId)}
                          className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between space-y-2 select-none ${isSelected
                              ? 'bg-indigo-50/90 border-indigo-500 ring-2 ring-indigo-500/20 shadow-xs'
                              : 'bg-white hover:bg-slate-50/90 border-slate-200/80 shadow-2xs'
                            }`}
                        >
                          <div>
                            <div className="flex items-start justify-between gap-1">
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-black text-slate-900 leading-tight">
                                    {rec.name}
                                  </span>
                                  {rec.divisionId && (
                                    <span className="text-xs font-black text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/60">
                                      {rec.divisionId}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs font-medium text-slate-500 truncate max-w-[220px]">
                                  {rec.email}
                                </p>
                              </div>

                              {rec.matchPercent ? (
                                <span className="text-xs font-black text-indigo-700 bg-indigo-100/80 px-2.5 py-1 rounded-full border border-indigo-200/80 shrink-0">
                                  {rec.matchPercent}% Match
                                </span>
                              ) : isSelected ? (
                                <CheckCircle2 className="h-5 w-5 text-indigo-600 shrink-0 ml-1" />
                              ) : null}
                            </div>

                            {rec.expertise && rec.expertise.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {rec.expertise.slice(0, 3).map((exp) => (
                                  <span
                                    key={exp}
                                    className="text-xs font-bold text-slate-600 bg-slate-100/90 px-2 py-0.5 rounded"
                                  >
                                    {exp}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Reason for Transfer */}
            <div className="space-y-2 pt-1">
              <label className="text-sm font-black uppercase tracking-wider text-slate-700 block">
                2. Reason for Transfer <span className="text-rose-500">*</span>
              </label>

              <select
                value={selectedReasonCategory}
                onChange={(e) => setSelectedReasonCategory(e.target.value)}
                className="w-full py-2.5 px-3.5 text-sm font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all cursor-pointer"
              >
                {PREDEFINED_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>

              <textarea
                placeholder={
                  selectedReasonCategory === 'Other'
                    ? 'Please specify the exact reason for transfer (Required)...'
                    : 'Additional notes or remarks regarding this transfer (Optional)...'
                }
                value={customReasonDetails}
                onChange={(e) => setCustomReasonDetails(e.target.value)}
                rows={2}
                className="w-full p-3.5 text-sm font-medium bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none"
              />
            </div>
          </div>
        ) : (
          /* Confirmation Step */
          <div className="py-4 space-y-4 select-none">
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 space-y-3">
              <div className="flex items-center gap-2 text-indigo-900">
                <HelpCircle className="h-5 w-5 text-indigo-600 shrink-0" />
                <h4 className="font-heading font-black text-base text-indigo-950 m-0">
                  Confirm Query Transfer
                </h4>
              </div>

              <p className="text-sm font-bold text-slate-700 leading-relaxed">
                Are you sure you want to transfer query{' '}
                <span className="font-extrabold text-indigo-800">{query.queryId}</span> to{' '}
                <span className="font-black text-indigo-900 bg-white px-2 py-0.5 rounded border border-indigo-200">
                  {selectedColleague?.name}
                </span>
                ?
              </p>

              <div className="bg-white rounded-xl border border-indigo-100 p-3.5 space-y-2 text-sm divide-y divide-slate-100">
                <div className="flex justify-between py-1">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-xs">
                    Transferred From:
                  </span>
                  <span className="font-bold text-slate-800">
                    {currentAssigneeUser?.name || 'Unassigned'}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-xs">
                    Transferred To:
                  </span>
                  <span className="font-extrabold text-indigo-700">{selectedColleague?.name}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-xs">
                    Transferred By:
                  </span>
                  <span className="font-bold text-slate-800">
                    {currentUser?.name || 'System Official'}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-xs">Reason:</span>
                  <span className="font-bold text-slate-800 text-right max-w-[260px]">
                    {getCombinedReason()}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-xs font-semibold text-slate-500 leading-relaxed">
              Note: The new assignee will be notified immediately. The query will remain in its
              current workflow state and move into the new assignee&apos;s active work queue.
            </p>
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
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm shadow-md shadow-indigo-500/20 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Processing Transfer...</span>
                  </>
                ) : (
                  <span>Confirm &amp; Transfer</span>
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
                disabled={!selectedAssigneeId}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm shadow-md shadow-indigo-500/20 transition-all cursor-pointer disabled:opacity-50"
              >
                Continue to Transfer
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

