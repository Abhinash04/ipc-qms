import { google } from 'googleapis';
import env from '../config/env.js';
import { allIdentities, IDENTITY_ROLES } from '../config/identities.js';

const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const READ_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
];

const mask = (value) => (value ? `set (${value.length} chars)` : 'MISSING');
const has = (scopes, wanted) =>
  scopes.includes(wanted) || scopes.includes('https://mail.google.com/');

function reportApiDisabled(message) {
  const projectMatch = message.match(/project (\d+)/);
  console.error('\n✗ The Gmail API is NOT enabled for this Google Cloud project.');
  console.error('  Credentials and scope are valid, but every Gmail API call will fail —');
  console.error('  including the actual send. This must be fixed before the manual test.');
  console.error('\n  Fix: enable the Gmail API at');
  console.error(
    `  https://console.developers.google.com/apis/api/gmail.googleapis.com/overview${
      projectMatch ? `?project=${projectMatch[1]}` : ''
    }`,
  );
}

/** @returns {'ok'|'skipped'|'failed'} */
async function checkIdentity(identity) {
  const { role, name, email, refreshToken } = identity;
  console.log(`\n── ${role} — ${name} <${email}>`);
  console.log(`   GMAIL_REFRESH_TOKEN_${role}  ${mask(refreshToken)}`);

  if (!refreshToken) {
    console.log('   ○ Not configured — this role falls back to the mock transport.');
    console.log('     Expected for every role except FRONT_OFFICE: inquirers are external');
    console.log('     senders who never authenticate here, and nothing sends as the OIC.');
    return 'skipped';
  }

  const auth = new google.auth.OAuth2(
    env.GMAIL_CLIENT_ID,
    env.GMAIL_CLIENT_SECRET,
    env.GMAIL_REDIRECT_URI,
  );
  auth.setCredentials({ refresh_token: refreshToken });

  let tokenInfo;
  try {
    const { token } = await auth.getAccessToken();
    if (!token) throw new Error('No access token returned');
    tokenInfo = await auth.getTokenInfo(token);
    console.log('   ✓ Refresh token accepted');
  } catch (error) {
    const message = error.message || '';
    console.error(`   ✗ Refresh token rejected: ${message}`);

    if (/unauthorized_client/i.test(message)) {
      // The token is well-formed but was minted by a different OAuth app.
      console.error('     The token was issued for a DIFFERENT OAuth client than the');
      console.error(`     GMAIL_CLIENT_ID now in .env (…${env.GMAIL_CLIENT_ID.slice(-12)}).`);
      console.error('     Most often: the OAuth Playground was used without ticking');
      console.error('     "Use your own OAuth credentials", so Google issued the token');
      console.error('     against the Playground own client instead of yours.');
      console.error(`     Fix: re-authorise ${email} with your own client id/secret.`);
    } else if (/invalid_grant/i.test(message)) {
      console.error('     The token has expired or been revoked. Re-authorise the account.');
    } else {
      console.error('     Expired, revoked, or issued for a different OAuth client.');
    }
    return 'failed';
  }

  const scopes = tokenInfo.scopes || [];

  if (has(scopes, SEND_SCOPE)) {
    console.log(`   ✓ Scope granted — ${SEND_SCOPE}`);
  } else {
    console.error(`   ✗ Missing scope ${SEND_SCOPE}`);
    console.error(`     Granted: ${scopes.join(', ') || '(none reported)'}`);
    return 'failed';
  }

  // Only the Front Officer's inbox is polled, so only that role needs read access.
  const canRead = READ_SCOPES.some((scope) => has(scopes, scope));
  if (role === IDENTITY_ROLES.FRONT_OFFICE) {
    if (canRead) {
      console.log('   ✓ Read scope granted — inbox polling (MAILBOX_SOURCE=gmail) will work');
    } else {
      console.warn('   ⚠ No gmail.readonly/gmail.modify scope.');
      console.warn('     Sending works, but MAILBOX_SOURCE=gmail cannot read this inbox,');
      console.warn('     so no enquiry ever reaches the Front Officer for validation.');
    }
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const authenticated = profile.data.emailAddress || '';

    if (authenticated.toLowerCase() !== email.toLowerCase()) {
      console.error(`   ✗ IDENTITY MISMATCH — authenticated as ${authenticated}, configured as ${email}`);
      console.error('     Gmail sends as the authenticated account regardless of the From header,');
      console.error(`     so mail the QMS records as "from ${name}" would arrive from ${authenticated}.`);
      console.error(`     Re-authorise while signed in as ${email}, or correct ${role}_EMAIL.`);
      return 'failed';
    }

    console.log(`   ✓ Authenticated as ${authenticated} — matches the configured address`);
    return 'ok';
  } catch (error) {
    const message = error.message || '';
    if (/has not been used in project|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(message)) {
      reportApiDisabled(message);
      return 'failed';
    }
    console.error(`   ✗ Could not read the Gmail profile: ${message}`);
    console.error('     Without this the authenticated address cannot be confirmed.');
    return 'failed';
  }
}

