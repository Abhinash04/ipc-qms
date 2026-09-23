/**
 * The external enquirer every intake test writes in as.
 *
 * Deliberately not a MOCK_USERS row. A real inquirer holds no account here:
 * they email the Front Office mailbox from their own provider and never sign
 * in, so `findUserByEmail` does not resolve them and `ingestEmail` stores
 * `id: null` for the sender. Tests that needed a name and an address for a
 * `From` header used to borrow the seeded USR-0001 account, which made an
 * external sender look like a user of the system. That account, and the
 * INQUIRER role behind it, are gone.
 *
 * The address is on `@pharma.example` — a reserved domain (RFC 2606) that stands
 * in for the sender's own provider without being a real mailbox. It reads as
 * external, which `@ipc.example` would not.
 */
export const EXTERNAL_INQUIRER = {
  id: null,
  name: 'Abhinash Pritiraj',
  email: 'abhinash.pritiraj@pharma.example',
};
