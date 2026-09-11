// dotenv must run before nicConfig.js snapshots process.env. ESM executes
// dependencies in declaration order, so this import stays first.
import 'dotenv/config';

import { read_nicemail, send_nicemail, describeNicSetup } from '../services/email/nic/actions.js';

/**
 * NICeMail agent verification.
 *
 *   Test A — READ : connect → authenticate → open mailbox → fetch a real email
 *   Test B — SEND : connect → authenticate → submit
 *   Receipt       : re-read the mailbox looking for the Message-ID just sent
 *
 * Every level is reported separately. Connectivity is not authentication,
 * authentication is not submission, and submission is not delivery — the whole
 * point of this script is to refuse to conflate them.
 *
 *   npm run nic:verify
 *
 * Sends one message, and only to NIC_TEST_RECIPIENT (the NIC mailbox itself by
 * default), so nothing reaches a third party.
 */

const PASS = 'PASS';
const FAIL = 'FAIL';
const SKIP = 'SKIPPED (blocked by an earlier stage)';

/** Stage ordering, so "reached fetch" implies connect and authenticate passed. */
const READ_STAGES = ['connect', 'authenticate', 'open_mailbox', 'fetch'];
const SEND_STAGES = ['connect', 'authenticate', 'submit'];

/**
 * A stage passed if the run got past it. On failure `result.stage` names the
 * stage that failed, so every earlier stage passed and every later one is
 * untested rather than failed.
 */
function grade(result, stages, stage) {
  const reached = stages.indexOf(result.stage);
  const asked = stages.indexOf(stage);
  if (reached === -1 || asked === -1) return FAIL;
  if (result.ok) return asked <= reached ? PASS : FAIL;
  if (asked < reached) return PASS;
  if (asked === reached) return FAIL;
  return SKIP;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const line = (label, value) => console.log(`  ${label.padEnd(34)}${value}`);

async function main() {
  const setup = describeNicSetup();

  console.log('\nNICeMail agent verification');
  console.log('Sends exactly one message, only to the allow-listed test recipient.\n');
  console.log('── Configuration (no secrets)');
  line('Mailbox', setup.mailbox || '(not set)');
  line('IMAP', setup.imap || '(not set)');
  line('SMTP', setup.smtp || '(not set)');
  line('Folder', setup.folder);
  line('Test recipient', setup.testRecipient || '(not set)');
  line(
    'Credential',
    setup.credential.configured ? `configured via ${setup.credential.source}` : 'NOT CONFIGURED',
  );

  if (setup.configErrors.length) {
    console.log('\n  Configuration errors:');
    for (const error of setup.configErrors) console.log(`    - ${error}`);
  }

  // ── Test A — READ ────────────────────────────────────────────────────────
  console.log('\n── Test A — READ (IMAP)');
  const read = await read_nicemail({ limit: 1 });

  const readGrades = {
    'IMAP server connectivity': grade(read, READ_STAGES, 'connect'),
    'IMAP authentication': grade(read, READ_STAGES, 'authenticate'),
    'Mailbox access': grade(read, READ_STAGES, 'open_mailbox'),
    'Email fetch/read': grade(read, READ_STAGES, 'fetch'),
  };
  for (const [label, value] of Object.entries(readGrades)) line(label, value);

  if (!read.ok) {
    console.log(`\n  Failed at stage: ${read.stage}`);
    console.log(`  Server said: ${read.error}`);
  } else {
    const [message] = read.data.messages;
    line('Messages in mailbox', String(read.data.total));
    if (message) {
      console.log('\n  Newest message:');
      line('From', message.from || '(none)');
      line('To', message.to || '(none)');
      line('Subject', message.subject);
      line('Date', message.date || '(none)');
      line('Message-ID', message.messageId || '(none)');
      line('Attachments', String(message.attachments.length));
      const preview = (message.text || '').trim().replace(/\s+/g, ' ').slice(0, 160);
      line('Body preview', preview ? `${preview}${preview.length === 160 ? '…' : ''}` : '(empty)');
    }
  }

  // ── Test B — SEND ────────────────────────────────────────────────────────
  console.log('\n── Test B — SEND (SMTP)');
  const marker = `QMS NICeMail connectivity test ${new Date().toISOString()}`;
  const send = await send_nicemail({ subject: marker });

  const sendGrades = {
    'SMTP server connectivity': grade(send, SEND_STAGES, 'connect'),
    'SMTP authentication': grade(send, SEND_STAGES, 'authenticate'),
    'Email submission': grade(send, SEND_STAGES, 'submit'),
  };
  for (const [label, value] of Object.entries(sendGrades)) line(label, value);

  if (!send.ok) {
    console.log(`\n  Failed at stage: ${send.stage}`);
    console.log(`  Server said: ${send.error}`);
  } else {
    line('Message-ID', send.data.messageId || '(none)');
    line('SMTP response', send.data.response || '(none)');
    line('Accepted', JSON.stringify(send.data.accepted));
    line('Rejected', JSON.stringify(send.data.rejected));
  }

  // ── Receipt ──────────────────────────────────────────────────────────────
  // SMTP acceptance is a promise to try, not proof of delivery. Because the
  // recipient is the mailbox itself, the claim can actually be checked.
  console.log('\n── Receipt verification');
  let receipt = 'NOT VERIFIED';

  if (send.ok && read.ok) {
    const sentId = send.data.messageId;
    for (let attempt = 1; attempt <= 5 && receipt === 'NOT VERIFIED'; attempt += 1) {
      await delay(4000);
      const recheck = await read_nicemail({ limit: 10 });
      if (!recheck.ok) break;
      const found = recheck.data.messages.some(
        (m) => (sentId && m.messageId === sentId) || m.subject === marker,
      );
      if (found) receipt = 'VERIFIED';
      else line(`Attempt ${attempt}`, 'not yet in the mailbox');
    }
  } else {
    line('Skipped', 'send or read did not succeed');
  }

  line('Actual recipient receipt', receipt);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────');
  const allPassed =
    Object.values(readGrades).every((v) => v === PASS) &&
    Object.values(sendGrades).every((v) => v === PASS) &&
    receipt === 'VERIFIED';

  console.log(allPassed ? 'RESULT: PASS' : 'RESULT: FAIL');

  if (!allPassed && (read.stage === 'authenticate' || send.stage === 'authenticate')) {
    console.log(
      '\nThe endpoints answered but the credential was refused. Under MFA a\n' +
        'webmail login password is rejected for IMAP/SMTP by design — an\n' +
        'application-specific password is required (webmail → Security →\n' +
        'App Passwords). This is not a code defect and cannot be worked around.',
    );
  }

  console.log('');
  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  // Should not happen: the actions return failures rather than throwing.
  console.error(`\nUnexpected error: ${error?.message || error}\n`);
  process.exit(1);
});
