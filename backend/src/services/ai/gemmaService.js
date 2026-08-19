import env from '../../config/env.js';

function generateFallbackSummary({ subject = '', body = '', inquirerName = 'The Inquirer' }) {
  const cleanSubject = subject.trim() || 'Untitled Enquiry';
  const sentences = body
    .split(/(?<=[.?!।])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15 && !/^(dear|regards|thank|hi|hello)/i.test(s));

  const keyPoints = sentences.slice(0, 3);
  if (keyPoints.length === 0 && body.trim()) {
    keyPoints.push(body.trim().slice(0, 150));
  }

  const topicKeywords = ['monograph', 'impurity', 'analytical', 'dissolution', 'assay', 'regulatory', 'compliance', 'certificate', 'invoice'];
  const textLower = `${cleanSubject} ${body}`.toLowerCase();
  const topics = topicKeywords.filter((topic) => textLower.includes(topic));

  const mainSummaryText = `${inquirerName} submitted an enquiry regarding "${cleanSubject}". ${keyPoints[0] || 'Enquiry details provided.'}`;

  return {
    text: mainSummaryText,
    keyPoints: keyPoints.length > 0 ? keyPoints : ['Enquiry submitted for review.'],
    topics: topics.length > 0 ? topics : ['General Enquiry'],
    aiGenerated: false,
    fallback: true,
  };
}

function cleanApiResponse(rawAnswer) {
  if (!rawAnswer) return '';
  let str = String(rawAnswer).trim();
  
  str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  str = str.replace(/^["']|["']$/g, '').trim();

  return str;
}

function parseSummaryJson(jsonStr, fallbackData) {
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed.text === 'string' && parsed.text.trim()) {
      return {
        text: parsed.text.trim(),
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.filter(Boolean) : [],
        topics: Array.isArray(parsed.topics) ? parsed.topics.filter(Boolean) : [],
        aiGenerated: true,
        fallback: false,
      };
    }
  } catch (_) {
    if (jsonStr && jsonStr.length > 10) {
      return {
        text: jsonStr,
        keyPoints: fallbackData.keyPoints,
        topics: fallbackData.topics,
        aiGenerated: true,
        fallback: false,
      };
    }
  }
  return null;
}

export async function generateSummary({ subject = '', body = '', inquirerName = '' }) {
  const fallback = generateFallbackSummary({ subject, body, inquirerName });

  if (!env.GEMMA_API_URL) {
    console.warn('[Gemma AI] GEMMA_API_URL is not configured. Returning fallback summary.');
    return fallback;
  }

  const prompt = `You are an expert AI summary assistant for the Indian Pharmacopoeia Commission (IPC) Query Management System. Your task is to provide a concise, factual summary of the following incoming enquiry email for the Officer-in-Charge (OIC).

STRICT RULES:
1. Rely ONLY on the facts mentioned in the input text. Do NOT assume, extrapolate, or invent any information.
2. Output strictly valid JSON with the following structure:
{
  "text": "A clear 1-2 sentence core summary of the main enquiry and request.",
  "keyPoints": ["Key point 1", "Key point 2"],
  "topics": ["Topic 1", "Topic 2"]
}
3. Return ONLY the JSON object. Do NOT wrap in explanation, introductory text, or markdown code blocks outside JSON.

Enquiry Subject: "${subject.trim() || 'Untitled Enquiry'}"
Enquiry Body:
"""
${body.trim() || 'No body content provided.'}
"""

JSON Summary:`;

  const timeoutDuration = env.NODE_ENV === 'test' ? 500 : (env.GEMMA_TIMEOUT_MS || 12000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

  try {
    console.log(`[Gemma AI] Calling Gemma LLM at ${env.GEMMA_API_URL}...`);
    const response = await fetch(env.GEMMA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Gemma AI] API returned status ${response.status}. Using fallback.`);
      return fallback;
    }

    const data = await response.json();
    const rawAnswer = data?.answer || data?.response || data?.text || null;

    if (rawAnswer) {
      const cleaned = cleanApiResponse(rawAnswer);
      const parsed = parseSummaryJson(cleaned, fallback);
      if (parsed) {
        console.log('[Gemma AI Summary Generated Successfully]');
        return parsed;
      }
    }

    console.warn('[Gemma AI] Could not parse Gemma answer. Using fallback.');
    return fallback;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.warn(`[Gemma AI] Request timed out after ${env.GEMMA_TIMEOUT_MS}ms. Using fallback.`);
    } else {
      console.warn(`[Gemma AI] API call failed: ${error.message}. Using fallback.`);
    }
    return fallback;
  }
}

export const gemmaService = { generateSummary };
export default gemmaService;
