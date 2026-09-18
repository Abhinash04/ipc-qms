import 'dotenv/config';

import { chromium } from 'playwright-core';
import browserConfig from '../config/browserConfig.js';
import { attachToNicemail, release, scoreTab } from '../services/email/nic/browser/attach.js';
import { SELECTORS, locate, locateInFrames } from '../services/email/nic/browser/selectors.js';

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
  } catch (error) {
    // The failure reason is carried out so the report can distinguish "nothing
    // is listening" from "something is listening that does not speak CDP".
    return { failure: error };
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

  if (tabs?.failure) {
    const reason = String(tabs.failure?.message || tabs.failure).split('\n')[0];
    const refused = /ECONNREFUSED|refused|ENOTFOUND|timeout|ETIMEDOUT/i.test(reason);

    console.log('  Could not connect.\n');
    console.log(`  ${reason}\n`);

    if (refused) {
      console.log('  Nothing is listening on the CDP endpoint.');
      console.log('  Please open the supported Chrome session first.\n');
      console.log('  To enable it:');
      console.log('    Chrome 144+  open chrome://inspect/#remote-debugging and allow connections');
      console.log('    otherwise    relaunch Chrome with:');
      console.log('                 --remote-debugging-port=9222 --user-data-dir=C:\\qms-chrome');
      console.log('                 (a non-default user-data-dir is required on Chrome 136+)\n');
    } else {
      console.log('  The port answered, but not as a Chrome DevTools endpoint.');
      console.log('  Another browser — Brave, Edge, or a second Chrome profile — is most');
      console.log('  likely holding it, and Chrome cannot bind the port while it does.\n');
      console.log('  To check on Windows:');
      console.log('    Get-NetTCPConnection -LocalPort 9222 -State Listen |');
      console.log('      ForEach-Object { Get-Process -Id $_.OwningProcess }\n');
      console.log('  Then close that browser, or set NIC_CDP_ENDPOINT to a free port.\n');
    }

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
    // `page.accessibility` was removed from Playwright; the ARIA snapshot is its
    // replacement — YAML lines of the form `- role "name"`.
    console.log('\n── Accessibility tree (interesting nodes)');
    const snapshot = await page.locator('body').ariaSnapshot();

    const INTERESTING = new Set([
      'button', 'link', 'textbox', 'searchbox', 'combobox', 'listitem',
      'row', 'grid', 'table', 'list', 'tab', 'menuitem', 'heading',
    ]);
    const nodes = snapshot.split('\n').filter((entry) => {
      const match = entry.trim().match(/^- (\w+) "/);
      return match && INTERESTING.has(match[1]);
    });

    for (const entry of nodes.slice(0, 220)) console.log(`  ${entry.slice(0, 100)}`);
    if (nodes.length === 0) console.log('  (no named interactive nodes — the UI may be canvas or in a frame)');
    if (nodes.length > 220) console.log('  … truncated');

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

    // How the agent's own selectors fare on this page. Reading selectors apply
    // to the inbox and an opened message; compose selectors only match once a
    // compose window is open, which this script never does — open one by hand
    // and re-run to check them.
    console.log('\n── Agent selectors (browser/selectors.js)');
    for (const [key, spec] of Object.entries(SELECTORS)) {
      if (key === 'rowIdAttributes') continue;
      const found = key === 'body' || key === 'bodyEditor'
        ? await locateInFrames(page, spec)
        : await locate(page, spec);
      line(key, found ? `${await found.count()} match(es)` : 'no match');
    }

    const rows = await locate(page, SELECTORS.messageRow);
    if (rows) {
      console.log('\n── First message rows (id attributes)');
      const count = Math.min(await rows.count(), 3);
      for (let index = 0; index < count; index += 1) {
        const row = rows.nth(index);
        const ids = [];
        for (const attribute of SELECTORS.rowIdAttributes) {
          const value = await row.getAttribute(attribute).catch(() => null);
          if (value) ids.push(`${attribute}=${value.slice(0, 40)}`);
        }
        line(`row ${index + 1}`, ids.join('  ') || '(no id attribute — content hash will be used)');
      }
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
