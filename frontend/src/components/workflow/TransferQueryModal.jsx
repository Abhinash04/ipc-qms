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
import { activateOnKey } from '@/utils/a11y';
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

/** The category alone, or the category plus whatever the officer typed. */
function combineReason(category, details) {
  const trimmed = details.trim();
  if (category === 'Other') return trimmed;
  if (trimmed) return `${category} — ${trimmed}`;
  return category;
}

/** Assigned officials other than the current one, narrowed by the search box. */
function findEligibleColleagues(query, searchQuery) {
  const term = searchQuery.trim().toLowerCase();
  return MOCK_USERS.filter((user) => {
    if (user.id === query.currentAssigneeId) return false;
    if (user.role !== ROLES.ASSIGNED_OFFICIAL) return false;
    if (!term) return true;

    return Boolean(
      user.name?.toLowerCase().includes(term) ||
        user.email?.toLowerCase().includes(term) ||
        user.expertise?.some((exp) => exp.toLowerCase().includes(term)),
    );
  });
}

/**
 * Searching shows every match (carrying an AI score where one exists);
 * otherwise the AI ranking leads, falling back to the plain eligible list.
 */
function buildDisplayedOfficials(eligibleColleagues, aiRecommendations, searchQuery) {
  const asOption = (col) => ({ ...col, userId: col.id });

  if (searchQuery.trim()) {
    return eligibleColleagues.map(
      (col) => aiRecommendations.find((r) => r.userId === col.id) || asOption(col),
    );
  }
  if (aiRecommendations.length > 0) return aiRecommendations;
  return eligibleColleagues.map(asOption);
}

/** Ranks officials for this query once the dialog opens, after a short debounce. */
function useAiRecommendations(query, isOpen) {
  const [recommendations, setRecommendations] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen || !query) return;
    setIsLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      try {
        const openQueries = useWorkflowStore
          .getState()
          .queries.filter((q) => q.workflowState !== 'CLOSED');
        const recs = recommendTopOfficials(query, MOCK_USERS, openQueries, query.currentAssigneeId);
        setRecommendations(recs || []);
      } catch (err) {
        console.warn('[AI Rec] Failed to compute recommendations:', err);
        setError(
          'AI recommendations are currently unavailable. You can select an official manually.',
        );
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [isOpen, query]);

  return { recommendations, isLoading, error };
}

function CurrentAssigneeRow({ name }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-3.5 py-2.5 flex items-center justify-between text-sm">
      <span className="font-bold text-slate-500 uppercase tracking-wider text-xs">
        Current Assignee
      </span>
      <span className="font-black text-slate-800 flex items-center gap-1.5 text-sm">
        <UserCheck className="h-4 w-4 text-indigo-600" />
        {name}
      </span>
    </div>
  );
}

/** A match score when the AI ranked this official, otherwise a selection tick. */
function OfficialCardBadge({ rec, isSelected }) {
  if (rec.matchPercent) {
    return (
      <span className="text-xs font-black text-indigo-700 bg-indigo-100/80 px-2.5 py-1 rounded-full border border-indigo-200/80 shrink-0">
        {rec.matchPercent}% Match
      </span>
    );
  }
  if (isSelected) {
    return <CheckCircle2 className="h-5 w-5 text-indigo-600 shrink-0 ml-1" />;
  }
  return null;
}

/** One selectable official, with their division, expertise and AI match score. */
function OfficialCard({ rec, isSelected, onSelect }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={onSelect}
      onKeyDown={activateOnKey(onSelect)}
      className={`w-full p-3.5 text-left rounded-2xl border transition-[background-color,border-color,box-shadow] cursor-pointer flex flex-col justify-between space-y-2 select-none ${
        isSelected
          ? 'bg-indigo-50/90 border-indigo-500 ring-2 ring-indigo-500/20 shadow-xs'
          : 'bg-white hover:bg-slate-50/90 border-slate-200/80 shadow-2xs'
      }`}
    >
      <div>
        <div className="flex items-start justify-between gap-1">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-black text-slate-900 leading-tight">{rec.name}</span>
              {rec.divisionId && (
                <span className="text-xs font-black text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/60">
                  {rec.divisionId}
                </span>
              )}
            </div>
            <p className="text-xs font-medium text-slate-500 truncate max-w-[220px]">{rec.email}</p>
          </div>

          <OfficialCardBadge rec={rec} isSelected={isSelected} />
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
}

