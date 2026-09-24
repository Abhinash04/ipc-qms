import app from './app.js';
import env, { assertValidEmailConfig, EMAIL_TRANSPORTS, ENV_SOURCE } from './config/env.js';
import { assertValidAuthConfig } from './config/authConfig.js';
import { connectDb, disconnectDb } from './config/db.js';
import browserConfig from './config/browserConfig.js';
import { IDENTITY_ROLES, identityForRole, formatSender } from './config/identities.js';
import * as mailbox from './services/email/mailbox/index.js';
import { outboundAllowed, internalForwardAllowed } from './services/email/nic/outboundGuard.js';
import { startRetentionSweeps, stopRetentionSweeps } from './services/email/mailbox/retention.js';
import { startMailboxSync, stopMailboxSync } from './services/email/mailbox/syncScheduler.js';


try {
  assertValidEmailConfig();
  assertValidAuthConfig();
} catch (error) {
  console.error(`\n${error.message}\n  (env file: ${ENV_SOURCE || 'none'})\n`);
  process.exit(1);
}

function describeConfiguration() {
  const frontOffice = identityForRole(IDENTITY_ROLES.FRONT_OFFICE);
  const store = mailbox.describe();
  const TRANSPORT_LABELS = {
    [EMAIL_TRANSPORTS.NIC]: outboundAllowed()
      ? 'NICeMail SMTP (real sends)'
      : `NICeMail SMTP — confined to NIC_TEST_RECIPIENT (set NIC_ALLOW_OUTBOUND=true to release)`,
    [EMAIL_TRANSPORTS.MOCK]: 'mock (nothing leaves this machine)',
  };

  const transport = TRANSPORT_LABELS[env.EMAIL_TRANSPORT] || env.EMAIL_TRANSPORT;
  const recipient = formatSender(frontOffice);
  const source = store.persistence;
  const nicAgent = !browserConfig.mailboxEnabled
    ? null
    : browserConfig.mailboxViewer
      ? `viewer — lists ${browserConfig.mailboxAddress} from the database and never reads NICeMail; ` +
        `NICeMail sends are refused here (NIC_BROWSER_VIEWER=true) and retried from the mailbox host`
      : `on — ${browserConfig.mailboxAddress} via CDP ${browserConfig.cdpEndpoint}; sends the acknowledgement, ` +
        `the forward to the Officer-in-Charge and the final response of NICeMail cases ` +
        `(timeout ${browserConfig.timeoutMs} ms)`;

  const guard = !browserConfig.mailboxEnabled
    ? null
    : outboundAllowed()
      ? 'OPEN — NIC_ALLOW_OUTBOUND=true: NICeMail browser sends may reach any recipient'
      : `closed — NICeMail browser sends confined to ${browserConfig.testRecipient || '(no test recipient set)'}` +
        (internalForwardAllowed() ? ', plus OFFICER_IN_CHARGE_EMAIL for the internal forward' : '');

  return { transport, recipient, source, nicAgent, guard };
}

try {
  await connectDb();
} catch (error) {
  console.error(`\n[qms] ${error.message}\n`);
  process.exit(1);
}

startRetentionSweeps({ bootedAt: Date.now() });
startMailboxSync();

const server = app.listen(env.PORT, (error) => {
  if (error) return;
  const { transport, recipient, source, nicAgent, guard } = describeConfiguration();

  console.log(`QMS backend listening on port ${env.PORT} (${env.NODE_ENV}), pid ${process.pid}`);
  console.log(`Email transport: ${transport}`);
  console.log(`Query recipient: ${recipient}`);
  console.log(`Mailbox source:  ${source}`);
  console.log(`NICeMail agent:  ${nicAgent || 'off (NIC_BROWSER_MAILBOX is not "true")'}`);
  if (guard) console.log(`Outbound guard:  ${guard}`);
  console.warn(
    '[qms] Case access is enforced server-side, but there is no workflow state ' +
      'machine yet: a principal party to a case may write any field on it, and ' +
      'Front Office, Officer-in-Charge, Admin and Super Admin reach every case. ' +
      'Do not expose this server outside a trusted network.',
  );
});
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

const SHUTDOWN_GRACE_MS = 10000;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[qms] ${signal} received — shutting down`);

  stopRetentionSweeps();
  stopMailboxSync();

  const forced = setTimeout(() => {
    console.error('[qms] shutdown timed out with requests still open — exiting anyway');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  forced.unref();

  try {
    await new Promise((resolve) => server.close(resolve));
    const { closeAgentTabs } = await import('./services/email/nic/browser/session.js');
    await closeAgentTabs();
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
process.on('unhandledRejection', (reason) => {
  console.error('[qms] unhandled promise rejection:', reason);
  void shutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  console.error('[qms] uncaught exception:', error);
  void shutdown('uncaughtException');
});
