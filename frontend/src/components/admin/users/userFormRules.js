export const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60';

// Same rules as the server (backend/src/services/auth/passwordPolicy.js).
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 72;

export function passwordErrors(password, confirmPassword) {
  if (password.length < MIN_PASSWORD_LENGTH) return { password: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return { password: `Use at most ${MAX_PASSWORD_BYTES} bytes.` };
  }
  if (password !== confirmPassword) return { confirmPassword: 'The passwords do not match.' };
  return {};
}

/** What is missing for an Assigned Official, keyed by field. Empty when nothing is. */
export function officerErrors({ divisionId, expertise }) {
  return {
    ...(!divisionId && { divisionId: 'Choose the division this officer works in.' }),
    ...(!expertise.length && { expertise: 'Add at least one area of expertise.' }),
  };
}
