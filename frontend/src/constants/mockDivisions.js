export const MOCK_DIVISIONS = [
  { id: 'DIV-001', name: 'Training & Development' },
  { id: 'DIV-002', name: 'Policy & Compliance' },
  { id: 'DIV-003', name: 'Technical Operations' },
  { id: 'DIV-004', name: 'Administration' },
];

export function findDivisionById(id) {
  return MOCK_DIVISIONS.find((division) => division.id === id) || null;
}
