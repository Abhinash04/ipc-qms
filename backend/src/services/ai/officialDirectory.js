import { ASSIGNED_OFFICIALS, IPC_DIVISIONS } from '../../config/officialsMetadata.js';
import { isConnected } from '../../config/db.js';
import { ROLES } from '../../constants/roles.js';
import { allUsers } from '../../constants/users.js';
import { User } from '../../models/User.js';
import { SELF_REGISTERED, isApproved } from '../auth/userDirectory.js';

const DIVISION_NAMES = new Map(IPC_DIVISIONS.map((division) => [division.id, division.name]));

/**
 * Assigned Officials created or approved by an administrator. Only approved ones: a pending,
 * rejected or deactivated account is never offered for new work. Empty while the database is
 * offline, so the built-in officials still answer.
 */
async function registeredOfficials() {
  if (!isConnected()) return [];
  const rows = await User.find({ ...SELF_REGISTERED, role: ROLES.ASSIGNED_OFFICIAL })
    .select('userId name email role divisionId expertise active status')
    .lean();
  return rows.filter(isApproved);
}

/** Every official the Recommendation Engine may suggest, in the shape of config/officialsMetadata.js. */
export async function recommendableOfficials() {
  const registered = (await registeredOfficials()).map((row) => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    divisionId: row.divisionId ?? null,
    divisionName: DIVISION_NAMES.get(row.divisionId) || 'Unassigned division',
    expertise: row.expertise ?? [],
  }));
  return [...ASSIGNED_OFFICIALS, ...registered];
}

/** The built-in directory plus approved registered officials, for transfers and auto-transfer. */
export async function assignableDirectory() {
  const registered = (await registeredOfficials()).map((row) => ({
    id: row.userId,
    name: row.name,
    email: row.email,
    role: row.role,
    divisionId: row.divisionId ?? null,
    active: true,
  }));
  return [...allUsers(), ...registered];
}
