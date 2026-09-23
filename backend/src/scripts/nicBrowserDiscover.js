import 'dotenv/config';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import browserConfig from '../config/browserConfig.js';
import { formatReport, inspectBrowser } from '../services/email/nic/browser/inspect.js';

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
