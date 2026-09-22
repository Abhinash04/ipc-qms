import app from './app.js';
import env, { assertValidEmailConfig, EMAIL_TRANSPORTS } from './config/env.js';
import { assertValidAuthConfig } from './config/authConfig.js';
import { connectDb, disconnectDb } from './config/db.js';
import browserConfig from './config/browserConfig.js';
import { IDENTITY_ROLES, identityForRole } from './config/identities.js';
import * as mailbox from './services/email/mailbox/index.js';
import { outboundAllowed } from './services/email/nic/outboundGuard.js';

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
    [EMAIL_TRANSPORTS.NIC]: outboundAllowed()
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

  // The NICeMail browser agent sends the acknowledgement and final response of
  // every case from the NICeMail mailbox, whatever EMAIL_TRANSPORT says, so it
  // is reported on its own line. Read from config only: the agent itself is
  // never loaded at boot, and Chrome is not contacted.
  const nicAgent = browserConfig.mailboxEnabled
    ? `on — ${browserConfig.mailboxAddress} via CDP ${browserConfig.cdpEndpoint}; sends the acknowledgement ` +
      `and final response of NICeMail cases (timeout ${browserConfig.timeoutMs} ms)`
    : null;

  // The browser agent's side of the NIC_ALLOW_OUTBOUND interlock. (NICeMail
  // SMTP reports its own, with its own test recipient, in the transport label.)
  const guard = !browserConfig.mailboxEnabled
    ? null
    : outboundAllowed()
      ? 'OPEN — NIC_ALLOW_OUTBOUND=true: NICeMail browser sends may reach any recipient'
      : `closed — NICeMail browser sends confined to ${browserConfig.testRecipient || '(no test recipient set)'}`;

  return { transport, recipient, source, nicAgent, guard };
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

// Express 5 calls this on a failed bind too, with the error — which the
// 'error' handler below reports. The banner is for a server that is listening.
const server = app.listen(env.PORT, (error) => {
  if (error) return;
  const { transport, recipient, source, nicAgent, guard } = describeConfiguration();

  console.log(`QMS backend listening on port ${env.PORT} (${env.NODE_ENV}), pid ${process.pid}`);
  console.log(`Email transport: ${transport}`);
  console.log(`Query recipient: ${recipient}`);
  console.log(`Mailbox source:  ${source}`);
  console.log(`NICeMail agent:  ${nicAgent || 'off (NIC_BROWSER_MAILBOX is not "true")'}`);
  if (guard) console.log(`Outbound guard:  ${guard}`);

  /**
   * What authorization does and does not cover, stated at boot.
   *
   * Case-level access IS server-side now: reads are scoped by
   * services/authz/caseAccess.js, writes go through
   * middleware/authorizeCaseDelta.js, and attachments resolve their owning
   * case. What is still absent is a server-side state machine — anyone party
   * to a case can write any field on it, and the four roles whose scope is
   * "everything" can write any case at all.
   */
  console.warn(
    '[qms] Case access is enforced server-side, but there is no workflow state ' +
      'machine yet: a principal party to a case may write any field on it, and ' +
      'Front Office, Officer-in-Charge, Admin and Super Admin reach every case. ' +
      'Do not expose this server outside a trusted network.',
  );
});

/**
 * A server that could not bind never started, and says so with exit code 1.
 * A port already taken means another backend is still serving it — often the
 * one this start was meant to replace. Left to the uncaught-exception path it
 * shut down with exit code 0, and the old process, with its old code, went on
 * answering every request.
 */
server.on('error', (error) => {
  if (server.listening) {
    console.error('[qms] server error:', error);
    void shutdown('server error');
    return;
  }
  console.error(
    error.code === 'EADDRINUSE'
      ? `\n[qms] port ${env.PORT} is already in use — another backend is still running; not starting.\n`
      : `\n[qms] could not listen on port ${env.PORT}: ${error.message}\n`,
  );
  disconnectDb()
    .catch(() => {})
    .finally(() => process.exit(1));
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
