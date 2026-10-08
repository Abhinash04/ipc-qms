import { ChevronDown, Eye } from "lucide-react";
import { ROLE_LABELS } from "@/constants/roles";

function byRole(options) {
  const groups = new Map();
  for (const user of options) {
    if (!groups.has(user.role)) groups.set(user.role, []);
    groups.get(user.role).push(user);
  }
  return [...groups];
}

export function WatchedUserPicker({ options, watched, onWatch }) {
  return (
    <div className="relative">
      <label htmlFor="watched-user" className="sr-only">
        Viewing work of
      </label>
      <Eye
        className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary"
        aria-hidden="true"
      />
      <select
        id="watched-user"
        value={watched?.id || ""}
        onChange={(e) => onWatch(e.target.value || null)}
        className="w-60 cursor-pointer appearance-none rounded-lg border border-line bg-surface py-2 ps-9 pe-8 text-[13px] font-medium text-ink outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
      >
        <option value="">Viewing: All users</option>
        {byRole(options).map(([role, users]) => (
          <optgroup key={role} label={ROLE_LABELS[role] || role}>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                Viewing: {user.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
        aria-hidden="true"
      />
    </div>
  );
}
