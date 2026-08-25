import env from '../config/env.js';
import { generateDraft, decomposeEnquiry } from '../services/ai/gemmaService.js';
import { retrieveContext } from '../data/ipcKnowledge.js';
import { selectContext } from '../data/ipcContextBrain.js';
import { assembleDraftEmail } from '../../../frontend/src/services/ai/draftComposer.js';
import { qualifyPassages } from '../data/evidenceQualification.js';

const ENQUIRY = {
  subject: 'Clarification on submission documentation and compliance requirements',
  body: [
    'Dear Sir/Madam,',
    '',
    'We require clarification on the documentation to be included in our forthcoming submission.',
    '',
    '1. Which guideline currently applies to the format of the quality section, and is the previous format still accepted during the transition period?',
    '',
    '2. For a change in the manufacturing site, what supporting documentation is expected, and does the change require prior approval or is notification sufficient?',
    '',
    '3. Please confirm the compliance evidence required in respect of the revised labelling requirements.',
    '',
    'Regards,',
    'Abhinash Pritiraj',
    'Regulatory Affairs',
  ].join('\n'),
  inquirerName: 'Abhinash Pritiraj',
  summaryText:
    'The inquirer asks which guideline applies to the quality section format and whether the previous format is still accepted during the transition period, what documentation a manufacturing site change requires and whether prior approval or notification applies, and what compliance evidence the revised labelling requirements demand.',
  keyPoints: [
    'Applicable guideline for the quality section format and transition-period acceptance.',
    'Manufacturing site change: documentation, and approval versus notification.',
    'Compliance evidence for revised labelling requirements.',
  ],
};

console.log(`GEMMA_API_URL: ${env.GEMMA_API_URL || '(not configured — will use the fallback)'}`);
console.log(`timeout: ${env.GEMMA_TIMEOUT_MS}ms, x5 for drafting\n`);

console.log('--- decomposition ---');
const questions = await decomposeEnquiry(ENQUIRY);
questions.forEach((q, i) => console.log(`  Q${i + 1}: ${q}`));

console.log('\n--- evidence: retrieved → qualified, per question ---');
questions.forEach((question, index) => {
  const anchored = `${ENQUIRY.subject} ${question}`.trim();
  const candidates = retrieveContext(anchored, { limit: 12, charBudget: 20000 });
  const { qualified, rejected } = qualifyPassages(question, candidates);

  console.log(`\n  QUESTION ${index + 1} — ${candidates.length} candidates → ${qualified.length} qualified`);
  if (qualified.length === 0) console.log('    (nothing qualified — this question must be NOT_ESTABLISHED)');
  qualified.slice(0, 3).forEach((p) => console.log(`    KEEP  [${p.docId}] ${p.section}`));
  rejected.slice(0, 4).forEach((r) =>
    console.log(`    drop  [${r.chunk.docId}] ${r.chunk.section.slice(0, 52)} — ${r.reason}`),
  );
  if (qualified.length > 0) {
    console.log(`    glossary: ${selectContext(anchored).map((e) => e.id).join(', ') || '(none)'}`);
  }
});

console.log('\n--- calling Gemma ---');
const started = Date.now();
const draft = await generateDraft(ENQUIRY);
console.log(`took ${Date.now() - started}ms; aiGenerated=${draft.aiGenerated} fallback=${draft.fallback}\n`);

console.log(`questions: ${questions.length}   answers: ${draft.answers.length}`);
console.log(
  `sufficiency: ${draft.answers.map((a) => `${a.question}=${a.sufficiency}`).join(' ')}\n`,
);

console.log('════════ COMPOSED EMAIL ════════\n');
console.log(
  assembleDraftEmail({
    query: {
      queryId: 'QRY-2026-00005',
      subject: ENQUIRY.subject,
      inquirer: { name: ENQUIRY.inquirerName },
    },
    draft,
  }),
);

console.log(`\n════════ traceability ════════`);
draft.answers.forEach((a) => console.log(`  ${a.question}. sources: ${a.sources.join('; ') || '(none)'}`));
console.log(`contextUsed: ${draft.contextUsed.join(', ')}`);
