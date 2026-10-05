import { useState } from 'react';
import {
  Search,
  Plus,
  Users,
  User,
  UserCheck,
  UserCog,
  Crown,
  ShieldCheck,
  Eye,
  MoreVertical,
  Building2,
  FlaskConical,
  Cog,
  BookText,
  Microscope,
  TestTube,
  FileText,
  GraduationCap,
  Filter,
  Mail,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

import { Breadcrumb } from '@/components/common/Breadcrumb';
import { PageHeader } from '@/components/common/PageHeader';
import { MOCK_USERS } from '@/constants/mockUsers';
import { ROLES, ROLE_LABELS } from '@/constants/roles';
import { findDivisionById } from '@/constants/mockDivisions';
import { useRoutePaths } from '@/hooks/useRoutePaths';

const ROLE_BADGE_STYLE = {
  [ROLES.SUPER_ADMIN]: {
    bg: 'bg-purple-100/90 text-purple-700 border-purple-200/80',
    icon: Crown,
  },
  [ROLES.ADMIN]: {
    bg: 'bg-emerald-100/90 text-emerald-700 border-emerald-200/80',
    icon: UserCheck,
  },
  [ROLES.OFFICER_IN_CHARGE]: {
    bg: 'bg-blue-100/90 text-blue-700 border-blue-200/80',
    icon: UserCog,
  },
  [ROLES.ASSIGNED_OFFICIAL]: {
    bg: 'bg-amber-100/90 text-amber-800 border-amber-200/80',
    icon: User,
  },
  [ROLES.REVIEWER]: {
    bg: 'bg-rose-100/90 text-rose-700 border-rose-200/80',
    icon: Eye,
  },
  [ROLES.FRONT_OFFICE]: {
    bg: 'bg-emerald-100/90 text-emerald-700 border-emerald-200/80',
    icon: ShieldCheck,
  },
};

const DIVISION_STYLE = {
  'DIV-001': { bg: 'bg-purple-50 text-purple-700 border-purple-200/60', icon: GraduationCap },
  'DIV-002': { bg: 'bg-cyan-50 text-cyan-700 border-cyan-200/60', icon: FileText },
  'DIV-003': { bg: 'bg-blue-50 text-blue-700 border-blue-200/60', icon: Cog },
  'DIV-004': { bg: 'bg-purple-50 text-purple-700 border-purple-200/60', icon: Building2 },
  'DIV-005': { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200/60', icon: FlaskConical },
  'DIV-006': { bg: 'bg-indigo-50 text-indigo-700 border-indigo-200/60', icon: BookText },
  'DIV-007': { bg: 'bg-teal-50 text-teal-700 border-teal-200/60', icon: Microscope },
  'DIV-008': { bg: 'bg-sky-50 text-sky-700 border-sky-200/60', icon: TestTube },
  'DIV-009': { bg: 'bg-violet-50 text-violet-700 border-violet-200/60', icon: ShieldCheck },
};

const AVATAR_COLORS = [
  'bg-purple-100 text-purple-700 border-purple-200',
  'bg-emerald-100 text-emerald-700 border-emerald-200',
  'bg-rose-100 text-rose-700 border-rose-200',
  'bg-sky-100 text-sky-700 border-sky-200',
  'bg-teal-100 text-teal-700 border-teal-200',
  'bg-pink-100 text-pink-700 border-pink-200',
  'bg-violet-100 text-violet-700 border-violet-200',
  'bg-amber-100 text-amber-700 border-amber-200',
  'bg-indigo-100 text-indigo-700 border-indigo-200',
  'bg-blue-100 text-blue-700 border-blue-200',
];

function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AdminUsersPage() {
  const paths = useRoutePaths();
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');

  const filteredUsers = MOCK_USERS.filter((user) => {
    const matchesSearch =
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'ALL' || user.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div className="space-y-6 select-none">
      {/* BREADCRUMB */}
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: paths.DASHBOARD },
          { label: 'Admin', path: paths.ADMINISTRATION },
          { label: 'Users' },
        ]}
      />

      {/* PAGE HEADER (RESTORED TO STANDARD PAGE HEADER CONTAINER) */}
      <PageHeader
        title="Users"
        purpose="Mock user directory — replace with API data once auth exists."
        icon={Users}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search users..."
                className="bg-surface-muted border border-line text-ink text-xs rounded-full py-2 pl-9 pr-4 w-48 sm:w-56 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>

            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary text-white font-bold text-xs shadow-xs hover:bg-primary-hover transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4 text-white" strokeWidth={2.5} />
              <span>Add User</span>
            </button>
          </div>
        }
      />

      {/* MAIN USERS DATA CARD */}
      <div
        data-slot="panel"
        className="bg-white rounded-3xl border border-slate-200/90 shadow-xl shadow-slate-200/40 p-5 sm:p-6 space-y-5"
      >
        {/* TOP TOOLBAR: TOTAL USERS PILL & FILTERS */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-blue-50/80 text-blue-700 border border-blue-200/80 font-bold text-xs shadow-2xs">
            <Users className="w-4 h-4 text-blue-600" />
            <span>Total Users</span>
            <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold text-[11px] flex items-center justify-center ms-0.5">
              {filteredUsers.length}
            </span>
          </div>

          <div className="flex items-center gap-2 ms-auto sm:ms-0">
            <div className="relative">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="appearance-none bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-xs rounded-full py-1.5 pl-3.5 pr-8 cursor-pointer outline-none hover:border-slate-300 transition-all"
              >
                <option value="ALL">All Roles</option>
                {Object.keys(ROLES).map((roleKey) => (
                  <option key={roleKey} value={ROLES[roleKey]}>
                    {ROLE_LABELS[ROLES[roleKey]]}
                  </option>
                ))}
              </select>
              <Filter className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* USERS TABLE */}
        <div className="overflow-x-auto rounded-2xl border border-slate-200/80">
          <table className="w-full min-w-[720px] text-left border-collapse">
            <thead className="bg-[#F0F5FF] text-slate-800 border-b border-slate-200">
              <tr>
                <th scope="col" className="py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wider w-12 text-center">
                  #
                </th>
                <th scope="col" className="py-3 px-4 text-xs font-bold text-slate-800 uppercase tracking-wider">
                  <div className="flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-blue-600" />
                    <span>NAME</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 ms-0.5" />
                  </div>
                </th>
                <th scope="col" className="py-3 px-4 text-xs font-bold text-slate-800 uppercase tracking-wider">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                    <span>ROLE</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 ms-0.5" />
                  </div>
                </th>
                <th scope="col" className="py-3 px-4 text-xs font-bold text-slate-800 uppercase tracking-wider">
                  <div className="flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-blue-600" />
                    <span>DIVISION</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 ms-0.5" />
                  </div>
                </th>
                <th scope="col" className="py-3 px-4 text-xs font-bold text-slate-800 uppercase tracking-wider">
                  <div className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-blue-600" />
                    <span>EMAIL</span>
                  </div>
                </th>
                <th scope="col" className="py-3 px-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center w-12">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredUsers.map((user, index) => {
                const division = findDivisionById(user.divisionId);
                const roleBadge = ROLE_BADGE_STYLE[user.role] || {
                  bg: 'bg-slate-100 text-slate-700 border-slate-200',
                  icon: User,
                };
                const RoleIcon = roleBadge.icon;
                const divStyle = DIVISION_STYLE[user.divisionId] || {
                  bg: 'bg-slate-50 text-slate-700 border-slate-200',
                  icon: Building2,
                };
                const DivIcon = divStyle.icon;
                const avatarColor = AVATAR_COLORS[index % AVATAR_COLORS.length];
                const rowNum = String(index + 1).padStart(2, '0');

                return (
                  <tr
                    key={user.id}
                    className="hover:bg-blue-50/40 transition-colors duration-150 group"
                  >
                    <td className="py-3.5 px-4 text-xs font-bold text-slate-400 text-center">
                      {rowNum}
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-full ${avatarColor} font-bold text-xs flex items-center justify-center shrink-0 shadow-2xs`}
                        >
                          {getInitials(user.name)}
                        </div>
                        <span className="font-bold text-[13.5px] text-slate-900 group-hover:text-blue-700 transition-colors">
                          {user.name}
                        </span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${roleBadge.bg}`}
                      >
                        <RoleIcon className="w-3.5 h-3.5 shrink-0" />
                        <span>{ROLE_LABELS[user.role] || user.role}</span>
                      </span>
                    </td>

                    <td className="py-3.5 px-4">
                      {division ? (
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${divStyle.bg}`}
                        >
                          <DivIcon className="w-3.5 h-3.5 shrink-0" />
                          <span>{division.name}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs font-medium">—</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-xs font-medium text-slate-600">
                      {user.email}
                    </td>

                    <td className="py-3.5 px-4 text-center">
                      <button
                        type="button"
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                        aria-label={`Actions for ${user.name}`}
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* FOOTER PAGINATION BAR */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs font-medium text-slate-500">
          <div>
            Showing {filteredUsers.length ? 1 : 0}–{filteredUsers.length} of {filteredUsers.length} users
          </div>

          <div className="flex items-center gap-1.5 ms-auto sm:ms-0">
            <button
              type="button"
              disabled
              aria-label="Previous page"
              className="w-7 h-7 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center disabled:opacity-50 cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Page 1"
              aria-current="page"
              className="w-7 h-7 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow-xs"
            >
              1
            </button>
            <button
              type="button"
              disabled
              aria-label="Next page"
              className="w-7 h-7 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center disabled:opacity-50 cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
