import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ROLES, ROLE_LABELS } from '@/constants/roles';
import { OfficerFields } from './OfficerFields';
import { FIELD_CLASS, officerErrors, passwordErrors } from './userFormRules';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SWITCHABLE = ['APPROVED', 'DEACTIVATED'];

function initialForm(account) {
  return {
    name: account?.name || '',
    email: account?.email || '',
    department: account?.department || '',
    designation: account?.requestedDesignation || '',
    role: account?.role || '',
    divisionId: account?.divisionId || null,
    expertise: account?.expertise || [],
    active: account ? account.status === 'APPROVED' : true,
    password: '',
    confirmPassword: '',
  };
}

function Field({ label, error, children, id }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-slate-700">
        {label}
      </label>
      {children}
      {error && <p className="m-0 text-xs font-medium text-status-red-fg">{error}</p>}
    </div>
  );
}

/** Only what differs from the account as loaded; officer fields only for an Assigned Official. */
function changesFrom(account, form, canSetRole, canSwitch) {
  const initial = initialForm(account);
  const changes = {};
  for (const field of ['name', 'email', 'department', 'designation']) {
    const value = form[field].trim();
    if (value !== initial[field]) changes[field] = field === 'email' ? value.toLowerCase() : value;
  }
  if (canSetRole && form.role !== initial.role) changes.role = form.role;
  if (form.role === ROLES.ASSIGNED_OFFICIAL) {
    if (form.divisionId !== initial.divisionId) changes.divisionId = form.divisionId;
    if (form.expertise.join('|') !== initial.expertise.join('|')) changes.expertise = form.expertise;
  }
  if (canSwitch && form.active !== initial.active) changes.active = form.active;
  return changes;
}

/**
 * Adding a user (mode "create") or editing one (mode "edit"). `onSubmit(payload)` sends it;
 * the dialog stays open with `error` if the server refuses.
 */
export function UserFormDialog({ mode, account, roles, suggestions, pending, error, onClose, onSubmit }) {
  const ids = {
    name: useId(),
    email: useId(),
    department: useId(),
    designation: useId(),
    role: useId(),
    password: useId(),
    confirmPassword: useId(),
    active: useId(),
  };
  const creating = mode === 'create';
  const [form, setForm] = useState(() => initialForm(account));
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);

  const status = account?.status;
  const canSetRole = creating || SWITCHABLE.includes(status);
  const canSwitch = !creating && SWITCHABLE.includes(status);
  const officer = form.role === ROLES.ASSIGNED_OFFICIAL;
  const roleOptions = form.role && !roles.includes(form.role) ? [form.role, ...roles] : roles;
  const update = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setNotice(null);
  };

  const validate = () => {
    const found = {};
    if (!form.name.trim()) found.name = 'Enter the full name.';
    if (!EMAIL_PATTERN.test(form.email.trim())) found.email = 'Enter a valid email address.';
    if (canSetRole && !form.role) found.role = 'Choose a role.';
    if (officer) Object.assign(found, officerErrors(form));
    if (creating) Object.assign(found, passwordErrors(form.password, form.confirmPassword));
    return found;
  };

  const submit = (event) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;

    if (creating) {
      onSubmit({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        department: form.department.trim(),
        designation: form.designation.trim(),
        role: form.role,
        ...(officer && { divisionId: form.divisionId, expertise: form.expertise }),
        password: form.password,
        confirmPassword: form.confirmPassword,
      });
      return;
    }
    const changes = changesFrom(account, form, canSetRole, canSwitch);
    if (!Object.keys(changes).length) {
      setNotice('Nothing has changed yet.');
      return;
    }
    onSubmit(changes);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{creating ? 'Add user' : `Edit ${account?.name}`}</DialogTitle>
            <DialogDescription>
              {creating
                ? 'The account is active at once. Share the password with the person through a secure channel.'
                : 'Changes apply to their next request. The password is changed separately.'}
            </DialogDescription>
          </DialogHeader>

          <Field id={ids.name} label="Full name" error={errors.name}>
            <input
              id={ids.name}
              value={form.name}
              maxLength={120}
              disabled={pending}
              aria-invalid={errors.name ? true : undefined}
              onChange={(event) => update({ name: event.target.value })}
              className={FIELD_CLASS}
            />
          </Field>
          <Field id={ids.email} label="Email" error={errors.email}>
            <input
              id={ids.email}
              type="email"
              value={form.email}
              maxLength={254}
              autoComplete="off"
              disabled={pending}
              aria-invalid={errors.email ? true : undefined}
              onChange={(event) => update({ email: event.target.value })}
              className={FIELD_CLASS}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={ids.department} label="Department">
              <input
                id={ids.department}
                value={form.department}
                maxLength={120}
                disabled={pending}
                onChange={(event) => update({ department: event.target.value })}
                className={FIELD_CLASS}
              />
            </Field>
            <Field id={ids.designation} label="Designation">
              <input
                id={ids.designation}
                value={form.designation}
                maxLength={120}
                disabled={pending}
                onChange={(event) => update({ designation: event.target.value })}
                className={FIELD_CLASS}
              />
            </Field>
          </div>

          {canSetRole ? (
            <Field id={ids.role} label="System role" error={errors.role}>
              <select
                id={ids.role}
                value={form.role}
                disabled={pending}
                aria-invalid={errors.role ? true : undefined}
                onChange={(event) => update({ role: event.target.value })}
                className={`${FIELD_CLASS} cursor-pointer`}
              >
                <option value="">Select a role…</option>
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role] || role}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <p className="m-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
              This request has no role yet. Approve it to assign one.
            </p>
          )}

          {officer && (
            <OfficerFields
              divisionId={form.divisionId}
              expertise={form.expertise}
              suggestions={suggestions}
              disabled={pending}
              errors={errors}
              onChange={update}
            />
          )}

          {creating && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={ids.password} label="Password" error={errors.password}>
                <input
                  id={ids.password}
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  disabled={pending}
                  aria-invalid={errors.password ? true : undefined}
                  onChange={(event) => update({ password: event.target.value })}
                  className={FIELD_CLASS}
                />
              </Field>
              <Field id={ids.confirmPassword} label="Confirm password" error={errors.confirmPassword}>
                <input
                  id={ids.confirmPassword}
                  type="password"
                  autoComplete="new-password"
                  value={form.confirmPassword}
                  disabled={pending}
                  aria-invalid={errors.confirmPassword ? true : undefined}
                  onChange={(event) => update({ confirmPassword: event.target.value })}
                  className={FIELD_CLASS}
                />
              </Field>
              <p className="m-0 text-xs text-slate-500 sm:col-span-2">At least 8 characters.</p>
            </div>
          )}

          {canSwitch && (
            <label htmlFor={ids.active} className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700">
              <input
                id={ids.active}
                type="checkbox"
                checked={form.active}
                disabled={pending}
                onChange={(event) => update({ active: event.target.checked })}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
              />
              <span>
                <span className="font-semibold">Active</span>
                <span className="block text-xs text-slate-500">
                  An inactive account cannot sign in and is never suggested for new work.
                </span>
              </span>
            </label>
          )}

          {(error || notice) && (
            <p
              role="alert"
              className="m-0 rounded-md border border-status-red-line bg-status-red-bg px-3 py-2 text-sm text-status-red-fg"
            >
              {error || notice}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {creating ? (pending ? 'Adding…' : 'Add user') : pending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