async function preflight() {
  console.log('\nGmail credential preflight — no message will be composed or sent.\n');
  console.log('Shared OAuth application:');
  console.log(`  EMAIL_TRANSPORT      ${env.EMAIL_TRANSPORT}`);
  console.log(`  MAILBOX_SOURCE       ${env.MAILBOX_SOURCE}`);
  console.log(`  GMAIL_CLIENT_ID      ${mask(env.GMAIL_CLIENT_ID)}`);
  console.log(`  GMAIL_CLIENT_SECRET  ${mask(env.GMAIL_CLIENT_SECRET)}`);
  console.log(`  GMAIL_REDIRECT_URI   ${env.GMAIL_REDIRECT_URI}`);

  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET) {
    console.error('\nFAILED — GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET missing.');
    console.error('Add them to backend/.env (see .env.example). Nothing was sent.\n');
    process.exit(1);
  }

  const results = [];
  for (const identity of allIdentities()) {
    results.push([identity.role, await checkIdentity(identity)]);
  }

  const failed = results.filter(([, status]) => status === 'failed');
  const ok = results.filter(([, status]) => status === 'ok');
  const skipped = results.filter(([, status]) => status === 'skipped');

  console.log('\n────────────────────────────────────────');
  console.log(`Real senders: ${ok.length}   Mock fallback: ${skipped.length}   Failed: ${failed.length}`);

  /**
   * Only one mailbox is authenticated, so only one can fail the thing that
   * matters. The Front Office account is what this system reads from and sends
   * as: acknowledgements, the forward to the Officer-in-Charge and the final
   * dispatch all go out as the Front Officer, and inbox polling uses the same
   * token.
   */
  const frontOffice = results.find(([role]) => role === IDENTITY_ROLES.FRONT_OFFICE);
  if (!frontOffice || frontOffice[1] !== 'ok') {
    console.error('\nPREFLIGHT FAILED — the Front Office mailbox is not authenticated.');
    console.error('Set GMAIL_REFRESH_TOKEN_FRONT_OFFICE with gmail.send and a read scope.');
    console.error('Nothing was sent.\n');
    process.exit(1);
  }

  // A broken token on any other role cannot affect anything — nothing sends as
  // the Officer-in-Charge, and an inquirer is whoever sent the mail. So this is
  // reported as dead configuration to delete rather than as a failure to fix.
  const strays = failed.filter(([role]) => role !== IDENTITY_ROLES.FRONT_OFFICE);
  if (strays.length) {
    console.warn(`\n⚠ Configured but unusable: ${strays.map(([role]) => role).join(', ')}`);
    console.warn('  These tokens are no longer used by anything. Nothing is broken by');
    console.warn('  their failure — delete the GMAIL_REFRESH_TOKEN_<ROLE> variables from');
    console.warn('  backend/.env so the configuration stops claiming a capability that');
    console.warn('  does not exist.');
  }

  console.log('\nPREFLIGHT PASSED — the Front Office mailbox authenticates as itself.');
  console.log('This does NOT mean the Gmail integration is verified end-to-end.');
  console.log('To verify: run the procedure in docs/EMAIL_MANUAL_TEST.md — send an');
  console.log('enquiry from any external address and confirm it arrives for validation.\n');
}

preflight().catch((error) => {
  console.error(`\nPreflight error: ${error.message}\n`);
  process.exit(1);
});
