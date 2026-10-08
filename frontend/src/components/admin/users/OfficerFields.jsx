import { useId, useState } from 'react';
import { X } from 'lucide-react';

import { MOCK_DIVISIONS } from '@/constants/mockDivisions';
import { FIELD_CLASS } from './userFormRules';

const MAX_EXPERTISE = 20;
const normalise = (phrase) => phrase.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);

/**
 * The areas of expertise the Recommendation Engine matches incoming queries against: short
 * lowercase phrases such as "dissolution" or "reference standard".
 */
export function ExpertiseInput({ value, onChange, suggestions = [], disabled, invalid }) {
  const inputId = useId();
  const listId = useId();
  const [draft, setDraft] = useState('');

  const add = (raw) => {
    const phrases = raw.split(',').map(normalise).filter(Boolean);
    const next = [...new Set([...value, ...phrases])].slice(0, MAX_EXPERTISE);
    if (next.length !== value.length) onChange(next);
    setDraft('');
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="text-sm font-semibold text-slate-700">
        Areas of expertise
      </label>
      {value.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Areas of expertise">
          {value.map((phrase) => (
            <li
              key={phrase}
              className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 py-0.5 ps-2.5 pe-1 text-xs font-semibold text-amber-800"
            >
              {phrase}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((entry) => entry !== phrase))}
                aria-label={`Remove ${phrase}`}
                className="cursor-pointer rounded-full p-0.5 hover:bg-amber-100"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={inputId}
        list={listId}
        value={draft}
        disabled={disabled || value.length >= MAX_EXPERTISE}
        aria-invalid={invalid || undefined}
        aria-describedby={`${inputId}-hint`}
        onChange={(event) => {
          const text = event.target.value;
          if (text.includes(',')) add(text);
          else setDraft(text);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (draft.trim()) add(draft);
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder="e.g. dissolution, impurity profiling"
        className={FIELD_CLASS}
      />
      <datalist id={listId}>
        {suggestions
          .filter((phrase) => !value.includes(phrase))
          .map((phrase) => (
            <option key={phrase} value={phrase} />
          ))}
      </datalist>
      <p id={`${inputId}-hint`} className="m-0 text-xs text-slate-500">
        Press Enter or type a comma after each area. The Recommendation Engine suggests this officer for queries that
        mention them.
      </p>
    </div>
  );
}

/** Division and expertise, both required for an Assigned Official. */
export function OfficerFields({ divisionId, expertise, onChange, suggestions, disabled, errors = {} }) {
  const divisionField = useId();
  return (
    <div className="grid gap-4 rounded-xl border border-amber-200/70 bg-amber-50/40 p-4">
      <div className="space-y-1.5">
        <label htmlFor={divisionField} className="text-sm font-semibold text-slate-700">
          Division
        </label>
        <select
          id={divisionField}
          value={divisionId || ''}
          disabled={disabled}
          aria-invalid={errors.divisionId ? true : undefined}
          onChange={(event) => onChange({ divisionId: event.target.value || null })}
          className={`${FIELD_CLASS} cursor-pointer`}
        >
          <option value="">Select a division…</option>
          {MOCK_DIVISIONS.map((division) => (
            <option key={division.id} value={division.id}>
              {division.name}
            </option>
          ))}
        </select>
        {errors.divisionId && <p className="m-0 text-xs font-medium text-status-red-fg">{errors.divisionId}</p>}
      </div>
      <div>
        <ExpertiseInput
          value={expertise}
          onChange={(next) => onChange({ expertise: next })}
          suggestions={suggestions}
          disabled={disabled}
          invalid={Boolean(errors.expertise)}
        />
        {errors.expertise && <p className="m-0 mt-1 text-xs font-medium text-status-red-fg">{errors.expertise}</p>}
      </div>
    </div>
  );
}
