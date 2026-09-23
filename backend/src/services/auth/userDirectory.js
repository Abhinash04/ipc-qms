import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { allUsers } from '../../constants/users.js';
import { hashFor, reset as resetCredentials, BCRYPT_ROUNDS } from './credentials.js';

const DUMMY_HASH = bcrypt.hashSync(randomUUID(), BCRYPT_ROUNDS);
const normalise = (email) => String(email || '').trim().toLowerCase();
const toPublicUser = ({ id, name, email, role, divisionId }) => ({ id, name, email, role, divisionId });

export function findByEmail(email) {
  const wanted = normalise(email);
  if (!wanted) return null;
  return allUsers().find((user) => normalise(user.email) === wanted) || null;
}

export function findById(id) {
  return allUsers().find((user) => user.id === id) || null;
}

export function listUsers() {
  return allUsers().map(toPublicUser);
}

export async function verifyCredentials(email, password) {
  const user = findByEmail(email);
  const expected = (user && hashFor(user.id)) || DUMMY_HASH;
  const passwordMatches = await bcrypt.compare(String(password || ''), expected);

  if (!user || !passwordMatches) return null;
  return toPublicUser(user);
}

export function reset() {
  resetCredentials();
}

export { toPublicUser };
