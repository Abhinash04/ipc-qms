import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS_DIR = new URL('../dist/assets', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'); 
const ENTRY_BUDGET_KB = 310; 
const CHUNK_BUDGET_KB = 450;

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
  if (s.kb > CHUNK_BUDGET_KB) {
    failures.push(`Chunk ${s.file} is ${s.kb.toFixed(0)} kB (budget ${CHUNK_BUDGET_KB} kB).`);
  }
}

if (failures.length) {
  console.error('Bundle budget FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `Bundle budget OK — entry ${entry.kb.toFixed(0)} kB (≤ ${ENTRY_BUDGET_KB} kB), ` +
    `largest chunk ${Math.max(...sizes.map((s) => s.kb)).toFixed(0)} kB (≤ ${CHUNK_BUDGET_KB} kB).`,
);
