import env from '../../config/env.js';
import { ASSIGNED_OFFICIALS } from '../../config/officialsMetadata.js';
import { selectContext, formatContextForPrompt } from '../../data/ipcContextBrain.js';
import { retrieveContext, formatPassagesForPrompt } from '../../data/ipcKnowledge.js';
import { splitEnquiryQuestions } from '../../data/enquiryQuestions.js';


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

function generateFallbackRecommendations({ subject = '', body = '', summaryText = '' }) {
  const fullText = `${subject} ${body} ${summaryText}`.toLowerCase();

  const scored = ASSIGNED_OFFICIALS.map((official, idx) => {
    const matchedKeywords = official.expertise.filter((skill) => fullText.includes(skill.toLowerCase()));
    const divisionMatch = fullText.includes(official.divisionName.toLowerCase());

    let matchPercent;
    if (matchedKeywords.length > 0) {
      matchPercent = Math.min(98, 70 + (matchedKeywords.length - 1) * 12 + (divisionMatch ? 10 : 0));
    } else if (divisionMatch) {
      matchPercent = 65;
    } else {
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

export const SUFFICIENCY = {
  ANSWERED: 'ANSWERED',
  PARTIAL: 'PARTIAL',
  NOT_ESTABLISHED: 'NOT_ESTABLISHED',
};

const PASSAGES_PER_QUESTION = 5;

async function askGemma(prompt, { timeoutMs, label }) {
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
      console.warn(`[Gemma AI] ${label} returned status ${response.status}. Using fallback.`);
      return null;
    }

    const data = await response.json();
    return data?.answer || data?.response || data?.text || null;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.warn(`[Gemma AI] ${label} timed out after ${timeoutMs}ms. Using fallback.`);
    } else {
      console.warn(`[Gemma AI] ${label} failed: ${error.message}. Using fallback.`);
    }
    return null;
  }
}

const flatten = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

function restoreContext(questions, deterministic) {
  if (deterministic.length === 0) return questions;

  return questions.map((question) => {
    const needle = flatten(question);
    const richer = deterministic.find(
      (candidate) => flatten(candidate).includes(needle) && candidate.length > question.length,
    );
    return richer || question;
  });
}

export async function decomposeEnquiry({ subject = '', body = '' }) {
  const deterministic = splitEnquiryQuestions(body);

  if (!env.GEMMA_API_URL) return deterministic;

  const prompt = `You are analysing an enquiry sent to the Indian Pharmacopoeia Commission (IPC).

Split it into the distinct questions the sender is asking, so each can be researched separately.

RULES:
1. One entry per distinct thing the sender wants to know.
2. Preserve the sender's own wording. Do not rephrase into your own words, do not summarise, do not merge two questions into one.
3. A request phrased as a statement is still a question — for example "We would be grateful for direction on whether X" is a question about X.
4. Ignore greetings, sign-offs, names and job titles.
5. Do NOT answer anything. Do NOT add questions the sender did not ask.
6. Output strictly valid JSON: {"questions": ["first question", "second question"]}
7. Return ONLY the JSON object, with no markdown wrapper and no commentary.

Enquiry subject: "${fenceSafe(subject, 300) || 'Untitled Enquiry'}"
Enquiry body:
"""
${fenceSafe(body) || 'No body content provided.'}
"""

Questions JSON:`;

  const raw = await askGemma(prompt, {
    timeoutMs: env.GEMMA_TIMEOUT_MS,
    label: 'Enquiry decomposition',
  });
  if (!raw) return deterministic;

  try {
    const parsed = JSON.parse(cleanApiResponse(raw));
    const questions = Array.isArray(parsed?.questions)
      ? parsed.questions.map((q) => String(q).trim()).filter((q) => q.length > 10)
      : [];
    if (questions.length > 0) return restoreContext(questions, deterministic);
  } catch {
    console.warn('[Gemma AI] Could not parse the decomposition reply. Using the deterministic split.');
  }

  return deterministic;
}

function gatherEvidence(questions, subject = '') {
  return questions.map((question, index) => {
    const anchored = `${subject} ${question}`.trim();
    const glossary = selectContext(anchored);
    const passages = retrieveContext(anchored, { limit: PASSAGES_PER_QUESTION });
    return {
      number: index + 1,
      question,
      glossary,
      passages,
      sources: [...glossary.map((e) => e.id), ...passages.map((p) => p.id)],
    };
  });
}

function generateFallbackDraft({ subject = '', evidence = [], contextUsed = [] }) {
  const cleanSubject = subject.trim() || 'your enquiry';

  return {
    subject: `Response regarding ${cleanSubject}`,
    answers: evidence.map((item) => ({
      question: item.number,
      questionText: item.question,
      sufficiency: SUFFICIENCY.NOT_ESTABLISHED,
      paragraphs: [],
      notEstablished: '',
      sources: [],
    })),
    termsUsed: [],
    contextUsed,
    aiGenerated: false,
    fallback: true,
  };
}

function normaliseSufficiency(value, paragraphs) {
  const upper = String(value || '').toUpperCase();
  if (SUFFICIENCY[upper]) return upper;
  return paragraphs.length > 0 ? SUFFICIENCY.PARTIAL : SUFFICIENCY.NOT_ESTABLISHED;
}

function parseDraftJson(jsonStr, { subject, evidence, contextUsed }) {
  try {
    const parsed = JSON.parse(jsonStr);
    const rawAnswers = Array.isArray(parsed?.answers) ? parsed.answers : [];
    if (rawAnswers.length === 0) return null;

    const answers = evidence.map((item) => {
      const match =
        rawAnswers.find((a) => Number(a?.question) === item.number) ||
        rawAnswers[item.number - 1] ||
        null;

      const paragraphs = Array.isArray(match?.paragraphs)
        ? match.paragraphs.map((p) => String(p).trim()).filter(Boolean)
        : [];

      const sufficiency = normaliseSufficiency(match?.sufficiency, paragraphs);
      const claimed = Array.isArray(match?.sources)
        ? match.sources.map((s) => String(s).trim()).filter(Boolean)
        : [];
      const verified = claimed.filter((id) => item.sources.includes(id));
      const passageIds = item.passages.map((p) => p.id);

      const notEstablished =
        typeof match?.notEstablished === 'string' ? match.notEstablished.trim() : '';

      return {
        question: item.number,
        questionText: item.question,
        sufficiency,
        paragraphs: sufficiency === SUFFICIENCY.NOT_ESTABLISHED ? [] : paragraphs,
        notEstablished: sufficiency === SUFFICIENCY.ANSWERED ? '' : notEstablished,
        sources:
          sufficiency === SUFFICIENCY.NOT_ESTABLISHED
            ? []
            : (verified.length > 0 ? verified : passageIds),
      };
    });

    if (answers.every((a) => a.paragraphs.length === 0 && a.sufficiency !== SUFFICIENCY.NOT_ESTABLISHED)) {
      return null;
    }

    return {
      subject:
        typeof parsed.subject === 'string' && parsed.subject.trim()
          ? parsed.subject.trim()
          : `Response regarding ${subject.trim() || 'your enquiry'}`,
      answers,
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
  const questions = await decomposeEnquiry({ subject, body });
  const evidence = gatherEvidence(
    questions.length > 0 ? questions : [`${subject} ${body}`.trim() || 'the enquiry'],
    subject,
  );
  const contextUsed = [...new Set(evidence.flatMap((item) => item.sources))];
  const fallback = generateFallbackDraft({ subject, evidence, contextUsed });

  if (!env.GEMMA_API_URL) {
    console.warn('[Gemma AI] GEMMA_API_URL is not configured. Returning fallback draft.');
    return fallback;
  }

  const pointsBlock = Array.isArray(keyPoints) && keyPoints.length
    ? keyPoints.map((point) => `- ${String(point).trim()}`).join('\n')
    : '- No key points were extracted.';

  const questionBlocks = evidence
    .map(
      (item) => `QUESTION ${item.number}
${fenceSafe(item.question, 800)}

  IPC GLOSSARY FOR QUESTION ${item.number}
${formatContextForPrompt(item.glossary)}

  IPC REFERENCE PASSAGES FOR QUESTION ${item.number}
${formatPassagesForPrompt(item.passages)}`,
    )
    .join('\n\n────────────────\n\n');

  const prompt = `You are an expert AI Assistant drafting an official reply on behalf of the Indian Pharmacopoeia Commission (IPC), Ministry of Health & Family Welfare, Government of India.

Your task is to draft the body of a professional reply email. The enquiry has been split into ${evidence.length} question(s), and each question has been given its OWN evidence. Answer each question separately, using only the evidence supplied for that question.

RULES:
1. Answer each question ONLY from the evidence given under that question, plus the ORIGINAL ENQUIRY and the AI QUERY SUMMARY.
2. Do NOT invent drug names, monograph numbers, thresholds, batch numbers, regulations, standards, dates, references or citations. If a fact is not in the material below, it does not exist for this reply.
3. For every question set "sufficiency":
   - "ANSWERED" — the evidence fully settles the question.
   - "PARTIAL" — the evidence says something on the same subject matter but does not settle every part. Summarise what the IPC material DOES establish, then state plainly which part of the question it does not settle.
   - "NOT_ESTABLISHED" — no supplied passage touches the subject matter at all.
   Never answer a question from general knowledge. Never leave a question silent.
4. "PARTIAL" is the expected outcome whenever any supplied passage is on the same subject matter, even if it does not answer the precise point asked. A question about a degradation product or an impurity is on the same subject matter as guidance about related substances, impurity limits or reference standards — summarise that guidance, then say what remains unsettled. Reserve "NOT_ESTABLISHED" for questions where every supplied passage is about something else entirely.
5. When "sufficiency" is "PARTIAL" you MUST write at least one paragraph AND you MUST fill "notEstablished" with one sentence naming the specific part of the question the supplied material does not settle. An empty paragraph list is only valid for "NOT_ESTABLISHED".
6. Be concise and specific. No filler, no generic explanation of what IPC is, no restating the enquiry back.
7. Use the IPC GLOSSARY terminology correctly. An entry marked UNVERIFIED must not be presented as authoritative.
8. A passage marked AMENDMENT is a correction to a published monograph, never the complete requirement. If you rely on one, state the amendment list and page and say the base monograph still applies.
9. Do NOT write a greeting, a salutation, a sign-off, a signature, a designation or any person's name. Those are added by the system. Write body paragraphs only.
10. In "sources" list only the bracketed passage identifiers you actually relied on for that question.
11. Output strictly valid JSON with this structure:
{
  "subject": "Response regarding <short restatement of the enquiry subject>",
  "answers": [
    { "question": 1, "sufficiency": "PARTIAL", "paragraphs": ["..."], "notEstablished": "The supplied material does not settle <the specific point>.", "sources": ["GD-10#37"] }
  ],
  "termsUsed": ["IPC glossary terms or document references you actually relied on"]
}
12. Return ONLY the JSON object. No markdown wrappers, no commentary outside the JSON.

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

════════ EVIDENCE, PER QUESTION ════════

${questionBlocks}

IPC JSON Draft:`;

  const rawAnswer = await askGemma(prompt, {
    timeoutMs: env.GEMMA_TIMEOUT_MS * DRAFT_TIMEOUT_FACTOR,
    label: 'Draft',
  });

  if (rawAnswer) {
    const parsed = parseDraftJson(cleanApiResponse(rawAnswer), { subject, evidence, contextUsed });
    if (parsed) return parsed;
    console.warn('[Gemma AI] Could not parse the draft reply. Using fallback.');
  }

  return fallback;
}

export const gemmaService = {
  generateSummary,
  recommendOfficial,
  generateDraft,
  decomposeEnquiry,
};
export default gemmaService;
