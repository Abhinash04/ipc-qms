import {
  ShieldCheck,
  CheckCircle2,
  Minus,
  Clock,
  Crown,
  UserCheck,
  UserCog,
  Users,
  ClipboardCheck,
  Layers,
  Settings,
  SlidersHorizontal,
  User,
} from 'lucide-react';

import { Breadcrumb } from '@/components/common/Breadcrumb';
import { PageHeader } from '@/components/common/PageHeader';
import { ROLES, ROLE_LABELS } from '@/constants/roles';
import { SECTION, SECTIONS, SECTION_ORDER } from '@/constants/routeSections';
import { sectionsForRole } from '@/constants/permissions';
import { WORKFLOW_ACTION, canPerform } from '@/constants/workflowRules';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { useRoutePaths } from '@/hooks/useRoutePaths';

const ROLE_ORDER = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.FRONT_OFFICE,
  ROLES.OFFICER_IN_CHARGE,
  ROLES.ASSIGNED_OFFICIAL,
  ROLES.REVIEWER,
];

const ROLE_CONFIG = {
  [ROLES.SUPER_ADMIN]: {
    label: 'Super Admin',
    icon: Crown,
    iconBg: 'bg-purple-100 text-purple-600',
  },
  [ROLES.ADMIN]: {
    label: 'Admin',
    icon: UserCheck,
    iconBg: 'bg-blue-100 text-blue-600',
  },
  [ROLES.FRONT_OFFICE]: {
    label: 'Front Office',
    icon: ShieldCheck,
    iconBg: 'bg-emerald-100 text-emerald-600',
  },
  [ROLES.OFFICER_IN_CHARGE]: {
    label: 'Officer-in-Charge',
    icon: UserCog,
    iconBg: 'bg-amber-100 text-amber-600',
  },
  [ROLES.ASSIGNED_OFFICIAL]: {
    label: 'Assigned Official',
    icon: Users,
    iconBg: 'bg-sky-100 text-sky-600',
  },
  [ROLES.REVIEWER]: {
    label: 'Reviewer',
    icon: ClipboardCheck,
    iconBg: 'bg-indigo-100 text-indigo-600',
  },
};

const SECTIONS_BY_ROLE = new Map(
  ROLE_ORDER.map((role) => [role, new Set(sectionsForRole(role))]),
);

const roleHasAction = (role, action) =>
  Object.values(WORKFLOW_STATE).some((state) => canPerform(role, action, state));

function Cell({ granted }) {
  const isPartial = granted === 'partial';
  const isAllowed = Boolean(granted) && !isPartial;

  return (
    <td className="px-3 py-2.5 text-center align-middle">
      {isAllowed ? (
        <span
          aria-label="granted"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100/90 text-emerald-800 border border-emerald-200/90 text-[11.5px] font-bold shadow-2xs"
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          <span>Allowed</span>
        </span>
      ) : isPartial ? (
        <span
          aria-label="partial"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100/90 text-amber-800 border border-amber-200/90 text-[11.5px] font-bold shadow-2xs"
        >
          <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
          <span>Partial</span>
        </span>
      ) : (
        <span
          aria-label="not granted"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100/80 text-slate-400 border border-slate-200/70 text-[11.5px] font-medium"
        >
          <Minus className="h-3 w-3 text-slate-400 shrink-0" />
          <span>No Access</span>
        </span>
      )}
    </td>
  );
}

