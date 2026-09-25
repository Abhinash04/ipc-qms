import { ROLES } from './roles.js';
import browserConfig from '../config/browserConfig.js';

export const USERS = [
  { id: 'USR-0002', name: 'Front Office (primary mailbox)', role: ROLES.FRONT_OFFICE, email: 'front.office@ipc.example', divisionId: 'DIV-004' },
  { id: 'USR-0003', name: 'EduTR Zairza', role: ROLES.OFFICER_IN_CHARGE, email: 'edutr.zairza@ipc.example', divisionId: 'DIV-001' },
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

export function allUsers() {
  const nic = nicFrontOfficeUser();
  return nic ? [...USERS, nic] : USERS;
}
