import env from '../../config/env.js';
import { ASSIGNED_OFFICIALS } from '../../config/officialsMetadata.js';


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

/**
 * Clean markdown or raw quotes from Gemma API response
 */
function cleanApiResponse(rawAnswer) {
  if (!rawAnswer) return '';
  let str = String(rawAnswer).trim();
  
  str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  str = str.replace(/^["']|["']$/g, '').trim();

  return str;
}

/**
 * Parse JSON safely from string
 */
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

/**
 * Call Gemma API to generate an AI summary for an enquiry query email
 */
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

/**
 * Fallback recommendation engine based on metadata keyword matching
 */
function generateFallbackRecommendations({ subject = '', body = '', summaryText = '' }) {
  const fullText = `${subject} ${body} ${summaryText}`.toLowerCase();

  const scored = ASSIGNED_OFFICIALS.map((official, idx) => {
    const matchedKeywords = official.expertise.filter((skill) => fullText.includes(skill.toLowerCase()));
    const divisionMatch = fullText.includes(official.divisionName.toLowerCase());

    let matchPercent = 0;
    if (matchedKeywords.length > 0) {
      // Strong keyword match: 70% base + 12% per additional keyword + division match
      matchPercent = Math.min(98, 70 + (matchedKeywords.length - 1) * 12 + (divisionMatch ? 10 : 0));
    } else if (divisionMatch) {
      matchPercent = 65;
    } else {
      // Dynamic differentiation when no direct technical keyword matches (e.g., 55%, 42%, 30%)
      matchPercent = Math.max(25, 55 - idx * 12);
    }

    let reason = `${official.name} belongs to ${official.divisionName}.`;
    if (matchedKeywords.length > 0) {
      reason = `${official.name} is an expert in ${matchedKeywords.join(', ')} (${official.divisionName}), matching the exact query requirements.`;
    } else if (divisionMatch) {
      reason = `${official.divisionName} handles queries in this category, making ${official.name} a suitable candidate.`;
    } else {
      reason = `${official.name} (${official.divisionName}) is available for technical assignment.`;
    }

    return {
      userId: official.userId,
      name: official.name,
      email: official.email,
      divisionId: official.divisionId,
      divisionName: official.divisionName,
      matchPercent,
      reason,
      matchedKeywords,
      expertise: official.expertise,
      aiGenerated: false,
    };
  });

  return scored
    .sort((a, b) => b.matchPercent - a.matchPercent || b.matchedKeywords.length - a.matchedKeywords.length)
    .slice(0, 3)
    .map((rec, idx) => ({
      ...rec,
      rank: idx + 1,
    }));
}

/**
 * Recommend Top 3 IPC Officials using Gemma AI LLM domain analysis
 */
export async function recommendOfficial({ subject = '', body = '', summaryText = '' }) {
  const fallbackRecs = generateFallbackRecommendations({ subject, body, summaryText });

  if (!env.GEMMA_API_URL) {
    return fallbackRecs;
  }

  const prompt = `You are an expert AI Assignment Officer for the Indian Pharmacopoeia Commission (IPC), Ministry of Health & Family Welfare.
Your task is to analyze the following incoming enquiry and recommend the Top 3 best-qualified IPC Officials from the directory to handle this enquiry.

IPC OFFICIALS DIRECTORY:
1. USR-0004: Neha Singh | Division: Analytical & Quality Control | Expertise: assay, dissolution, impurity, method validation, chromatography, hplc
2. USR-0010: Meera Iyer | Division: Pharmacopoeial Standards | Expertise: monograph, reference standard, pharmacopoeia, specification, iprs
3. USR-0011: Arjun Nair | Division: Microbiology | Expertise: sterility, endotoxin, microbial limits, bioburden, contamination, lal
4. USR-0012: Sana Qureshi | Division: Pharmaceutical Chemistry | Expertise: synthesis, degradation, stability, excipient, formulation, api
5. USR-0013: Vikram Desai | Division: Regulatory Affairs & Compliance | Expertise: submission, documentation, regulatory, guideline, compliance, dossier
6. USR-0009: Rawat Jatin | Division: Technical Operations | Expertise: instrumentation, calibration, laboratory operations, equipment, glp

Enquiry Subject: "${subject.trim() || 'Untitled Enquiry'}"
Enquiry Summary: "${summaryText.trim() || ''}"
Enquiry Body:
"""
${body.trim() || ''}
"""

STRICT RULES:
1. Recommend strictly the TOP 3 IPC Officials ranked by highest match percentage (e.g. 94%, 82%, 70%).
2. Output strictly valid JSON with this structure:
{
  "recommendations": [
    {
      "userId": "USR-0004",
      "matchPercent": 94,
      "reason": "Clear professional explanation why Neha Singh is the best fit for this query based on her expertise in dissolution and quality control in DIV-005.",
      "matchedKeywords": ["dissolution", "assay"]
    },
    {
      "userId": "USR-0010",
      "matchPercent": 78,
      "reason": "Explanation for second recommendation...",
      "matchedKeywords": ["monograph"]
    },
    {
      "userId": "USR-0012",
      "matchPercent": 65,
      "reason": "Explanation for third recommendation...",
      "matchedKeywords": []
    }
  ]
}
3. Return ONLY the JSON object. Do NOT wrap in markdown or text outside JSON.

IPC AI Recommendations:`;

  const timeoutDuration = env.NODE_ENV === 'test' ? 500 : (env.GEMMA_TIMEOUT_MS || 12000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

  try {
    console.log(`[Gemma AI Recommendation] Calling Gemma LLM at ${env.GEMMA_API_URL}...`);
    const response = await fetch(env.GEMMA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return fallbackRecs;
    }

    const data = await response.json();
    const rawAnswer = data?.answer || data?.response || data?.text || null;

    if (rawAnswer) {
      const cleaned = cleanApiResponse(rawAnswer);
      try {
        const parsed = JSON.parse(cleaned);
        if (parsed && Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0) {
          const formatted = parsed.recommendations.slice(0, 3).map((item, idx) => {
            const officialMeta = ASSIGNED_OFFICIALS.find((o) => o.userId === item.userId) || ASSIGNED_OFFICIALS[idx];
            return {
              rank: idx + 1,
              userId: officialMeta.userId,
              name: officialMeta.name,
              email: officialMeta.email,
              divisionId: officialMeta.divisionId,
              divisionName: officialMeta.divisionName,
              matchPercent: Math.min(98, Math.max(50, item.matchPercent || 80 - idx * 12)),
              reason: item.reason || `${officialMeta.name} is recommended for this enquiry.`,
              matchedKeywords: Array.isArray(item.matchedKeywords) ? item.matchedKeywords : [],
              expertise: officialMeta.expertise,
              aiGenerated: true,
            };
          });
          console.log('[Gemma AI Recommendation Generated Successfully]');
          return formatted;
        }
      } catch (_) {}
    }

    return fallbackRecs;
  } catch (error) {
    clearTimeout(timeoutId);
    return fallbackRecs;
  }
}

export const gemmaService = { generateSummary, recommendOfficial };
export default gemmaService;
