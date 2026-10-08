import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Users,
  User,
  UserCheck,
  UserCog,
  UserX,
  UserMinus,
  Clock,
  Crown,
  ShieldCheck,
  Eye,
  Filter,
  Loader2,
  MoreVertical,
  Pencil,
  KeyRound,
  UserPlus,
  RotateCcw,
} from 'lucide-react';

import { Breadcrumb } from '@/components/common/Breadcrumb';
import { PageHeader } from '@/components/common/PageHeader';
import { StatTile } from '@/components/common/StatTile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DecisionCommentDialog } from '@/components/workflow/DecisionCommentDialog';
import { OfficerFields } from '@/components/admin/users/OfficerFields';
import { officerErrors } from '@/components/admin/users/userFormRules';
import { UserFormDialog } from '@/components/admin/users/UserFormDialog';
import { ResetPasswordDialog } from '@/components/admin/users/ResetPasswordDialog';
import { findDivisionById } from '@/constants/mockDivisions';
import { ROLES, ROLE_LABELS } from '@/constants/roles';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useAuthStore } from '@/store/useAuthStore';
import { notify } from '@/services/notify';
import {
  fetchAccounts,
  approveAccount,
  rejectAccount,
  deactivateAccount,
  reactivateAccount,
  changeAccountRole,
  createAccount,
  updateAccount,
  resetAccountPassword,
} from '@/services/api/userAdminService';
import { formatTime, relativeTime } from '@/components/admin/auditFormat';
import { EXPERTISE_AREAS } from '@/constants/expertise';

const ROLE_BADGE_STYLE = {
  [ROLES.SUPER_ADMIN]: { bg: 'bg-purple-100/90 text-purple-700 border-purple-200/80', icon: Crown },
  [ROLES.ADMIN]: { bg: 'bg-emerald-100/90 text-emerald-700 border-emerald-200/80', icon: UserCheck },
  [ROLES.OFFICER_IN_CHARGE]: { bg: 'bg-blue-100/90 text-blue-700 border-blue-200/80', icon: UserCog },
  [ROLES.ASSIGNED_OFFICIAL]: { bg: 'bg-amber-100/90 text-amber-800 border-amber-200/80', icon: User },
  [ROLES.REVIEWER]: { bg: 'bg-rose-100/90 text-rose-700 border-rose-200/80', icon: Eye },
  [ROLES.FRONT_OFFICE]: { bg: 'bg-emerald-100/90 text-emerald-700 border-emerald-200/80', icon: ShieldCheck },
};

const STATUS = {
  PENDING: { label: 'Pending', tile: 'Pending requests', variant: 'status-amber', tone: 'amber', icon: Clock },
  APPROVED: { label: 'Approved', tile: 'Approved users', variant: 'status-green', tone: 'emerald', icon: UserCheck },
  REJECTED: { label: 'Rejected', tile: 'Rejected requests', variant: 'status-red', tone: 'rose', icon: UserX },
  DEACTIVATED: { label: 'Deactivated', tile: 'Deactivated users', variant: 'status-gray', tone: 'slate', icon: UserMinus },
};
const STATUS_ORDER = ['PENDING', 'APPROVED', 'REJECTED', 'DEACTIVATED'];

// Mirrors the server: only a Super Admin grants, changes or restores an administrator role.
const ADMIN_ROLES = [ROLES.ADMIN, ROLES.SUPER_ADMIN];
const grantableRoles = (viewer) =>
  Object.values(ROLES).filter((role) => viewer?.role === ROLES.SUPER_ADMIN || !ADMIN_ROLES.includes(role));

const APPROVED_MESSAGE =
  'User approved successfully. The account is now active and can log in with the registered credentials.';
const errorOf = (failure) => failure?.response?.data?.error || failure?.message || 'Please try again.';
const when = (iso) => (iso ? formatTime(iso) : '—');

function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function RoleBadge({ role }) {
  if (!role) return <span className="text-xs font-medium text-slate-400">Not assigned</span>;
  const style = ROLE_BADGE_STYLE[role] || { bg: 'bg-slate-100 text-slate-700 border-slate-200', icon: User };
  const Icon = style.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold ${style.bg}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {ROLE_LABELS[role] || role}
    </span>
  );
}

