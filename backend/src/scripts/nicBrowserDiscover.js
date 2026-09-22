import 'dotenv/config';

import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

import browserConfig from '../config/browserConfig.js';
import { formatReport, inspectBrowser } from '../services/email/nic/browser/inspect.js';

/**
 * Read-only discovery against the live NICeMail session.
 *
 * Reports what Chrome is exposing, which document holds the mailbox and why
 * (a cross-origin iframe, shadow DOM, a list not rendered, …), what the
 * accessibility tree and the interactive elements look like, how every entry
 * in browser/selectors.js resolves, and the mail rows as the agent sees them —
 * then says what, if anything, stops the agent. See inspect.js.
 *
 * It clicks nothing, types nothing, navigates nowhere and sends nothing in any
 * tab of yours.
 *
 *   npm run nic:browser:discover
 *   npm run nic:browser:discover -- --json            also write the report to NIC_BROWSER_ARTIFACT_DIR
 *   npm run nic:browser:discover -- --rows=10         show more mail rows
 *   npm run nic:browser:discover -- --show-addresses  do not mask addresses
 *   npm run nic:browser:discover -- --agent-tab       also inspect the agent's own background tab,
 *                                                     which it opens and closes exactly as a sync does
 */

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const rowsArg = args.find((arg) => arg.startsWith('--rows='));
const rows = Math.max(1, Number.parseInt(rowsArg?.split('=')[1], 10) || 5);
const agentTab = flag('agent-tab');

async function main() {
  console.log('\nNICeMail browser discovery — READ ONLY.');
  console.log('Nothing in your tabs is clicked, typed, navigated, opened or sent.');
  if (agentTab) console.log("The agent's own background tab is opened once, inspected and closed.");

  const report = await inspectBrowser({ agentTab, rows, showAddresses: flag('show-addresses') });
  for (const line of formatReport(report)) console.log(line);

  if (flag('json')) {
    const dir = path.resolve(browserConfig.artifactDir);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `nic-inspect-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(file, JSON.stringify(report, null, 2));
    console.log(`\n  Report written to ${file}`);
  }

  console.log(`\nDiscovery complete. No page state was modified${agentTab ? ' (one agent tab was opened and closed)' : ''}.\n`);
  process.exit(report.diagnosis.verdict === 'FAIL' ? 1 : 0);
}

main().catch((error) => {
  console.error(`\nUnexpected error: ${error?.message || error}\n`);
  process.exit(1);
});
