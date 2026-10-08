import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { allUsers } from '../../constants/users.js';
import { hashFor, reset as resetCredentials, BCRYPT_ROUNDS } from './credentials.js';
import { isConnected } from '../../config/db.js';
import { User } from '../../models/User.js';

const DUMMY_HASH = bcrypt.hashSync(randomUUID(), BCRYPT_ROUNDS);
const normalise = (email) => String(email || '').trim().toLowerCase();
const toPublicUser = (u) => {
  if (!u) return null;
  return {
    id: u.userId || u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    divisionId: u.divisionId || null,
  };
};

const registeredUsers = [];

export function addUser(user) {
  registeredUsers.push(user);
}

export function findByEmail(email) {
  const wanted = normalise(email);
  if (!wanted) return null;
  return [...allUsers(), ...registeredUsers].find((user) => normalise(user.email) === wanted) || null;
}

export function findById(id) {
  return [...allUsers(), ...registeredUsers].find((user) => user.id === id || user.userId === id) || null;
}

export function listUsers() {
  return [...allUsers(), ...registeredUsers].map(toPublicUser);
}

export async function verifyCredentials(email, password) {
  const wanted = normalise(email);
  if (!wanted) return null;

  const dirUser = findByEmail(email);
  let dbUser = null;

  if (isConnected()) {
    try {
      dbUser = await User.findOne({ email: wanted });
    } catch {
      dbUser = null;
    }
  }

  const user = dbUser || dirUser;
  if (!user) {
    await bcrypt.compare(String(password || ''), DUMMY_HASH);
    return null;
  }

  const expectedHash = user.password || (user.id && hashFor(user.id)) || DUMMY_HASH;
  const passwordMatches = await bcrypt.compare(String(password || ''), expectedHash);

  if (!passwordMatches) return null;
  return toPublicUser(user);
}

export function reset() {
  resetCredentials();
}

export { toPublicUser };
