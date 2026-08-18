import app from './app.js';
import env, { assertValidEmailConfig } from './config/env.js';
import { connectDb } from './config/db.js';
import * as mailbox from './services/email/mailbox/index.js';

try {
  assertValidEmailConfig();
} catch (error) {
  console.error(`\n${error.message}\n`);
  process.exit(1);
}

connectDb().finally(() => {
  app.listen(env.PORT, () => {
    console.log(`QMS backend listening on port ${env.PORT} (${env.NODE_ENV})`);
    console.log(`Email transport: ${env.EMAIL_TRANSPORT} → IPC mailbox: ${env.IPC_QUERY_EMAIL}`);
    console.log(`Mailbox store: ${mailbox.describe().persistence}`);
  });
});
