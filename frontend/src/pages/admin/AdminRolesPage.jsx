import { Check, Minus } from 'lucide-react';

import { Breadcrumb } from '@/components/common/Breadcrumb';
import { PageHeader } from '@/components/common/PageHeader';
import { ROLES, ROLE_LABELS } from '@/constants/roles';
import { SECTION, SECTIONS, SECTION_ORDER } from '@/constants/routeSections';
import { sectionsForRole } from '@/constants/permissions';
import { WORKFLOW_ACTION, canPerform } from '@/constants/workflowRules';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { useRoutePaths } from '@/hooks/useRoutePaths';

/**
 * The capability matrix.
 *
 * Rendered from the live permission tables — `sectionsForRole` and
 * `canPerform` — rather than from a hand-maintained list, so it cannot drift
 * from the rules the application actually enforces. Change a grant and this
 * page changes with it.
 */

const ROLE_ORDER = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.FRONT_OFFICE,
  ROLES.OFFICER_IN_CHARGE,
  ROLES.ASSIGNED_OFFICIAL,
  ROLES.REVIEWER,
  ROLES.INQUIRER,
];

/** A role may perform an action if it can in ANY state — the state machine narrows it further. */
const roleHasAction = (role, action) =>
  Object.values(WORKFLOW_STATE).some((state) => canPerform(role, action, state));

function Cell({ granted }) {
  return (
    <td className="px-3 py-2 text-center">
      {granted ? (
        <Check className="mx-auto h-4 w-4 text-emerald-600" aria-label="granted" />
      ) : (
        <Minus className="mx-auto h-3.5 w-3.5 text-slate-300" aria-label="not granted" />
      )}
    </td>
  );
}

function Matrix({ caption, rows, label }) {
  return (
    <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <h2 className="font-heading text-[17px] font-black text-slate-900">{caption}</h2>
      <p className="m-0 mb-3 mt-0.5 text-[12.5px] text-slate-500">{label}</p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-180 border-collapse">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="px-3 py-2 text-left text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                Capability
              </th>
              {ROLE_ORDER.map((role) => (
                <th
                  key={role}
                  className="px-3 py-2 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-500"
                >
                  {ROLE_LABELS[role] || role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-slate-100 hover:bg-slate-50/70">
                <td className="px-3 py-2 text-[12.5px] font-semibold text-slate-800">{row.label}</td>
                {ROLE_ORDER.map((role) => (
                  <Cell key={role} granted={row.granted(role)} />
                ))}
              </tr>
            ))}
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
    granted: (role) => sectionsForRole(role).includes(section),
  }));

  const actionRows = Object.values(WORKFLOW_ACTION).map((action) => ({
    key: action,
    label: action
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase()),
    granted: (role) => roleHasAction(role, action),
  }));

  return (
    <div className="space-y-5">
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

      <div className="rounded-2xl border border-blue-200/70 bg-blue-50/60 px-4 py-3 text-[12.5px] text-blue-900">
        <p className="m-0">
          <span className="font-black">Administration is one interface.</span> Admin and Super Admin share
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
