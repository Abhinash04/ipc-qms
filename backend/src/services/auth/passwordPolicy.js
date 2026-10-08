export const MIN_PASSWORD_LENGTH = 8;
// bcrypt reads only the first 72 bytes; a longer password would match any password sharing them.
export const MAX_PASSWORD_BYTES = 72;

/** Why this password is not acceptable, or null when it is. Shared by sign-up and administrators. */
export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return `Password must be at most ${MAX_PASSWORD_BYTES} bytes`;
  }
  return null;
}
