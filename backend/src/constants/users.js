import { ROLES } from './roles.js';
import browserConfig from '../config/browserConfig.js';

/**
 * The QMS user directory.
 *
 * NO SECRETS HERE. Passwords are never stored in source — each account
 * authenticates against its OWN bcrypt hash, resolved by
 * services/auth/credentials.js from QMS_PASSWORDS_FILE or a per-account
 * environment variable.
 *
 * NO REAL ADDRESSES EITHER. Every address here is `@ipc.example`, which RFC 2606
 * reserves and which cannot receive mail. Two of them were named individuals'
 * personal accounts, which put personal data in the repository and meant a sign-in
 * identity doubled as somebody's private inbox. Where mail actually goes is a
 * deployment setting — FRONT_OFFICE_EMAIL, OFFICER_IN_CHARGE_EMAIL and NIC_EMAIL,
 * read through config/identities.js and config/browserConfig.js — and never this
 * file.
 *
 * Mirrors frontend/src/constants/mockUsers.js, which remains the frontend's
 * display directory for other users' names. The two must agree on id, email
 * and role; this file is the authority for authentication.
 *
 * TODO(phase-2): move the directory itself to a Mongo-backed collection, so
 * accounts can be added and deactivated without a redeploy. Per-account
 * credentials already landed; what remains is the mutable directory and the
 * `active` flag on models/User.js, which the auth path does not yet read.
 */
export const USERS = [
  { id: 'USR-0002', name: 'Bhumika Makker', role: ROLES.FRONT_OFFICE, email: 'bhumika.makker@ipc.example', divisionId: 'DIV-004' },
  { id: 'USR-0003', name: 'Jatin Rawat', role: ROLES.OFFICER_IN_CHARGE, email: 'jatin.rawat@ipc.example', divisionId: 'DIV-001' },
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

/**
 * The Front Officer for the NICeMail mailbox, when that mailbox is enabled.
 *
 * Built from configuration rather than listed above: the mailbox address is a
 * deployment setting (a test mailbox today, the IPC one later), and this
 * account signs in with exactly that address. Read at call time, like the
 * config it comes from.
 */
export function nicFrontOfficeUser() {
  if (!browserConfig.mailboxEnabled || !browserConfig.mailboxAddress) return null;
  return {
    id: 'USR-0014',
    name: browserConfig.frontOfficeName,
    role: ROLES.FRONT_OFFICE,
    email: browserConfig.mailboxAddress,
    divisionId: 'DIV-004',
  };
}

/** Every account that can sign in right now. */
export function allUsers() {
  const nic = nicFrontOfficeUser();
  return nic ? [...USERS, nic] : USERS;
}
