import app from './app.js';
import env, { assertValidEmailConfig, EMAIL_TRANSPORTS } from './config/env.js';
import { assertValidAuthConfig } from './config/authConfig.js';
import { connectDb, disconnectDb } from './config/db.js';
import { IDENTITY_ROLES, identityForRole } from './config/identities.js';
import * as mailbox from './services/email/mailbox/index.js';

// All imports are hoisted in ESM, so they are grouped here rather than being
// interleaved with the startup checks below as the CommonJS version was. The
// ordering is unchanged in practice: importing ./app.js already pulls in the
// config, and none of these modules act on the configuration at import time.

try {
  assertValidEmailConfig();
  // Fail fast rather than starting a server whose every sign-in would throw
  // on a missing signing secret.
  assertValidAuthConfig();
} catch (error) {
  console.error(`\n${error.message}\n`);
  process.exit(1);
}

/** Mirrors the interlock in transports/nicTransport.js — reported, not enforced, here. */
const nicOutboundAllowed = () => String(process.env.NIC_ALLOW_OUTBOUND || '').trim() === 'true';

/**
 * Report the configuration that is actually in force.
 *
 * Addresses and names only — never a token, a client secret, or anything that
 * is not already public on `GET /emails/config`.
 */
function describeConfiguration() {
  const frontOffice = identityForRole(IDENTITY_ROLES.FRONT_OFFICE);
  const store = mailbox.describe();

  // Named per transport rather than "gmail or else mock": a boot line that
  // reports the wrong transport is worse than no boot line, and an operator
  // reads this to confirm what a restart actually changed.
  const TRANSPORT_LABELS = {
    [EMAIL_TRANSPORTS.GMAIL]: 'Gmail (real sends)',
    [EMAIL_TRANSPORTS.NIC]: nicOutboundAllowed()
      ? 'NICeMail SMTP (real sends)'
      : `NICeMail SMTP — confined to NIC_TEST_RECIPIENT (set NIC_ALLOW_OUTBOUND=true to release)`,
    [EMAIL_TRANSPORTS.MOCK]: 'mock (nothing leaves this machine)',
  };

  const transport = TRANSPORT_LABELS[env.EMAIL_TRANSPORT] || env.EMAIL_TRANSPORT;

  // Enquiries are addressed to the Front Officer when one is configured; the
  // shared mock address is the fallback. Saying otherwise would be misleading.
  const recipient = frontOffice?.email
    ? `${frontOffice.name} <${frontOffice.email}>`
    : env.IPC_QUERY_EMAIL;

  const source =
    store.backend === 'gmail'
      ? `${frontOffice?.name || 'Front Officer'}'s Gmail inbox`
      : store.persistence;

  return { transport, recipient, source };
}

/**
 * Awaited, not fire-and-forget.
 *
 * This used to be `connectDb().finally(...)`, so the server listened whether or
 * not the database answered. In development that is a convenience; in
 * production it means every request is served by an instance that cannot store
 * anything, while reporting success. `connectDb` throws instead of degrading
 * when NODE_ENV=production — see config/db.js.
 */
try {
  await connectDb();
} catch (error) {
  console.error(`\n[qms] ${error.message}\n`);
  process.exit(1);
}

const server = app.listen(env.PORT, () => {
  const { transport, recipient, source } = describeConfiguration();

  console.log(`QMS backend listening on port ${env.PORT} (${env.NODE_ENV})`);
  console.log(`Email transport: ${transport}`);
  console.log(`Query recipient: ${recipient}`);
  console.log(`Mailbox source:  ${source}`);

  // Every route below /auth and /health now requires a session, and roles
  // are enforced per route. What is still missing is the case-level half:
  // see the TODO in middleware/authorizeAttachmentAccess.js.
  console.warn(
    '[qms] Authorization is role-level only. Any signed-in user can read any ' +
      'attachment by id, because Query Case ownership is not yet server-side. ' +
      'Do not expose this server outside a trusted network.',
  );
});

/**
 * Stop accepting connections, let in-flight requests finish, then close the
 * database. Without this an orchestrator's SIGTERM killed the process mid
 * request and left Mongo sockets to time out on the server side.
 *
 * The timer is unref'd so it cannot itself hold the process open.
 */
const SHUTDOWN_GRACE_MS = 10000;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[qms] ${signal} received — shutting down`);

  const forced = setTimeout(() => {
    console.error('[qms] shutdown timed out with requests still open — exiting anyway');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  forced.unref();

  try {
    await new Promise((resolve) => server.close(resolve));
    await disconnectDb();
    console.log('[qms] shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error(`[qms] shutdown failed: ${error.message}`);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

/**
 * A process that has thrown outside every handler is in an unknown state.
 * Node's default for an unhandled rejection is already to exit; this makes the
 * reason visible first, which is the part that was missing.
 */
process.on('unhandledRejection', (reason) => {
  console.error('[qms] unhandled promise rejection:', reason);
  void shutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  console.error('[qms] uncaught exception:', error);
  void shutdown('uncaughtException');
});