function Matrix({ caption, label, rows }) {
  return (
    <section
      data-slot="panel"
      className="rounded-3xl border border-slate-200/90 bg-white shadow-xl shadow-slate-200/40 overflow-hidden select-none"
    >
      <div className="bg-linear-to-r from-blue-700 via-indigo-700 to-purple-800 text-white p-5 sm:p-6 relative overflow-hidden flex flex-wrap items-center justify-between gap-4">
        <div className="absolute -right-12 -top-12 w-48 h-48 bg-white/10 rounded-full blur-2xl pointer-events-none" />

        <div className="flex items-center gap-3.5 relative z-10">
          <div className="w-11 h-11 rounded-2xl bg-white/15 backdrop-blur-md text-white flex items-center justify-center shrink-0 border border-white/25 shadow-inner">
            <ShieldCheck className="h-6 w-6" strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="font-heading text-xl font-bold text-white leading-tight m-0">
              {caption}
            </h2>
            <p className="text-xs font-medium text-blue-100/80 m-0 mt-0.5 max-w-xl">
              {label}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 relative z-10">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-md text-white border border-white/25 text-xs font-semibold shadow-xs">
            <Settings className="w-3.5 h-3.5 text-white/90" />
            <span>Roles &amp; Permissions</span>
          </span>
        </div>
      </div>

      <div className="bg-slate-50/90 border-b border-slate-200/80 px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-500 font-semibold">
          <span className="text-[11.5px] uppercase tracking-wider text-slate-400 font-bold">
            Status Legend:
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100/90 text-emerald-800 border border-emerald-200 text-[11px] font-bold">
            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
            Allowed
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 text-[11px] font-medium">
            <Minus className="h-3 w-3 text-slate-400" />
            No Access
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100/90 text-amber-800 border border-amber-200 text-[11px] font-bold">
            <Clock className="h-3 w-3 text-amber-600" />
            Partial Access
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-190 border-collapse">
          <thead className="bg-[#F0F5FF] text-slate-800 border-b border-slate-200">
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-20 bg-[#F0F5FF] px-4 py-3.5 text-left text-[13px] font-bold text-slate-800 border-b border-slate-200/80 border-r shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                    <Layers className="w-4 h-4" />
                  </div>
                  <span>Feature / Section</span>
                </div>
              </th>
              {ROLE_ORDER.map((role) => {
                const config = ROLE_CONFIG[role] || {
                  label: ROLE_LABELS[role] || role,
                  icon: User,
                  iconBg: 'bg-slate-100 text-slate-600',
                };
                const Icon = config.icon;
                return (
                  <th
                    scope="col"
                    key={role}
                    className="px-3 py-3.5 text-center border-b border-slate-200"
                  >
                    <div className="inline-flex items-center justify-center gap-2">
                      <div
                        className={`w-7 h-7 rounded-full ${config.iconBg} flex items-center justify-center shrink-0 shadow-2xs`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <span className="font-bold text-[12.5px] text-slate-800 whitespace-nowrap">
                        {config.label}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row) => {
              const RowIcon = row.icon || Layers;
              return (
                <tr key={row.key} className="hover:bg-blue-50/40 transition-colors group">
                  <td className="sticky left-0 z-10 bg-white group-hover:bg-blue-50/90 px-4 py-3 text-[13px] font-bold text-slate-800 border-r border-slate-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] whitespace-nowrap">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100/60">
                        <RowIcon className="w-3.5 h-3.5" />
                      </div>
                      <span>{row.label}</span>
                    </div>
                  </td>
                  {ROLE_ORDER.map((role) => (
                    <Cell key={role} granted={row.granted(role)} />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AdminRolesPage() {
  const paths = useRoutePaths();

  const sectionRows = SECTION_ORDER.filter((section) => SECTIONS[section].label).map((section) => ({
    key: section,
    label: SECTIONS[section].label,
    icon: SECTIONS[section].icon,
    granted: (role) => SECTIONS_BY_ROLE.get(role)?.has(section) ?? false,
  }));

  const actionRows = Object.values(WORKFLOW_ACTION).map((action) => ({
    key: action,
    label: action
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase()),
    icon: SlidersHorizontal,
    granted: (role) => roleHasAction(role, action),
  }));

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: paths.DASHBOARD },
          { label: 'Administration', path: paths.ADMINISTRATION },
          { label: 'Roles' },
        ]}
      />
      <PageHeader
        title="Roles & Permissions"
        purpose="Generated from the permission tables the application enforces, so it cannot fall out of step."
      />

      <div className="rounded-2xl border border-primary-200/70 bg-primary-50/60 px-4 py-3 text-[12.5px] text-primary-700">
        <p className="m-0">
          <span className="font-bold">Administration is one interface.</span> Admin and Super Admin share
          the same console; Super Admin additionally holds the operational sections and every workflow
          action, and is alone in reaching System Settings.
        </p>
      </div>

      <Matrix
        caption="Page access"
        label="Which sections each role can open. Enforced by ProtectedRoute and by isRouteAllowedForRole."
        rows={sectionRows}
      />

      <Matrix
        caption="Workflow actions"
        label="Which actions a role may ever perform. The workflow state machine narrows this further per case."
        rows={actionRows}
      />

      <p className="m-0 px-1 text-[11.5px] text-slate-400">
        Server-side, {SECTIONS[SECTION.ADMIN_ACTIVITY].label} and the audit API are additionally gated to
        Admin and Super Admin by verifyRole.
      </p>
    </div>
  );
}
