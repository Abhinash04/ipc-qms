import dotenv from 'dotenv';
import { recommendOfficial } from '../services/ai/gemmaService.js';

dotenv.config();

async function runLiveRecommendationTest() {
  console.log('======================================================================');
  console.log('🧪 TESTING LIVE GEMMA LLM OFFICIAL RECOMMENDATIONS (TOP 3)');
  console.log('======================================================================');

  const testPayload = {
    subject: 'Urgent: Method validation and dissolution testing criteria for Paracetamol IP 500mg',
    body: `Dear IPC Team,
We require clarification on the HPLC chromatographic assay method validation parameters and dissolution testing apparatus selection for Paracetamol 500mg IP tablets.

Regards,
Abhinash Pritiraj`,
    summaryText: 'Technical clarification requested on HPLC assay method validation and dissolution testing for Paracetamol IP.',
  };

  console.log('\nQuery Subject:', testPayload.subject);
  console.log('AI Summary:', testPayload.summaryText);
  console.log('\n----------------------------------------------------------------------');
  console.log('Analyzing query against 6 IPC Officials metadata using Gemma AI...');

  const startTime = Date.now();
  const recommendations = await recommendOfficial(testPayload);
  const duration = Date.now() - startTime;

  console.log('----------------------------------------------------------------------');
  console.log(`⏱️ Completed in ${duration} ms\n`);
  console.log('🏆 TOP 3 RECOMMENDED IPC OFFICIALS:');
  console.log(JSON.stringify(recommendations, null, 2));
  console.log('======================================================================');
}

runLiveRecommendationTest().catch(console.error);