/** The results area: loading, unavailable, empty, or the list of officials. */
function OfficialResults({ isLoading, error, officials, searchQuery, selectedId, onSelect }) {
  if (isLoading) {
    return (
      <div className="p-4 rounded-2xl border border-indigo-100 bg-indigo-50/50 flex items-center justify-center gap-2 text-sm font-bold text-indigo-700 animate-pulse">
        <Sparkles className="h-4 w-4 text-indigo-500 animate-spin" />
        <span>Analyzing query and finding suitable officials...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3.5 rounded-2xl border border-slate-200/80 bg-slate-50 text-sm font-semibold text-slate-500 flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (officials.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-slate-500 font-medium bg-slate-50 rounded-2xl border border-slate-200">
        {searchQuery.trim()
          ? `No eligible colleagues found matching "${searchQuery}"`
          : 'No strong AI recommendations found.'}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2.5 max-h-80 overflow-y-auto pr-0.5">
      {officials.map((rec) => {
        const officialId = rec.userId || rec.id;
        return (
          <OfficialCard
            key={officialId}
            rec={rec}
            isSelected={selectedId === officialId}
            onSelect={() => onSelect(officialId)}
          />
        );
      })}
    </div>
  );
}

/** Step 1: search for and pick the receiving official. */
function SelectColleagueSection({
  searchQuery,
  onSearchChange,
  isLoading,
  error,
  officials,
  selectedId,
  onSelect,
}) {
  return (
    <div className="space-y-3 pt-1.5">
      <label
        htmlFor="transfer-colleague-search"
        className="text-sm font-black uppercase tracking-wider text-slate-700 block m-0"
      >
        1. Select Colleague / Official <span className="text-rose-500">*</span>
      </label>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          id="transfer-colleague-search"
          type="text"
          placeholder="Search colleague by name, email, or expertise..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 text-sm font-medium bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
        />
      </div>

      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sm font-black text-indigo-700">
            <Sparkles className="h-4 w-4 text-amber-500 fill-amber-400" />
            <span>{searchQuery.trim() ? 'SEARCH RESULTS' : 'AI RECOMMENDED OFFICIALS'}</span>
          </div>
        </div>

        <OfficialResults
          isLoading={isLoading}
          error={error}
          officials={officials}
          searchQuery={searchQuery}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

/** Step 2: why the case is moving. */
function TransferReasonSection({ category, onCategoryChange, details, onDetailsChange }) {
  const detailsPlaceholder =
    category === 'Other'
      ? 'Please specify the exact reason for transfer (Required)...'
      : 'Additional notes or remarks regarding this transfer (Optional)...';

  return (
    <div className="space-y-2 pt-1">
      <label
        htmlFor="transfer-reason-category"
        className="text-sm font-black uppercase tracking-wider text-slate-700 block"
      >
        2. Reason for Transfer <span className="text-rose-500">*</span>
      </label>

      <select
        id="transfer-reason-category"
        value={category}
        onChange={(e) => onCategoryChange(e.target.value)}
        className="w-full py-2.5 px-3.5 text-sm font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors cursor-pointer"
      >
        {PREDEFINED_REASONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>

      <textarea
        placeholder={detailsPlaceholder}
        value={details}
        onChange={(e) => onDetailsChange(e.target.value)}
        rows={2}
        className="w-full p-3.5 text-sm font-medium bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors resize-none"
      />
    </div>
  );
}

function SummaryRow({ label, children, valueClassName = 'font-bold text-slate-800' }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-slate-400 font-bold uppercase tracking-wider text-xs">{label}</span>
      <span className={valueClassName}>{children}</span>
    </div>
  );
}

/** Final read-back before the transfer is committed. */
function TransferConfirmation({ query, fromName, toName, byName, reason }) {
  return (
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
            {toName}
          </span>
          ?
        </p>

        <div className="bg-white rounded-xl border border-indigo-100 p-3.5 space-y-2 text-sm divide-y divide-slate-100">
          <SummaryRow label="Transferred From:">{fromName}</SummaryRow>
          <SummaryRow label="Transferred To:" valueClassName="font-extrabold text-indigo-700">
            {toName}
          </SummaryRow>
          <SummaryRow label="Transferred By:">{byName}</SummaryRow>
          <SummaryRow
            label="Reason:"
            valueClassName="font-bold text-slate-800 text-right max-w-[260px]"
          >
            {reason}
          </SummaryRow>
        </div>
      </div>

      <p className="text-xs font-semibold text-slate-500 leading-relaxed">
        Note: The new assignee will be notified immediately. The query will remain in its current
        workflow state and move into the new assignee&apos;s active work queue.
      </p>
    </div>
  );
}

function TransferFooter({ isConfirmStep, isSubmitting, canContinue, onBack, onCancel, onAdvance }) {
  if (!isConfirmStep) {
    return (
      <>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onAdvance}
          disabled={!canContinue}
          className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm shadow-md shadow-indigo-500/20 transition-colors cursor-pointer disabled:opacity-50"
        >
          Continue to Transfer
        </button>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        disabled={isSubmitting}
        className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
      >
        Back
      </button>
      <button
        type="button"
        onClick={onAdvance}
        disabled={isSubmitting}
        className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm shadow-md shadow-indigo-500/20 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
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
  );
}

export function TransferQueryModal({ query, isOpen, onClose, currentUser }) {
  const transferQuery = useWorkflowStore((state) => state.transferQuery);
  const [selectedAssigneeId, setSelectedAssigneeId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReasonCategory, setSelectedReasonCategory] = useState(PREDEFINED_REASONS[0]);
  const [customReasonDetails, setCustomReasonDetails] = useState('');
  const [isConfirmStep, setIsConfirmStep] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const {
    recommendations: aiRecommendations,
    isLoading: isLoadingAiRecs,
    error: aiRecError,
  } = useAiRecommendations(query, isOpen);

  if (!query) return null;

  const eligibleColleagues = findEligibleColleagues(query, searchQuery);
  const displayedOfficials = buildDisplayedOfficials(
    eligibleColleagues,
    aiRecommendations,
    searchQuery,
  );

  const currentAssigneeUser = findUserById(query.currentAssigneeId);
  const selectedColleague = findUserById(selectedAssigneeId);

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

  const handleNextOrConfirm = () => {
    setErrorMessage(null);

    if (!selectedAssigneeId) {
      setErrorMessage('Please select a colleague/official to transfer this query to.');
      return;
    }

    const finalReason = combineReason(selectedReasonCategory, customReasonDetails);
    if (!finalReason) {
      setErrorMessage('Please provide a reason for the transfer.');
      return;
    }

    if (!isConfirmStep) {
      setIsConfirmStep(true);
      return;
    }

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

        {isConfirmStep ? (
          <TransferConfirmation
            query={query}
            fromName={currentAssigneeUser?.name || 'Unassigned'}
            toName={selectedColleague?.name}
            byName={currentUser?.name || 'System Official'}
            reason={combineReason(selectedReasonCategory, customReasonDetails)}
          />
        ) : (
          <div className="space-y-4.5 pt-2 pb-1 select-none">
            <CurrentAssigneeRow
              name={currentAssigneeUser?.name || query.currentAssigneeId || 'Unassigned'}
            />

            <SelectColleagueSection
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              isLoading={isLoadingAiRecs}
              error={aiRecError}
              officials={displayedOfficials}
              selectedId={selectedAssigneeId}
              onSelect={setSelectedAssigneeId}
            />

            <TransferReasonSection
              category={selectedReasonCategory}
              onCategoryChange={setSelectedReasonCategory}
              details={customReasonDetails}
              onDetailsChange={setCustomReasonDetails}
            />
          </div>
        )}

        <DialogFooter className="border-t border-slate-100 pt-4 flex items-center justify-end gap-2">
          <TransferFooter
            isConfirmStep={isConfirmStep}
            isSubmitting={isSubmitting}
            canContinue={Boolean(selectedAssigneeId)}
            onBack={() => setIsConfirmStep(false)}
            onCancel={handleClose}
            onAdvance={handleNextOrConfirm}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
