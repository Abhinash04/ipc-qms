import app from './app.js';
import env, { assertValidEmailConfig, EMAIL_TRANSPORTS } from './config/env.js';
import { connectDb } from './config/db.js';
import { IDENTITY_ROLES, identityForRole } from './config/identities.js';
import * as mailbox from './services/email/mailbox/index.js';

// All imports are hoisted in ESM, so they are grouped here rather than being
// interleaved with the startup checks below as the CommonJS version was. The
// ordering is unchanged in practice: importing ./app.js already pulls in the
// config, and none of these modules act on the configuration at import time.

try {
  assertValidEmailConfig();
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

  const transport =
    env.EMAIL_TRANSPORT === EMAIL_TRANSPORTS.GMAIL
      ? 'Gmail (real sends)'
      : 'mock (nothing leaves this machine)';

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

connectDb().finally(() => {
  app.listen(env.PORT, () => {
    const { transport, recipient, source } = describeConfiguration();

    console.log(`QMS backend listening on port ${env.PORT} (${env.NODE_ENV})`);
    console.log(`Email transport: ${transport}`);
    console.log(`Query recipient: ${recipient}`);
    console.log(`Mailbox source:  ${source}`);
  });
});
