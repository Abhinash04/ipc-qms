import { google } from 'googleapis';
import env from '../config/env.js';

const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

const mask = (value) => (value ? `set (${value.length} chars)` : 'MISSING');

async function preflight() {
  console.log('\nGmail credential preflight — no message will be composed or sent.\n');

  console.log('Configuration:');
  console.log(`  EMAIL_TRANSPORT      ${env.EMAIL_TRANSPORT}`);
  console.log(`  GMAIL_CLIENT_ID      ${mask(env.GMAIL_CLIENT_ID)}`);
  console.log(`  GMAIL_CLIENT_SECRET  ${mask(env.GMAIL_CLIENT_SECRET)}`);
  console.log(`  GMAIL_REFRESH_TOKEN  ${mask(env.GMAIL_REFRESH_TOKEN)}`);
  console.log(`  GMAIL_REDIRECT_URI   ${env.GMAIL_REDIRECT_URI}`);
  console.log('');

  const missing = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'].filter(
    (key) => !env[key],
  );
  if (missing.length) {
    console.error(`FAILED — missing: ${missing.join(', ')}`);
    console.error('Add them to backend/.env (see .env.example). Nothing was sent.\n');
    process.exit(1);
  }

  const auth = new google.auth.OAuth2(
    env.GMAIL_CLIENT_ID,
    env.GMAIL_CLIENT_SECRET,
    env.GMAIL_REDIRECT_URI,
  );
  auth.setCredentials({ refresh_token: env.GMAIL_REFRESH_TOKEN });

  let tokenInfo;
  try {
    const { token } = await auth.getAccessToken();
    if (!token) throw new Error('No access token returned');
    tokenInfo = await auth.getTokenInfo(token);
    console.log('✓ Refresh token accepted — access token obtained');
  } catch (error) {
    console.error(`\n✗ Refresh token rejected: ${error.message}`);
    console.error('  The token may be expired, revoked, or issued for a different client.');
    console.error('  Re-authorise and regenerate the refresh token. Nothing was sent.\n');
    process.exit(1);
  }

  const scopes = tokenInfo.scopes || [];
  if (scopes.includes(REQUIRED_SCOPE) || scopes.includes('https://mail.google.com/')) {
    console.log(`✓ Scope granted — ${REQUIRED_SCOPE}`);
  } else {
    console.error(`\n✗ Missing scope ${REQUIRED_SCOPE}`);
    console.error(`  Granted scopes: ${scopes.join(', ') || '(none reported)'}`);
    console.error('  Re-authorise including the gmail.send scope. Nothing was sent.\n');
    process.exit(1);
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const address = profile.data.emailAddress;
    console.log(`✓ Gmail API reachable — authenticated as ${address}`);

    if (address?.toLowerCase() !== env.INQUIRER_EMAIL.toLowerCase()) {
      console.warn(
        `\n⚠ Authenticated account (${address}) differs from INQUIRER_EMAIL ` +
          `(${env.INQUIRER_EMAIL}).\n  Mail would be sent from the authenticated account, ` +
          'not from INQUIRER_EMAIL.',
      );
    }
  } catch (error) {
    const message = error.message || '';
    const apiDisabled =
      /has not been used in project|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(message);

    if (apiDisabled) {
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
      console.error('  then wait a few minutes for it to propagate and re-run this preflight.');
      console.error('\nPREFLIGHT FAILED. Nothing was sent.\n');
      process.exit(1);
    }

    console.warn(`\n⚠ Could not read the Gmail profile: ${message}`);
    console.warn('  Token and scope are valid; this check may need the gmail.readonly scope.');
  }

  console.log('\nPREFLIGHT PASSED — credentials are usable.');
  console.log('This does NOT mean the Gmail integration is verified end-to-end.');
  console.log('To verify: set EMAIL_TRANSPORT=gmail, send a real enquiry, and confirm it');
  console.log('appears in the Gmail Sent folder. See docs/EMAIL_MANUAL_TEST.md.\n');
}

preflight().catch((error) => {
  console.error(`\nPreflight error: ${error.message}\n`);
  process.exit(1);
});
