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

export async function fetchGemmaAiDraft({ subject, body, inquirerName, summaryText, keyPoints }) {
  try {
    const { data } = await axiosClient.post('/ai/draft', {
      subject,
      body,
      inquirerName,
      summaryText,
      keyPoints,
    });
    if (data && data.success && data.draft) {
      return data.draft;
    }
  } catch (error) {
    console.warn('[AI Service] Failed to fetch Pravah AI draft from backend:', error.message);
  }
  return null;
}

export async function fetchGemmaAiRecommendations({ subject, body, summaryText }) {
  try {
    const { data } = await axiosClient.post('/ai/recommend', {
      subject,
      body,
      summaryText,
    });
    if (data && data.success && Array.isArray(data.recommendations)) {
      return data.recommendations;
    }
  } catch (error) {
    console.warn('[AI Service] Failed to fetch Gemma AI recommendations from backend:', error.message);
  }
  return null;
}

/** Assigned Officials a case can go to: built-in ones and every approved, active one an administrator added. */
export async function fetchAssignableOfficials() {
  try {
    const { data } = await axiosClient.get('/ai/officials');
    if (data && data.success && Array.isArray(data.officials)) {
      return data.officials;
    }
  } catch (error) {
    console.warn('[AI Service] Failed to fetch assignable officials from backend:', error.message);
  }
  return null;
}
