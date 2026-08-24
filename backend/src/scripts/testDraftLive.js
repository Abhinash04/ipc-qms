import env from '../config/env.js';
import { generateDraft } from '../services/ai/gemmaService.js';
import { retrieveContext } from '../data/ipcKnowledge.js';
import { selectContext } from '../data/ipcContextBrain.js';

const ENQUIRY = {
  subject: 'Clarification on monograph revision and use of an alternative analytical method',
  body: [
    'Dear Sir/Madam,',
    '',
    'We manufacture a prolonged-release tablet formulation and seek clarification on the following:',
    '1. Whether the Indian Pharmacopoeia monograph standards are legally enforceable for our product.',
    '2. Whether we may apply an alternative analytical procedure in place of the official IP method.',
    '3. How to obtain the relevant IP Reference Substance.',
    '',
    'Regards,',
    'Abhinash Pritiraj',
  ].join('\n'),
  inquirerName: 'Abhinash Pritiraj',
  summaryText:
    'The inquirer asks whether IP monograph standards are legally enforceable, whether an alternative analytical method may be used, and how to obtain the relevant IPRS.',
  keyPoints: [
    'Are IP monograph standards legally enforceable?',
    'May an alternative analytical procedure be used?',
    'How is the IPRS obtained?',
  ],
};

const retrievalText = `${ENQUIRY.subject} ${ENQUIRY.body} ${ENQUIRY.summaryText}`;

console.log(`GEMMA_API_URL: ${env.GEMMA_API_URL || '(not configured — will use the fallback)'}`);
console.log(`timeout: ${env.GEMMA_TIMEOUT_MS}ms x3 for drafting\n`);

console.log('--- glossary terms selected ---');
for (const entry of selectContext(retrievalText)) {
  console.log(`  ${entry.id}: ${entry.term}`);
}

console.log('\n--- document passages retrieved ---');
for (const passage of retrieveContext(retrievalText)) {
  console.log(`  [${passage.docId}] ${passage.section}`);
}

console.log('\n--- calling Gemma ---');
const started = Date.now();
const draft = await generateDraft(ENQUIRY);
console.log(`took ${Date.now() - started}ms; aiGenerated=${draft.aiGenerated} fallback=${draft.fallback}\n`);

console.log(`Subject: ${draft.subject}\n`);
for (const paragraph of draft.paragraphs) {
  console.log(`${paragraph}\n`);
}
if (draft.unanswered.length) {
  console.log('Unanswered:');
  for (const item of draft.unanswered) console.log(`  - ${item}`);
}
console.log(`\ncontextUsed: ${draft.contextUsed.join(', ')}`);
