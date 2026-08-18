import { ROLES } from './roles';

export const MOCK_USERS = [
  {
    id: 'USR-0001',
    name: 'Abhinash Pritiraj',
    role: ROLES.INQUIRER,
    email: 'abhinash.pritiraj@gmail.com',
    divisionId: null,
  },
  {
    id: 'USR-0002',
    // REAL identity for the multi-account Gmail test phase. The user record is
    // the source of truth for whose address this is; backend env may override
    // the value (FRONT_OFFICE_EMAIL) but not the ownership.
    name: 'Bhumika Makker',
    role: ROLES.FRONT_OFFICE,
    email: 'bhoomikamakker@gmail.com',
    divisionId: 'DIV-004',
  },
  {
    id: 'USR-0003',
    // REAL identity — see the note on USR-0002.
    name: 'Jatin Rawat',
    role: ROLES.OFFICER_IN_CHARGE,
    email: 'rawatjatin436@gmail.com',
    divisionId: 'DIV-001',
  },
  {
    id: 'USR-0004',
    name: 'Neha Singh',
    role: ROLES.ASSIGNED_OFFICIAL,
    email: 'neha.singh@ipc.example',
    divisionId: 'DIV-001',
  },
  {
    // REAL identity. NOT the same person as USR-0003 "Jatin Rawat", the
    // Officer-in-Charge, despite the near-identical name — different human,
    // different Gmail account, different role. The id and the email address
    // identify them; the display name does not.
    id: 'USR-0009',
    name: 'Rawat Jatin',
    role: ROLES.ASSIGNED_OFFICIAL,
    email: 'jatinrawat55361@gmail.com',
    divisionId: 'DIV-003',
  },
  {
    id: 'USR-0005',
    name: 'Amit Mehta',
    role: ROLES.REVIEWER,
    email: 'amit.mehta@ipc.example',
    divisionId: 'DIV-002',
  },
  {
    id: 'USR-0006',
    name: 'Kavita Rao',
    role: ROLES.REVIEWER,
    email: 'kavita.rao@ipc.example',
    divisionId: 'DIV-002',
  },
  {
    id: 'USR-0007',
    name: 'Suresh Gupta',
    role: ROLES.ADMIN,
    email: 'suresh.gupta@ipc.example',
    divisionId: 'DIV-004',
  },
  {
    id: 'USR-0008',
    name: 'System Administrator',
    role: ROLES.SUPER_ADMIN,
    email: 'admin@ipc.example',
    divisionId: 'DIV-004',
  },
];

export const MOCK_PASSWORD = 'ipc@1234';

export function findUserById(id) {
  return MOCK_USERS.find((user) => user.id === id) || null;
}

export function findUserByEmail(email) {
  const normalised = String(email || '').trim().toLowerCase();
  return MOCK_USERS.find((user) => user.email.toLowerCase() === normalised) || null;
}
