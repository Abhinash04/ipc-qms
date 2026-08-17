import { ROLES } from './roles';

export const MOCK_USERS = [
  {
    id: 'USR-0001',
    name: 'Rajesh Kumar',
    role: ROLES.INQUIRER,
    email: 'rajesh.kumar@example.com',
    divisionId: null,
  },
  {
    id: 'USR-0002',
    name: 'Priya Sharma',
    role: ROLES.FRONT_OFFICE,
    email: 'priya.sharma@ipc.example',
    divisionId: 'DIV-004',
  },
  {
    id: 'USR-0003',
    name: 'Anil Verma',
    role: ROLES.OFFICER_IN_CHARGE,
    email: 'anil.verma@ipc.example',
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

export function findUserById(id) {
  return MOCK_USERS.find((user) => user.id === id) || null;
}
