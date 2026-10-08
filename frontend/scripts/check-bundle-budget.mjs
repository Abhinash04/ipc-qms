import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS_DIR = new URL('../dist/assets', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'); 
const ENTRY_BUDGET_KB = 310;
const CHUNK_BUDGET_KB = 450;

const LAZY_VENDOR_BUDGETS = [
  { pattern: /^apexRuntime-.*\.js$/, kb: 700, what: 'ApexCharts (lazy)' },
];

const budgetFor = (file) =>
  LAZY_VENDOR_BUDGETS.find((b) => b.pattern.test(file)) || { kb: CHUNK_BUDGET_KB, what: null };

const files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.js'));
const sizes = files.map((f) => ({ file: f, kb: statSync(join(ASSETS_DIR, f)).size / 1024 }));

const failures = [];

const entry = sizes.find((s) => /^index-.*\.js$/.test(s.file));
if (!entry) {
  failures.push('No entry chunk (index-*.js) found in dist/assets — did the build run?');
} else if (entry.kb > ENTRY_BUDGET_KB) {
  failures.push(
    `Entry chunk ${entry.file} is ${entry.kb.toFixed(0)} kB (budget ${ENTRY_BUDGET_KB} kB).`,
  );
}

for (const s of sizes) {
  const budget = budgetFor(s.file);
  if (s.kb > budget.kb) {
    failures.push(
      `Chunk ${s.file} is ${s.kb.toFixed(0)} kB (budget ${budget.kb} kB${budget.what ? `, ${budget.what}` : ''}).`,
    );
  }
}

if (failures.length) {
  console.error('Bundle budget FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

const regular = sizes.filter((s) => !budgetFor(s.file).what);
const lazyVendors = sizes
  .filter((s) => budgetFor(s.file).what)
  .map((s) => `${budgetFor(s.file).what} ${s.kb.toFixed(0)} kB (≤ ${budgetFor(s.file).kb} kB)`);

console.log(
  `Bundle budget OK — entry ${entry.kb.toFixed(0)} kB (≤ ${ENTRY_BUDGET_KB} kB), ` +
    `largest chunk ${Math.max(...regular.map((s) => s.kb)).toFixed(0)} kB (≤ ${CHUNK_BUDGET_KB} kB)` +
    (lazyVendors.length ? `; ${lazyVendors.join(', ')}.` : '.'),
);
