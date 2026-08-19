import dotenv from 'dotenv';
import { generateSummary } from '../services/ai/gemmaService.js';

dotenv.config();

async function runLiveGemmaTest() {
  console.log('======================================================================');
  console.log('🧪 TESTING LIVE GEMMA LLM AI SUMMARY GENERATION');
  console.log('======================================================================');

  const testPayload = {
    subject: 'Urgent: Clarification required on Dissolution Test for Paracetamol IP 500mg',
    body: `Dear IPC Team,

We are writing to seek urgent technical guidance regarding the dissolution test procedure specified in the Indian Pharmacopoeia for Paracetamol IP 500mg tablets.

Specifically, we have two main queries:
1. What is the exact buffer pH specified for stage-2 dissolution testing?
2. Is the basket apparatus or paddle apparatus recommended for modified release formulations under the monograph?

We request your prompt clarification so we can proceed with batch release compliance.

Regards,
Abhinash Pritiraj
Quality Assurance Team`,
    inquirerName: 'Abhinash Pritiraj',
  };

  console.log('\nSubject:', testPayload.subject);
  console.log('\nBody:\n', testPayload.body);
  console.log('\n----------------------------------------------------------------------');
  console.log('Sending request to Gemma LLM API...');

  const startTime = Date.now();
  const summary = await generateSummary(testPayload);
  const duration = Date.now() - startTime;

  console.log('----------------------------------------------------------------------');
  console.log(`⏱️ Completed in ${duration} ms\n`);
  console.log('🤖 GENERATED AI SUMMARY RESULT:');
  console.log(JSON.stringify(summary, null, 2));
  console.log('======================================================================');
}

runLiveGemmaTest().catch(console.error);
