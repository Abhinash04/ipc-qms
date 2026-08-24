import env from '../../config/env.js';
import { ASSIGNED_OFFICIALS } from '../../config/officialsMetadata.js';
import { selectContext, formatContextForPrompt } from '../../data/ipcContextBrain.js';
import { retrieveContext, formatPassagesForPrompt } from '../../data/ipcKnowledge.js';


/**
 * The recommendation prompt carries the whole official roster, so it is far
 * heavier than the summary prompt. Measured against the live endpoint:
 * summaries answer in ~5s, recommendations in 6–12s — straddling a 12s ceiling,
 * which made the model reachable only intermittently.
 *
 * The summary keeps GEMMA_TIMEOUT_MS because it is awaited inside the automatic
 * intake chain, where the wait delays a real forward. The recommendation
 * renders in a card and blocks no workflow step, so it can afford to wait
 * longer rather than silently degrade to the rule-based scorer.
 */
const RECOMMENDATION_TIMEOUT_FACTOR = 3;

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
  } catch {
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.GEMMA_TIMEOUT_MS);

  try {
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

    let matchPercent;
    if (matchedKeywords.length > 0) {
      // Strong keyword match: 70% base + 12% per additional keyword + division match
      matchPercent = Math.min(98, 70 + (matchedKeywords.length - 1) * 12 + (divisionMatch ? 10 : 0));
    } else if (divisionMatch) {
      matchPercent = 65;
    } else {
      // Dynamic differentiation when no direct technical keyword matches (e.g., 55%, 42%, 30%)
      matchPercent = Math.max(25, 55 - idx * 12);
    }

    let reason;
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

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    env.GEMMA_TIMEOUT_MS * RECOMMENDATION_TIMEOUT_FACTOR,
  );

  try {
    const response = await fetch(env.GEMMA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Gemma AI] Recommendation API returned ${response.status}. Using fallback.`);
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
          return formatted;
        }
      } catch {
        // Model replied with something that is not the expected JSON.
        console.warn('[Gemma AI] Could not parse the recommendation reply. Using fallback.');
      }
    }

    return fallbackRecs;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.warn(
        `[Gemma AI] Recommendation timed out after ` +
          `${env.GEMMA_TIMEOUT_MS * RECOMMENDATION_TIMEOUT_FACTOR}ms. Using fallback.`,
      );
    } else {
      console.warn(`[Gemma AI] Recommendation call failed: ${error.message}. Using fallback.`);
    }
    return fallbackRecs;
  }
}

const DRAFT_TIMEOUT_FACTOR = 3;

const MAX_BODY_CHARS = 4000;

function fenceSafe(value, limit = MAX_BODY_CHARS) {
  return String(value || '')
    .replace(/"""/g, '"​""')
    .trim()
    .slice(0, limit);
}

function generateFallbackDraft({ subject = '', body = '', contextUsed = [] }) {
  const cleanSubject = subject.trim() || 'your enquiry';

  const bullets = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(\d+[.)]|[-*•])\s+/.test(line))
    .map((line) => line.replace(/^(\d+[.)]|[-*•])\s+/, ''));

  const sentences = body
    .split(/(?<=[.?!।])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25 && !/^(dear|regards|thank|hi|hello)/i.test(s));

  const points = bullets.length ? bullets : sentences.slice(0, 3);

  const paragraphs = [
    `Thank you for your enquiry regarding "${cleanSubject}".`,
    'Your enquiry has been received and reviewed by the concerned division. A detailed response to the points you raised follows below.',
  ];

  return {
    subject: `Response regarding ${cleanSubject}`,
    paragraphs,
    unanswered: points.length
      ? points.map((point) => `${point} — a substantive response is still required from the assigned official.`)
      : ['The enquiry raises no itemised points; the assigned official must summarise the position.'],
    termsUsed: [],
    contextUsed,
    aiGenerated: false,
    fallback: true,
  };
}

function parseDraftJson(jsonStr, { subject, contextUsed }) {
  try {
    const parsed = JSON.parse(jsonStr);
    const paragraphs = Array.isArray(parsed?.paragraphs)
      ? parsed.paragraphs.map((p) => String(p).trim()).filter(Boolean)
      : [];

    if (paragraphs.length === 0) return null;

    return {
      subject:
        typeof parsed.subject === 'string' && parsed.subject.trim()
          ? parsed.subject.trim()
          : `Response regarding ${subject.trim() || 'your enquiry'}`,
      paragraphs,
      unanswered: Array.isArray(parsed.unanswered)
        ? parsed.unanswered.map((u) => String(u).trim()).filter(Boolean)
        : [],
      termsUsed: Array.isArray(parsed.termsUsed)
        ? parsed.termsUsed.map((t) => String(t).trim()).filter(Boolean)
        : [],
      contextUsed,
      aiGenerated: true,
      fallback: false,
    };
  } catch {
    return null;
  }
}

export async function generateDraft({
  subject = '',
  body = '',
  inquirerName = '',
  summaryText = '',
  keyPoints = [],
}) {
  const retrievalText = `${subject} ${body} ${summaryText}`;
  const contextEntries = selectContext(retrievalText);
  const passages = retrieveContext(retrievalText);
  const contextUsed = [
    ...contextEntries.map((entry) => entry.id),
    ...passages.map((passage) => passage.id),
  ];
  const fallback = generateFallbackDraft({ subject, body, contextUsed });

  if (!env.GEMMA_API_URL) {
    console.warn('[Gemma AI] GEMMA_API_URL is not configured. Returning fallback draft.');
    return fallback;
  }

  const pointsBlock = Array.isArray(keyPoints) && keyPoints.length
    ? keyPoints.map((point) => `- ${String(point).trim()}`).join('\n')
    : '- No key points were extracted.';

  const prompt = `You are an expert AI Assistant drafting an official reply on behalf of the Indian Pharmacopoeia Commission (IPC), Ministry of Health & Family Welfare, Government of India.

Your task is to draft the body of a professional reply email answering the enquiry below. An IPC officer will review and edit your draft before it is sent.

RULES:
1. Answer ONLY from the ORIGINAL ENQUIRY, the AI QUERY SUMMARY, the IPC GLOSSARY and the IPC REFERENCE PASSAGES given below.
2. Do NOT invent drug names, monograph numbers, batch numbers, regulations, standards, prices, dates, references or citations. If a fact is not in the material below, it does not exist for this reply.
3. Anything the enquiry asks that the material below cannot answer must go into "unanswered" as a short plain statement of what is missing. Never guess it in a paragraph.
4. Be concise and specific. No filler, no generic explanations of what IPC is, no restating the whole enquiry back.
5. Use the IPC GLOSSARY terminology correctly where it is relevant. An entry marked UNVERIFIED must not be presented as authoritative.
6. A passage marked AMENDMENT is a correction to a published monograph, never the complete requirement. If you rely on one, state the amendment list and page and say the base monograph still applies.
7. Do NOT write a greeting, a salutation, a sign-off, a signature, a designation or any person's name. Those are added by the system. Write body paragraphs only.
8. Output strictly valid JSON with this structure:
{
  "subject": "Response regarding <short restatement of the enquiry subject>",
  "paragraphs": ["First body paragraph.", "Second body paragraph."],
  "unanswered": ["Short statement of information the enquiry needs but the material does not provide."],
  "termsUsed": ["IPC glossary terms or document references you actually relied on"]
}
9. Return ONLY the JSON object. No markdown wrappers, no commentary outside the JSON.

ORIGINAL ENQUIRY
Subject: "${fenceSafe(subject, 300) || 'Untitled Enquiry'}"
From: ${fenceSafe(inquirerName, 120) || 'the inquirer'}
Body:
"""
${fenceSafe(body) || 'No body content provided.'}
"""

AI QUERY SUMMARY
${fenceSafe(summaryText, 1000) || 'No summary available.'}
Key points:
${pointsBlock}

IPC GLOSSARY
${formatContextForPrompt(contextEntries)}

IPC REFERENCE PASSAGES
${formatPassagesForPrompt(passages)}

IPC JSON Draft:`;

  const timeoutMs = env.GEMMA_TIMEOUT_MS * DRAFT_TIMEOUT_FACTOR;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(env.GEMMA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Gemma AI] Draft API returned status ${response.status}. Using fallback.`);
      return fallback;
    }

    const data = await response.json();
    const rawAnswer = data?.answer || data?.response || data?.text || null;

    if (rawAnswer) {
      const parsed = parseDraftJson(cleanApiResponse(rawAnswer), { subject, contextUsed });
      if (parsed) {
        return parsed;
      }
    }

    console.warn('[Gemma AI] Could not parse the draft reply. Using fallback.');
    return fallback;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.warn(`[Gemma AI] Draft timed out after ${timeoutMs}ms. Using fallback.`);
    } else {
      console.warn(`[Gemma AI] Draft call failed: ${error.message}. Using fallback.`);
    }
    return fallback;
  }
}

export const gemmaService = { generateSummary, recommendOfficial, generateDraft };
export default gemmaService;
