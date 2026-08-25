const GREETING = /^(dear|hi|hello|respected)\b/i;
const SIGN_OFF = /^(regards|thanks|thank you|sincerely|yours|best regards|warm regards)\b/i;

const REQUEST_PHRASES = [
  'grateful for',
  'would like to know',
  'would like guidance',
  'please advise',
  'please clarify',
  'please confirm',
  'seek clarification',
  'seeking clarification',
  'kindly clarify',
  'kindly confirm',
  'we request',
  'request you to',
  'direction on',
  'guidance on',
  'clarification on',
];

const isRequest = (sentence) => {
  const lower = sentence.toLowerCase();
  return sentence.includes('?') || REQUEST_PHRASES.some((phrase) => lower.includes(phrase));
};

function bodyParagraphs(body) {
  const paragraphs = [];

  for (const raw of String(body || '').split(/\r?\n\s*\r?\n/)) {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) continue;
    if (SIGN_OFF.test(lines[0])) break;
    if (GREETING.test(lines[0]) && lines.length === 1) continue;

    paragraphs.push(lines.join(' '));
  }

  return paragraphs;
}

export function splitEnquiryQuestions(body) {
  const paragraphs = bodyParagraphs(body);
  if (paragraphs.length === 0) return [];

  const numbered = [];
  const unnumbered = [];
  let lastNumberedIndex = -1;

  paragraphs.forEach((paragraph, index) => {
    const marker = /^(\d+)[.)]\s+(.*)$/.exec(paragraph);
    if (marker) {
      numbered.push(marker[2].trim());
      lastNumberedIndex = index;
    } else {
      unnumbered.push({ text: paragraph, index });
    }
  });

  const trailing =
    numbered.length > 0
      ? unnumbered.filter((entry) => entry.index > lastNumberedIndex)
      : unnumbered;

  const extra = trailing
    .flatMap((entry) => entry.text.split(/(?<=[.?!])\s+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 25 && isRequest(sentence));

  const combined = [...numbered, ...extra];
  if (combined.length > 0) return combined;

  const whole = paragraphs.join(' ').trim();
  return whole ? [whole] : [];
}
