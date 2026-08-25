import env from '../config/env.js';
import { generateDraft, decomposeEnquiry } from '../services/ai/gemmaService.js';
import { retrieveContext } from '../data/ipcKnowledge.js';
import { selectContext } from '../data/ipcContextBrain.js';

const ENQUIRY = {
  subject: 'Query on degradation products and excipient compatibility in a stability study',
  body: [
    'Dear Sir/Madam,',
    '',
    'During accelerated stability studies of our tablet formulation we have observed a degradation product that is not listed in the monograph.',
    '',
    '1. The impurity appears above the identification threshold at 40 degrees Celcius and 75 percent RH but remains below it at long-term conditions. Is characterisation required in this case, and should it be reported in the specification?',
    '',
    '2. We suspect an interaction between the active substance and one of the excipients used in the formulation. Is there published guidance on excipient compatibility study design that we should follow?',
    '',
    'We would be grateful for direction on whether a change of excipient would require a fresh stability commitment.',
    '',
    'Regards,',
    'Abhinash Pritiraj',
    'Formulation Development',
  ].join('\n'),
  inquirerName: 'Abhinash Pritiraj',
  summaryText:
    'The inquirer reports a degradation product above the identification threshold under accelerated conditions, asks whether characterisation and specification reporting are required, asks for guidance on excipient compatibility study design, and asks whether changing an excipient requires a fresh stability commitment.',
  keyPoints: [
    'Degradation product above the identification threshold under accelerated conditions only.',
    'Suspected active–excipient interaction.',
    'Whether an excipient change requires a fresh stability commitment.',
  ],
};

console.log(`GEMMA_API_URL: ${env.GEMMA_API_URL || '(not configured — will use the fallback)'}`);
console.log(`timeout: ${env.GEMMA_TIMEOUT_MS}ms, x3 for drafting\n`);

console.log('--- decomposition ---');
const questions = await decomposeEnquiry(ENQUIRY);
questions.forEach((q, i) => console.log(`  Q${i + 1}: ${q}`));

console.log('\n--- evidence retrieved per question ---');
questions.forEach((question, index) => {
  console.log(`\n  QUESTION ${index + 1}`);
  const glossary = selectContext(question);
  const passages = retrieveContext(question, { limit: 5 });
  console.log(`    glossary: ${glossary.map((e) => e.id).join(', ') || '(none)'}`);
  if (passages.length === 0) console.log('    passages: (none matched)');
  passages.forEach((p) => console.log(`    passage:  [${p.docId}] ${p.section}`));
});

console.log('\n--- calling Gemma ---');
const started = Date.now();
const draft = await generateDraft(ENQUIRY);
console.log(`took ${Date.now() - started}ms; aiGenerated=${draft.aiGenerated} fallback=${draft.fallback}\n`);

console.log(`Subject: ${draft.subject}\n`);
draft.answers.forEach((answer, index) => {
  console.log(`${index + 1}. [${answer.sufficiency}] ${answer.questionText}`);
  answer.paragraphs.forEach((paragraph) => console.log(`\n   ${paragraph}`));
  if (answer.notEstablished) console.log(`\n   NOT SETTLED: ${answer.notEstablished}`);
  if (answer.sources.length) console.log(`\n   Sources: ${answer.sources.join('; ')}`);
  console.log('');
});

console.log(`contextUsed: ${draft.contextUsed.join(', ')}`);
