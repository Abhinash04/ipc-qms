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

  const prompt = `You are an expert AI Assistant specialized in the Indian Pharmacopoeia Commission (IPC) domain, Ministry of Health & Family Welfare, Government of India.

Your task is to analyze the following incoming enquiry email and generate a crisp, domain-specific summary tailored for the IPC Officer-in-Charge (OIC) and technical officers.

IPC CONTEXT & RULES:
1. Focus on IPC operational domain: Drug Monographs, Indian Pharmacopoeia (IP) Standards, Reference Standards (IPRS), Impurities, Analytical Testing (Dissolution, Assay, HPLC, Stability), and Regulatory Compliance.
2. Identify the specific Drug/Monograph name, the exact technical request/issue, and the relevant IPC technical domain.
3. Do NOT assume, extrapolate, or invent facts not present in the original enquiry text.
4. Output strictly valid JSON with the following structure:
{
  "text": "1-2 sentence professional technical summary highlighting the drug/monograph name and exact request for IPC officers.",
  "keyPoints": ["Technical Point 1", "Technical Point 2"],
  "topics": ["Drug/Monograph Name", "IPC Domain e.g., Dissolution / Impurity / Monograph"]
}
5. Return ONLY the JSON object. Do NOT include markdown wrappers, explanations, or text outside the JSON.

Enquiry Subject: "${subject.trim() || 'Untitled Enquiry'}"
Enquiry Body:
"""
${body.trim() || 'No body content provided.'}
"""

IPC JSON Summary:`;

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
