import { ROLES } from './roles.js';

/**
 * The QMS user directory.
 *
 * NO SECRETS HERE. Passwords are never stored in source — every account
 * authenticates against a bcrypt hash of QMS_SEED_PASSWORD, derived at boot
 * (see services/auth/userDirectory.js).
 *
 * Mirrors frontend/src/constants/mockUsers.js, which remains the frontend's
 * display directory for other users' names. The two must agree on id, email
 * and role; this file is the authority for authentication.
 *
 * TODO(phase-2): move this to a real Mongo-backed user collection with
 * per-user credentials, once server-side persistence lands.
 */
export const USERS = [
  { id: 'USR-0001', name: 'Abhinash Pritiraj', role: ROLES.INQUIRER, email: 'abhinash.pritiraj@gmail.com', divisionId: null },
  { id: 'USR-0002', name: 'Bhumika Makker', role: ROLES.FRONT_OFFICE, email: 'bhoomikamakker@gmail.com', divisionId: 'DIV-004' },
  { id: 'USR-0003', name: 'Jatin Rawat', role: ROLES.OFFICER_IN_CHARGE, email: 'rawatjatin436@gmail.com', divisionId: 'DIV-001' },
  { id: 'USR-0004', name: 'Neha Singh', role: ROLES.ASSIGNED_OFFICIAL, email: 'neha.singh@ipc.example', divisionId: 'DIV-005' },
  { id: 'USR-0009', name: 'Rawat Jatin', role: ROLES.ASSIGNED_OFFICIAL, email: 'rawat.jatin@ipc.example', divisionId: 'DIV-003' },
  { id: 'USR-0010', name: 'Meera Iyer', role: ROLES.ASSIGNED_OFFICIAL, email: 'meera.iyer@ipc.example', divisionId: 'DIV-006' },
  { id: 'USR-0011', name: 'Arjun Nair', role: ROLES.ASSIGNED_OFFICIAL, email: 'arjun.nair@ipc.example', divisionId: 'DIV-007' },
  { id: 'USR-0012', name: 'Sana Qureshi', role: ROLES.ASSIGNED_OFFICIAL, email: 'sana.qureshi@ipc.example', divisionId: 'DIV-008' },
  { id: 'USR-0013', name: 'Vikram Desai', role: ROLES.ASSIGNED_OFFICIAL, email: 'vikram.desai@ipc.example', divisionId: 'DIV-009' },
  { id: 'USR-0005', name: 'Amit Mehta', role: ROLES.REVIEWER, email: 'amit.mehta@ipc.example', divisionId: 'DIV-002' },
  { id: 'USR-0006', name: 'Kavita Rao', role: ROLES.REVIEWER, email: 'kavita.rao@ipc.example', divisionId: 'DIV-002' },
  { id: 'USR-0007', name: 'Suresh Gupta', role: ROLES.ADMIN, email: 'suresh.gupta@ipc.example', divisionId: 'DIV-004' },
  { id: 'USR-0008', name: 'System Administrator', role: ROLES.SUPER_ADMIN, email: 'admin@ipc.example', divisionId: 'DIV-004' },
];
