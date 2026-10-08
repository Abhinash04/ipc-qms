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
import { FIELD_CLASS, passwordErrors } from './userFormRules';

/** Sets a new password for someone; every session signed in with the old one ends. */
export function ResetPasswordDialog({ account, pending, error, onClose, onSubmit }) {
  const passwordId = useId();
  const confirmId = useId();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState({});

  const submit = (event) => {
    event.preventDefault();
    const found = passwordErrors(password, confirmPassword);
    setErrors(found);
    if (!Object.keys(found).length) onSubmit({ password, confirmPassword });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Set a new password for {account.name} ({account.email}). They are signed out everywhere and sign in
              again with the new one.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <label htmlFor={passwordId} className="text-sm font-semibold text-slate-700">
              New password
            </label>
            <input
              id={passwordId}
              type="password"
              autoComplete="new-password"
              value={password}
              disabled={pending}
              aria-invalid={errors.password ? true : undefined}
              onChange={(event) => setPassword(event.target.value)}
              className={FIELD_CLASS}
            />
            {errors.password && <p className="m-0 text-xs font-medium text-status-red-fg">{errors.password}</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={confirmId} className="text-sm font-semibold text-slate-700">
              Confirm new password
            </label>
            <input
              id={confirmId}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              disabled={pending}
              aria-invalid={errors.confirmPassword ? true : undefined}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className={FIELD_CLASS}
            />
            {errors.confirmPassword && (
              <p className="m-0 text-xs font-medium text-status-red-fg">{errors.confirmPassword}</p>
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="m-0 rounded-md border border-status-red-line bg-status-red-bg px-3 py-2 text-sm text-status-red-fg"
            >
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
