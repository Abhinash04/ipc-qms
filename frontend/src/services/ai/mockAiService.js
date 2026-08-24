import { MOCK_USERS } from '@/constants/mockUsers';
import { findDivisionById } from '@/constants/mockDivisions';
import { ROLES } from '@/constants/roles';

const TOPIC_DIVISIONS = {
  'monograph': 'DIV-003',
  'impurity': 'DIV-003',
  'analytical': 'DIV-003',
  'reference standard': 'DIV-003',
  'specification': 'DIV-003',
  'dissolution': 'DIV-003',
  'assay': 'DIV-003',
  'stability': 'DIV-003',
  'documentation': 'DIV-002',
  'submission': 'DIV-002',
  'compliance': 'DIV-002',
  'regulatory': 'DIV-002',
  'application form': 'DIV-002',
  'guideline': 'DIV-002',
  'training': 'DIV-001',
  'workshop': 'DIV-001',
  'certificate': 'DIV-004',
  'invoice': 'DIV-004',
  'payment': 'DIV-004',
};

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'would', 'like', 'please',
  'dear', 'sir', 'madam', 'regards', 'thank', 'you', 'your', 'our', 'are', 'was',
  'have', 'has', 'been', 'their', 'about', 'also', 'any', 'may', 'can', 'will',
  'shall', 'should', 'while', 'which', 'whether', 'regarding', 'seek', 'writing',
]);

function textOf(query) {
  return `${query?.subject || ''} ${query?.description || ''}`.toLowerCase();
}

export function detectTopics(query) {
  const text = textOf(query);
  return Object.keys(TOPIC_DIVISIONS)
    .filter((topic) => text.includes(topic))
    .sort((a, b) => text.indexOf(a) - text.indexOf(b));
}

export function extractKeyPoints(query, limit = 5) {
  const body = String(query?.description || '');

  const listed = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(\d+[.)]|[-*•])\s+/.test(line))
    .map((line) => line.replace(/^(\d+[.)]|[-*•])\s+/, '').replace(/[.\s]+$/, ''));

  if (listed.length > 0) return listed.slice(0, limit);

  return body
    .split(/(?<=[.?!])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 25 && !/^(dear|regards|thank)/i.test(sentence))
    .slice(0, limit);
}

