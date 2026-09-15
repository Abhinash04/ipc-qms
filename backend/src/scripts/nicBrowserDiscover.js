import 'dotenv/config';

import { chromium } from 'playwright-core';
import browserConfig from '../config/browserConfig.js';
import { attachToNicemail, release, scoreTab } from '../services/email/nic/browser/attach.js';

/**
 * Read-only discovery against the live NICeMail tab.
 *
 * NICeMail is Zoho-backed, and selectors for a DOM nobody has looked at are
 * guesses. This dumps what is actually on the page so read/send can be written
 * against reality.
 *
 * It clicks nothing, types nothing, navigates nowhere and sends nothing.
 *
 *   npm run nic:browser:discover
 */

const line = (label, value) => console.log(`  ${String(label).padEnd(34)}${value}`);

async function listAllTabs() {
  // Enumerated separately from attachToNicemail so the report can show every
  // tab Chrome exposes, including the ones that did not match.
  let browser;
  try {
    browser = await chromium.connectOverCDP(browserConfig.cdpEndpoint, {
      timeout: browserConfig.timeoutMs,
    });
  } catch {
    return null;
  }

  const rows = [];
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      const url = page.url();
      let title;
      try {
        title = await page.title();
      } catch {
        // A page mid-navigation cannot report a title.
        title = '(unavailable)';
      }
      rows.push({ url, title, score: scoreTab({ url, title }) });
    }
  }

  await release(browser);
  return rows;
}

async function main() {
  console.log('\nNICeMail browser discovery — READ ONLY.');
  console.log('Nothing is clicked, typed, navigated or sent.\n');

  console.log('── Configuration');
  line('CDP endpoint', browserConfig.cdpEndpoint);
  line('URL patterns', browserConfig.urlPatterns.join(', '));
  line('Title patterns', browserConfig.titlePatterns.join(', '));

  console.log('\n── Tabs Chrome is exposing');
  const tabs = await listAllTabs();

  if (tabs === null) {
    console.log('  Could not connect.\n');
    console.log('  Chrome is not available for browser automation.');
    console.log('  Please open the supported Chrome session first.\n');
    console.log('  To enable it:');
    console.log('    Chrome 144+  open chrome://inspect/#remote-debugging and allow connections');
    console.log('    otherwise    relaunch Chrome with:');
    console.log('                 --remote-debugging-port=9222 --user-data-dir=C:\\qms-chrome');
    console.log('                 (a non-default user-data-dir is required on Chrome 136+)\n');
    process.exit(1);
  }

  if (tabs.length === 0) {
    console.log('  (none)');
  }
  for (const tab of tabs) {
    const mark = tab.score > 0 ? `match(${tab.score})` : 'no match';
    console.log(`  [${mark.padEnd(10)}] ${tab.title.slice(0, 40).padEnd(42)} ${tab.url.slice(0, 90)}`);
  }

  console.log('\n── Attaching to the NICeMail tab');
  const attached = await attachToNicemail();

  if (!attached.ok) {
    line('Stage reached', attached.stage);
    console.log(`\n  ${attached.error}\n`);
    if (attached.details) console.log(`  details: ${JSON.stringify(attached.details)}\n`);
    process.exit(1);
  }

  const { browser, page } = attached.data;
  line('URL', attached.data.url);
  line('Title', attached.data.title);

  try {
    console.log('\n── Frames');
    for (const frame of page.frames()) {
      console.log(`  ${frame === page.mainFrame() ? '(main)' : '      '} ${frame.url().slice(0, 110)}`);
    }

    // The accessibility tree is the right basis for locators — it is what
    // getByRole matches against, and it is far more stable than CSS classes,
    // which Zoho generates.
    console.log('\n── Accessibility tree (interesting nodes)');
    const snapshot = await page.accessibility.snapshot({ interestingOnly: true });

    const INTERESTING = new Set([
      'button', 'link', 'textbox', 'searchbox', 'combobox', 'listitem',
      'row', 'grid', 'table', 'list', 'tab', 'menuitem', 'heading',
    ]);
    let shown = 0;

    const walk = (node, depth = 0) => {
      if (!node || shown > 220) return;
      const name = (node.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (INTERESTING.has(node.role) && name) {
        console.log(`  ${'  '.repeat(Math.min(depth, 6))}${node.role.padEnd(10)} "${name}"`);
        shown += 1;
      }
      for (const child of node.children || []) walk(child, depth + 1);
    };
    walk(snapshot);
    if (shown === 0) console.log('  (no named interactive nodes — the UI may be canvas or in a frame)');
    if (shown > 220) console.log('  … truncated');

    console.log('\n── Candidate compose / message controls');
    const probes = [
      ['compose button', /^(compose|new mail|new message|write)$/i],
      ['send button', /^send$/i],
      ['to field', /^(to|recipient)/i],
      ['subject field', /^subject/i],
      ['inbox link', /^inbox/i],
    ];
    for (const [label, pattern] of probes) {
      let found = 0;
      for (const role of ['button', 'link', 'textbox', 'combobox']) {
        try {
          found += await page.getByRole(role, { name: pattern }).count();
        } catch {
          // A role query can throw on a detached frame; it just means zero here.
        }
      }
      line(label, found > 0 ? `${found} candidate(s) by role` : 'not found by role');
    }
  } finally {
    await release(browser);
  }

  console.log('\nDiscovery complete. No page state was modified.\n');
}

main().catch((error) => {
  console.error(`\nUnexpected error: ${error?.message || error}\n`);
  process.exit(1);
});
