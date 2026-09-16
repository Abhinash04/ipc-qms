import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Bundle budget — run after `vite build` (`npm run build:check`).
 *
 * Thresholds are set from the measured build of 2026-09-15 (entry chunk
 * 253 kB raw after code splitting + lazy Dexie) with ~20% headroom. If this
 * fails, the likely cause is a static import that pulled a page, Dexie, or a
 * heavy library back into the entry chunk — check routes/routeElements.jsx is
 * still lazy and useWorkflowStore still loads services/db/db dynamically.
 */
const ASSETS_DIR = new URL('../dist/assets', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'); // strip leading slash on Windows paths

const ENTRY_BUDGET_KB = 310; // entry (index-*.js) raw size
const CHUNK_BUDGET_KB = 450; // any single chunk raw size

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
