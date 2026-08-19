import { axiosClient } from './axiosClient';

export async function fetchGemmaAiSummary({ subject, body, inquirerName }) {
  try {
    const { data } = await axiosClient.post('/ai/summary', {
      subject,
      body,
      inquirerName,
    });
    if (data && data.success && data.summary) {
      return data.summary;
    }
  } catch (error) {
    console.warn('[AI Service] Failed to fetch Gemma AI summary from backend:', error.message);
  }
  return null;
}
