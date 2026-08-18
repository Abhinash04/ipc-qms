/**
 * IPC divisions.
 *
 * DIV-001..004 are the original organisational units and are still used by the
 * Front Office, Officer-in-Charge, reviewers and admin roles. DIV-005..009 are
 * the technical divisions that Assigned Officials belong to — they carry the
 * subject-matter meaning the assignment recommendation reasons about.
 */
export const MOCK_DIVISIONS = [
  { id: 'DIV-001', name: 'Training & Development' },
  { id: 'DIV-002', name: 'Policy & Compliance' },
  { id: 'DIV-003', name: 'Technical Operations' },
  { id: 'DIV-004', name: 'Administration' },
  { id: 'DIV-005', name: 'Analytical & Quality Control' },
  { id: 'DIV-006', name: 'Pharmacopoeial Standards' },
  { id: 'DIV-007', name: 'Microbiology' },
  { id: 'DIV-008', name: 'Pharmaceutical Chemistry' },
  { id: 'DIV-009', name: 'Regulatory Affairs & Compliance' },
];

export function findDivisionById(id) {
  return MOCK_DIVISIONS.find((division) => division.id === id) || null;
}