function StatusBadge({ status }) {
  const meta = STATUS[status] || STATUS.PENDING;
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

/** What the viewer may do with an account; the server enforces the same rules. */
function allowedActions(account, viewer) {
  if (account.source === 'built-in' || account.id === viewer?.id) return [];
  const isSuper = viewer?.role === ROLES.SUPER_ADMIN;
  const adminTarget = ADMIN_ROLES.includes(account.role);
  switch (account.status) {
    case 'PENDING':
      return ['edit', 'approve', 'reject'];
    case 'REJECTED':
      return ['approve'];
    case 'APPROVED':
      return adminTarget && !isSuper ? [] : ['edit', 'role', 'password', 'deactivate'];
    case 'DEACTIVATED':
      return adminTarget && !isSuper ? [] : ['edit', 'reactivate', 'password'];
    default:
      return [];
  }
}

function lockedReason(account, viewer) {
  if (account.source === 'built-in') return 'Built-in account. It is managed by configuration and cannot be changed here.';
  if (account.id === viewer?.id) return 'This is your own account. Another administrator must change it.';
  if (ADMIN_ROLES.includes(account.role) && viewer?.role !== ROLES.SUPER_ADMIN) {
    return 'Only a Super Admin can change an administrator account.';
  }
  return null;
}

function Detail({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="m-0 mt-0.5 text-[13.5px] font-medium text-slate-800 wrap-break-word">{children || '—'}</dd>
    </div>
  );
}

/** Approving (role required) or changing the role of an approved account. */
function RoleDialog({ account, mode, viewer, suggestions, onClose, onConfirm, pending, error }) {
  const fieldId = useId();
  const [role, setRole] = useState('');
  const [officer, setOfficer] = useState({ divisionId: account?.divisionId || null, expertise: account?.expertise || [] });
  const [officerProblems, setOfficerProblems] = useState({});
  const approving = mode === 'approve';
  const options = grantableRoles(viewer).filter((option) => option !== account?.role);
  const needsOfficer = role === ROLES.ASSIGNED_OFFICIAL;

  return (
    <Dialog open={Boolean(account)} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!role) return;
            if (!needsOfficer) return onConfirm(role);
            const problems = officerErrors(officer);
            setOfficerProblems(problems);
            if (!Object.keys(problems).length) onConfirm(role, officer);
          }}
        >
          <DialogHeader>
            <DialogTitle>{approving ? 'Approve registration' : 'Change role'}</DialogTitle>
            <DialogDescription>
              {approving
                ? `Choose the system role for ${account?.name}. They can sign in with the password they registered once approved.`
                : `Choose the new role for ${account?.name}. It applies to their next request.`}
            </DialogDescription>
          </DialogHeader>

          {approving && (
            <p className="m-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
              Requested designation: <strong className="text-slate-800">{account?.requestedDesignation || '—'}</strong>.
              This is what they asked for, not a role. Assign the role their work needs.
            </p>
          )}

          <div className="space-y-1.5">
            <label htmlFor={fieldId} className="text-sm font-semibold text-slate-700">
              System role
            </label>
            <select
              id={fieldId}
              value={role}
              onChange={(event) => setRole(event.target.value)}
              required
              disabled={pending}
              className="w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Select a role…</option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {ROLE_LABELS[option] || option}
                </option>
              ))}
            </select>
          </div>

          {needsOfficer && (
            <OfficerFields
              divisionId={officer.divisionId}
              expertise={officer.expertise}
              suggestions={suggestions}
              disabled={pending}
              errors={officerProblems}
              onChange={(patch) => setOfficer((current) => ({ ...current, ...patch }))}
            />
          )}

          {error && (
            <p role="alert" className="m-0 rounded-md border border-status-red-line bg-status-red-bg px-3 py-2 text-sm text-status-red-fg">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !role}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {approving ? 'Approve' : 'Change role'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const CONFIRM_COPY = {
  deactivate: {
    title: 'Deactivate account',
    body: ({ name, email }) =>
      `${name} (${email}) will be signed out at once, cannot sign in, and is no longer suggested for new work. Accounts are never deleted, so their history stays intact; you can reactivate it later.`,
    action: 'Deactivate',
  },
  reactivate: {
    title: 'Reactivate account',
    body: ({ name }) => `${name} can sign in again with the role they had.`,
    action: 'Reactivate',
  },
};

function ConfirmDialog({ account, kind, onClose, onConfirm, pending, error }) {
  const copy = CONFIRM_COPY[kind];
  return (
    <Dialog open={Boolean(account && copy)} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy?.title}</DialogTitle>
          <DialogDescription>{account && copy?.body(account)}</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="m-0 rounded-md border border-status-red-line bg-status-red-bg px-3 py-2 text-sm text-status-red-fg">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={kind === 'deactivate' ? 'destructive' : 'primary'}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {copy?.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ACTION_BUTTONS = {
  edit: { label: 'Edit', variant: 'outline' },
  password: { label: 'Reset password', variant: 'outline' },
  approve: { label: 'Approve', variant: 'primary' },
  reject: { label: 'Reject', variant: 'destructive' },
  role: { label: 'Change role', variant: 'outline' },
  deactivate: { label: 'Deactivate', variant: 'destructive' },
  reactivate: { label: 'Reactivate', variant: 'primary' },
};

function AccountDialog({ account, viewer, onClose, onAction }) {
  const actions = account ? allowedActions(account, viewer) : [];
  const locked = account ? lockedReason(account, viewer) : null;

  return (
    <Dialog open={Boolean(account)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {account?.name}
            {account && <StatusBadge status={account.status} />}
          </DialogTitle>
          <DialogDescription>{account?.email}</DialogDescription>
        </DialogHeader>

        {account && (
          <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Detail label="Designation">{account.requestedDesignation}</Detail>
            <Detail label="Department">{account.department}</Detail>
            <Detail label="Assigned role">
              <RoleBadge role={account.role} />
            </Detail>
            <Detail label="Account type">{account.source === 'built-in' ? 'Built-in' : 'Registered'}</Detail>
            {account.divisionId && <Detail label="Division">{findDivisionById(account.divisionId)?.name || account.divisionId}</Detail>}
            {account.expertise?.length > 0 && (
              <div className="sm:col-span-2">
                <Detail label="Areas of expertise">{account.expertise.join(', ')}</Detail>
              </div>
            )}
            <Detail label="Registered">{when(account.createdAt)}</Detail>
            <Detail label="Last login">{account.lastLoginAt ? `${when(account.lastLoginAt)} (${relativeTime(account.lastLoginAt)})` : 'Never'}</Detail>
            {account.reviewedBy && (
              <Detail label="Reviewed by">
                {account.reviewedBy.name} ({ROLE_LABELS[account.reviewedBy.role] || account.reviewedBy.role}), {when(account.reviewedAt)}
              </Detail>
            )}
            {account.deactivatedAt && <Detail label="Deactivated">{when(account.deactivatedAt)}</Detail>}
            {account.rejectionReason && (
              <div className="sm:col-span-2">
                <Detail label="Rejection reason">{account.rejectionReason}</Detail>
              </div>
            )}
          </dl>
        )}

        {locked && (
          <p className="m-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">{locked}</p>
        )}

        {actions.length > 0 && (
          <DialogFooter>
            {actions.map((action) => (
              <Button key={action} type="button" variant={ACTION_BUTTONS[action].variant} onClick={() => onAction(action, account)}>
                {ACTION_BUTTONS[action].label}
              </Button>
            ))}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// The kebab menu's wording; the detail dialog keeps its shorter button labels.
const MENU_ITEMS = {
  edit: { label: 'Edit user', icon: Pencil },
  approve: { label: 'Approve request', icon: UserCheck },
  reject: { label: 'Reject request', icon: UserX, destructive: true },
  role: { label: 'Change role', icon: UserCog },
  password: { label: 'Reset password', icon: KeyRound },
  reactivate: { label: 'Reactivate user', icon: RotateCcw },
  deactivate: { label: 'Deactivate user', icon: UserMinus, destructive: true },
};

function RowMenu({ account, viewer, onView, onAction }) {
  const actions = allowedActions(account, viewer);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={`Actions for ${account.name}`}>
          <MoreVertical className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => onView(account)}>
          <Eye aria-hidden="true" />
          View details
        </DropdownMenuItem>
        {actions.length > 0 && <DropdownMenuSeparator />}
        {actions.map((action) => {
          const item = MENU_ITEMS[action];
          const Icon = item.icon;
          return (
            <DropdownMenuItem
              key={action}
              variant={item.destructive ? 'destructive' : 'default'}
              onSelect={() => onAction(action, account)}
            >
              <Icon aria-hidden="true" />
              {item.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const MUTATIONS = {
  // Officer fields go only with the Assigned Official role.
  approve: ({ account, role, officer }) =>
    officer ? approveAccount(account.id, role, officer) : approveAccount(account.id, role),
  role: ({ account, role, officer }) =>
    officer ? changeAccountRole(account.id, role, officer) : changeAccountRole(account.id, role),
  create: ({ payload }) => createAccount(payload),
  edit: ({ account, changes }) => updateAccount(account.id, changes),
  password: ({ account, password, confirmPassword }) => resetAccountPassword(account.id, password, confirmPassword),
  reject: ({ account, reason }) => rejectAccount(account.id, reason),
  deactivate: ({ account }) => deactivateAccount(account.id),
  reactivate: ({ account }) => reactivateAccount(account.id),
};

export function AdminUsersPage() {
  const paths = useRoutePaths();
  const viewer = useAuthStore((state) => state.currentUser);
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('PENDING');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [selected, setSelected] = useState(null);
  const [decision, setDecision] = useState(null);
  const [decisionError, setDecisionError] = useState(null);

  const accounts = useQuery({ queryKey: ['admin', 'accounts'], queryFn: fetchAccounts, retry: false });

  const mutation = useMutation({
    mutationFn: ({ kind, ...variables }) => MUTATIONS[kind](variables),
    onSuccess: (result, { kind }) => {
      notify.success(kind === 'approve' ? APPROVED_MESSAGE : result?.message || 'Saved');
      setDecision(null);
      setSelected(null);
      setDecisionError(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'accounts'] });
    },
    onError: (failure) => {
      setDecisionError(errorOf(failure));
      queryClient.invalidateQueries({ queryKey: ['admin', 'accounts'] });
    },
  });

  const decide = (kind, variables = {}) => mutation.mutate({ kind, account: decision?.account, ...variables });
  const openDecision = (kind, account) => {
    setDecisionError(null);
    setDecision({ kind, account });
  };
  const closeDecision = () => {
    setDecision(null);
    setDecisionError(null);
  };

  const all = accounts.data?.accounts || [];
  const counts = accounts.data?.counts || {};
  // Offer the sign-up areas too, so an approval uses the words the applicant picked from.
  const suggestions = [
    ...new Set([...EXPERTISE_AREAS.map((area) => area.label.toLowerCase()), ...all.flatMap((account) => account.expertise || [])]),
  ].sort();
  const needle = search.trim().toLowerCase();
  const rows = all
    .filter((account) => account.status === status)
    .filter((account) => roleFilter === 'ALL' || account.role === roleFilter)
    .filter(
      (account) =>
        !needle ||
        account.name?.toLowerCase().includes(needle) ||
        account.email?.toLowerCase().includes(needle) ||
        account.requestedDesignation?.toLowerCase().includes(needle),
    )
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: paths.DASHBOARD },
          { label: 'Admin', path: paths.ADMINISTRATION },
          { label: 'Users' },
        ]}
      />

      <PageHeader
        title="Users"
        purpose="Registration requests and accounts. A new account can sign in only once an administrator approves it and assigns its role."
        icon={Users}
        actions={
          <Button type="button" onClick={() => openDecision('create', null)}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Add User
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Account status">
        {STATUS_ORDER.map((key) => (
          <StatTile
            key={key}
            label={STATUS[key].tile}
            value={accounts.isPending ? '…' : counts[key] ?? 0}
            icon={STATUS[key].icon}
            tone={STATUS[key].tone}
            selected={status === key}
            onClick={() => setStatus(key)}
          />
        ))}
      </div>

      <div data-slot="panel" className="space-y-4 rounded-2xl border border-transparent bg-card p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 font-heading text-[17px] font-semibold text-ink">{STATUS[status].tile}</h2>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <label htmlFor="admin-users-search" className="sr-only">
                Search users
              </label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                id="admin-users-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, email or designation…"
                className="w-64 rounded-full border border-line bg-surface-muted py-2 pl-9 pr-4 text-xs text-ink transition-shadow focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div className="relative">
              <label htmlFor="admin-users-role" className="sr-only">
                Filter by role
              </label>
              <select
                id="admin-users-role"
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value)}
                className="cursor-pointer appearance-none rounded-full border border-slate-200 bg-slate-50 py-1.5 pl-3.5 pr-8 text-xs font-semibold text-slate-700 outline-none transition-colors hover:border-slate-300"
              >
                <option value="ALL">All roles</option>
                {Object.values(ROLES).map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
              <Filter className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            </div>
          </div>
        </div>

        {accounts.isError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
          >
            <span>Could not load accounts. {errorOf(accounts.error)}</span>
            <Button type="button" size="sm" variant="outline" disabled={accounts.isFetching} onClick={() => accounts.refetch()}>
              {accounts.isFetching && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Retry
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200/80">
            <table className="w-full min-w-200 border-collapse text-left">
              <thead className="border-b border-slate-200 bg-[#F0F5FF]">
                <tr className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  <th scope="col" className="px-4 py-3">Name</th>
                  <th scope="col" className="px-4 py-3">Designation</th>
                  <th scope="col" className="px-4 py-3">Role</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Registered</th>
                  <th scope="col" className="px-4 py-3">Last login</th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {accounts.isPending && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                      Loading accounts…
                    </td>
                  </tr>
                )}
                {!accounts.isPending && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                      {status === 'PENDING' ? 'No registration requests are waiting.' : `No ${STATUS[status].label.toLowerCase()} accounts match.`}
                    </td>
                  </tr>
                )}
                {rows.map((account) => (
                  <tr key={account.id} className="hover:bg-blue-50/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-100 text-xs font-bold text-blue-700">
                          {getInitials(account.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[13.5px] font-bold text-slate-900">
                            {account.name}
                            {account.source === 'built-in' && <Badge variant="status-blue">Built-in</Badge>}
                          </div>
                          <div className="truncate text-xs text-slate-500">{account.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-slate-700">
                      {account.requestedDesignation || '—'}
                      {account.department && <div className="text-xs text-slate-400">{account.department}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={account.role} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={account.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{when(account.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                      {account.lastLoginAt ? relativeTime(account.lastLoginAt) : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant={status === 'PENDING' ? 'primary' : 'outline'}
                        onClick={() => setSelected(account)}
                        aria-label={`${status === 'PENDING' ? 'Review' : 'View'} ${account.name}`}
                      >
                        {status === 'PENDING' ? 'Review' : 'View'}
                      </Button>
                      <RowMenu account={account} viewer={viewer} onView={setSelected} onAction={openDecision} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AccountDialog
        account={decision ? null : selected}
        viewer={viewer}
        onClose={() => setSelected(null)}
        onAction={openDecision}
      />

      {(decision?.kind === 'approve' || decision?.kind === 'role') && (
        <RoleDialog
          key={`${decision.kind}-${decision.account.id}`}
          account={decision.account}
          mode={decision.kind}
          viewer={viewer}
          suggestions={suggestions}
          pending={mutation.isPending}
          error={decisionError}
          onClose={closeDecision}
          onConfirm={(role, officer) => decide(decision.kind, { role, officer })}
        />
      )}

      {(decision?.kind === 'create' || decision?.kind === 'edit') && (
        <UserFormDialog
          key={`${decision.kind}-${decision.account?.id || 'new'}`}
          mode={decision.kind}
          account={decision.account}
          roles={grantableRoles(viewer)}
          suggestions={suggestions}
          pending={mutation.isPending}
          error={decisionError}
          onClose={closeDecision}
          onSubmit={(fields) =>
            decision.kind === 'create' ? decide('create', { payload: fields }) : decide('edit', { changes: fields })
          }
        />
      )}

      {decision?.kind === 'password' && (
        <ResetPasswordDialog
          key={`password-${decision.account.id}`}
          account={decision.account}
          pending={mutation.isPending}
          error={decisionError}
          onClose={closeDecision}
          onSubmit={({ password, confirmPassword }) => decide('password', { password, confirmPassword })}
        />
      )}

      <DecisionCommentDialog
        open={decision?.kind === 'reject'}
        onOpenChange={(open) => !open && closeDecision()}
        title={`Reject ${decision?.account?.name || 'registration'}`}
        description="The person is told their request was not approved when they next try to sign in."
        label="Reason (optional)"
        placeholder="Your registration request could not be approved at this time. Please contact the IPC administration team for further clarification."
        hint="Optional. Shown to the person when they sign in, and recorded in the audit trail."
        maxLength={500}
        confirmLabel="Reject request"
        tone="reject"
        error={decisionError}
        onSubmit={(reason) =>
          new Promise((resolve) =>
            mutation.mutate(
              { kind: 'reject', account: decision.account, reason },
              { onSuccess: () => resolve(true), onError: () => resolve(false) },
            ),
          )
        }
      />

      <ConfirmDialog
        account={decision?.account}
        kind={decision?.kind}
        pending={mutation.isPending}
        error={decisionError}
        onClose={closeDecision}
        onConfirm={() => decide(decision.kind)}
      />
    </div>
  );
}
