import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  IPC_DOCS,
  EXCLUDED_DOCS,
  REPOSITORY,
  DOC_KIND,
} from '../src/data/ipcDocs.manifest.js';
import { chunkByHeadings, expertWorkingGroupNames } from '../src/data/ipcDocIngest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(here, '../../docs/markdown');
const OUT_FILE = path.resolve(here, '../src/data/ipcKnowledge.json');

const chunks = [];
const ingested = [];
const skipped = EXCLUDED_DOCS.map((doc) => ({ file: doc.file, reason: doc.reason }));

for (const meta of IPC_DOCS) {
  const fullPath = path.join(DOCS_DIR, meta.file);

  if (!existsSync(fullPath)) {
    skipped.push({ file: meta.file, reason: 'File not found in docs/markdown.' });
    continue;
  }

  const raw = readFileSync(fullPath, 'utf8');

  if (!raw.trim()) {
    skipped.push({ file: meta.file, reason: 'File is empty.' });
    continue;
  }

  let produced;

  if (meta.docId === 'EWG') {
    const groups = expertWorkingGroupNames(raw);
    produced = groups.length
      ? [
          {
            id: 'EWG#1',
            docId: 'EWG',
            docTitle: meta.title,
            documentId: null,
            kind: DOC_KIND.REFERENCE,
            amendmentList: null,
            section: 'Expert Working Groups',
            text: `The Indian Pharmacopoeia Commission maintains the following Expert Working Groups: ${groups.join(', ')}.`,
          },
        ]
      : [];
    skipped.push({
      file: meta.file,
      reason: 'Member rosters and Commission Members stripped: personal data, no inquiry value. Group names retained.',
      partial: true,
    });
  } else {
    produced = chunkByHeadings(raw, meta);
  }

  for (const chunk of produced) {
    chunks.push({
      ...chunk,
      source: { file: meta.file, ...REPOSITORY },
    });
  }

  ingested.push({ file: meta.file, docId: meta.docId, chunks: produced.length });
}

const payload = {
  generatedBy: 'scripts/ingestIpcDocs.mjs',
  sourceDirectory: 'docs/markdown',
  repository: REPOSITORY.repository,
  totals: { documents: ingested.length, chunks: chunks.length, skipped: skipped.length },
  ingested,
  skipped,
  chunks,
};

writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

const chars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
console.log(`[ipc-ingest] ${chunks.length} chunks from ${ingested.length} documents (${chars} chars)`);
for (const entry of skipped) {
  console.log(`[ipc-ingest] ${entry.partial ? 'partial' : 'skipped'}: ${entry.file} — ${entry.reason}`);
}
console.log(`[ipc-ingest] wrote ${path.relative(process.cwd(), OUT_FILE)}`);