function significantWords(query, limit = 6) {
  const counts = new Map();
  for (const word of textOf(query).match(/[a-z][a-z-]{3,}/g) || []) {
    if (STOP_WORDS.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

export function summarise(query) {
  if (!query) return { text: '', keyPoints: [], topics: [] };

  const topics = detectTopics(query);
  const keyPoints = extractKeyPoints(query);
  const words = significantWords(query);
  const inquirer = query.inquirer?.name || 'the inquirer';

  const subjectLine = query.subject ? `“${query.subject}”` : 'an untitled enquiry';
  const topicPhrase = topics.length
    ? `It concerns ${topics.slice(0, 3).join(', ')}.`
    : `Recurring terms: ${words.slice(0, 4).join(', ')}.`;
  const pointsPhrase = keyPoints.length
    ? ` ${keyPoints.length} specific point${keyPoints.length === 1 ? '' : 's'} raised.`
    : '';

  return {
    text: `${inquirer} asks about ${subjectLine}. ${topicPhrase}${pointsPhrase}`,
    keyPoints,
    topics,
  };
}
function expertiseMatch(user, text) {
  const matched = (user.expertise || []).filter((skill) => text.includes(skill.toLowerCase()));
  return { matched, score: matched.length };
}

export function recommendAssignee(query, users = MOCK_USERS, openQueries = []) {
  const eligible = users.filter((user) => user.role === ROLES.ASSIGNED_OFFICIAL);
  if (eligible.length === 0) return null;

  const text = textOf(query);
  const topics = detectTopics(query);
  const wantedDivisions = new Set(topics.map((topic) => TOPIC_DIVISIONS[topic]));

  const workload = (userId) => openQueries.filter((q) => q.currentAssigneeId === userId).length;
  const maxWorkload = Math.max(1, ...eligible.map((user) => workload(user.id)));

  const scored = eligible
    .map((user) => {
      const divisionMatch = wantedDivisions.has(user.divisionId);
      const expertise = expertiseMatch(user, text);
      const score =
        Math.min(60, expertise.score * 20) +
        (divisionMatch ? 25 : 0) +
        Math.round((1 - workload(user.id) / maxWorkload) * 10) +
        5;

      return { user, divisionMatch, expertise, load: workload(user.id), score };
    })
    .sort((a, b) => b.score - a.score || a.user.id.localeCompare(b.user.id));

  const best = scored[0];
  const division = findDivisionById(best.user.divisionId);
  const plural = best.load === 1 ? 'query' : 'queries';

  let reason;
  if (best.expertise.score > 0) {
    reason = `${best.user.name} works on ${best.expertise.matched.slice(0, 3).join(', ')}, which this enquiry asks about, and currently holds ${best.load} open ${plural}.`;
  } else if (best.divisionMatch) {
    reason = `${division?.name || 'Their division'} handles ${topics.slice(0, 2).join(' and ')}, and ${best.user.name} currently holds ${best.load} open ${plural}.`;
  } else {
    reason = `No official is a clear subject-matter match for this enquiry, so ${best.user.name} is suggested on availability alone (${best.load} open ${plural}).`;
  }

  return {
    userId: best.user.id,
    matchPercent: Math.min(99, best.score),
    reason,
    factors: [
      best.expertise.score
        ? `Expertise matched: ${best.expertise.matched.join(', ')}`
        : 'No declared expertise matched the wording',
      topics.length ? `Topics detected: ${topics.slice(0, 3).join(', ')}` : 'No known topic matched',
      `Division: ${division?.name || 'unassigned'}`,
      `Current workload: ${best.load} open`,
      'Recommendation only — the Officer-in-Charge decides',
    ],
  };
}

export function recommendTopOfficials(query, users = MOCK_USERS, openQueries = []) {
  const eligible = users.filter((user) => user.role === ROLES.ASSIGNED_OFFICIAL);
  if (eligible.length === 0) return [];

  const text = textOf(query);
  const topics = detectTopics(query);
  const wantedDivisions = new Set(topics.map((topic) => TOPIC_DIVISIONS[topic]));

  const workload = (userId) => openQueries.filter((q) => q.currentAssigneeId === userId).length;

  const scored = eligible
    .map((user, idx) => {
      const divisionMatch = wantedDivisions.has(user.divisionId);
      const expertise = expertiseMatch(user, text);
      const division = findDivisionById(user.divisionId);
      const load = workload(user.id);
      const plural = load === 1 ? 'query' : 'queries';

      let matchPercent;
      if (expertise.score > 0) {
        matchPercent = Math.min(98, 70 + (expertise.score - 1) * 12 + (divisionMatch ? 10 : 0));
      } else if (divisionMatch) {
        matchPercent = 65;
      } else {
        matchPercent = Math.max(25, 55 - idx * 12);
      }

      let reason;
      if (expertise.score > 0) {
        reason = `${user.name} specializes in ${expertise.matched.join(', ')} (${division?.name || 'Technical Division'}), matching this enquiry. Holds ${load} open ${plural}.`;
      } else if (divisionMatch) {
        reason = `${division?.name || 'Their division'} handles topics like ${topics.slice(0, 2).join(' & ')}. Holds ${load} open ${plural}.`;
      } else {
        reason = `Suggested based on division capacity (${division?.name || 'Technical'}) and workload (${load} open ${plural}).`;
      }

      return {
        userId: user.id,
        name: user.name,
        email: user.email,
        divisionId: user.divisionId,
        divisionName: division?.name || 'Technical Division',
        matchPercent,
        reason,
        matchedKeywords: expertise.matched,
        expertise: user.expertise || [],
      };
    })
    .sort((a, b) => b.matchPercent - a.matchPercent || a.userId.localeCompare(b.userId));

  return scored.slice(0, 3).map((rec, idx) => ({
    ...rec,
    rank: idx + 1,
  }));
}

const SIGNATURE = `Regards,
AR&D Division
Indian Pharmacopoeia Commission (IPC)
Ministry of Health & Family Welfare
Government of India`;

export function draftResponse(query) {
  if (!query) return '';

  const keyPoints = extractKeyPoints(query);
  const topics = detectTopics(query);
  const inquirer = query.inquirer?.name || 'Sir/Madam';

  const pointBlock = keyPoints.length
    ? keyPoints
        .map((point, index) => `${index + 1}. ${point}\n   [Response required — refer to the applicable IPC guidance.]`)
        .join('\n\n')
    : '[Response required — the enquiry raises no itemised points; summarise the position here.]';

  const topicLine = topics.length
    ? `Your enquiry has been reviewed by the division responsible for ${topics.slice(0, 3).join(', ')}.`
    : 'Your enquiry has been reviewed by the concerned division.';

  return `[AI-GENERATED FIRST DRAFT — requires review and editing by the assigned official before it can proceed.]

Dear ${inquirer},

Thank you for your enquiry dated ${new Date(query.createdAt).toLocaleDateString()} regarding "${query.subject}".

${topicLine} Our response to the points you raised follows.

${pointBlock}

Should you require any further clarification, please write back quoting reference ${query.queryId}.

${SIGNATURE}`;
}

export const mockAiService = { summarise, recommendAssignee, draftResponse, detectTopics, extractKeyPoints };
