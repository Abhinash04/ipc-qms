export const IPC_SIGNATURE = `Thanks & regards,
O/o Secretary-cum-Scientific Director
Indian Pharmacopoeia Commission
Ghaziabad`;

export const IPC_DISCLAIMER =
  'This response is being provided for informational purposes only with respect to specific query on the subject. ' +
  'This shall not be treated as an official interpretation of Indian Pharmacopoeia (IP) standard or relied on to ' +
  'demonstrate compliance with IP requirements.';

export const DRAFT_SALUTATION = 'Dear Sir/Madam,';

export const NOT_ESTABLISHED_SENTENCE =
  'The available IPC material does not establish this requirement.';

const LETTER_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function formatLetterDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(LETTER_DATE.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.day}.${parts.month}.${parts.year}`;
}

export function referenceSentence(receivedAt) {
  const date = formatLetterDate(receivedAt);
  return date
    ? `This is in reference to your email dated ${date} on the subject matter cited above.`
    : 'This is in reference to your email on the subject matter cited above.';
}

const heading = (answer, index) => {
  const topic = String(answer.topic || '').replace(/\s+/g, ' ').trim();
  return `${index + 1}. ${topic || `Question ${index + 1}`}`;
};

function answerParagraphs(answer) {
  const paragraphs = Array.isArray(answer.paragraphs)
    ? answer.paragraphs.map((p) => String(p).trim()).filter(Boolean)
    : [];

  if (answer.sufficiency === 'NOT_ESTABLISHED' || paragraphs.length === 0) {
    return [NOT_ESTABLISHED_SENTENCE];
  }

  const gap = String(answer.notEstablished || '').trim();
  return answer.sufficiency !== 'ANSWERED' && gap ? [...paragraphs, gap] : paragraphs;
}

function renderAnswers(answers) {
  return answers.map((answer, index) => [heading(answer, index), ...answerParagraphs(answer)].join('\n\n'));
}

export function assembleDraftEmail({ query, draft }) {
  if (!query || !draft) return '';

  const answers = Array.isArray(draft.answers)
    ? draft.answers.filter((a) => a && (a.questionText || a.sufficiency || a.paragraphs))
    : [];

  const flat = Array.isArray(draft.paragraphs)
    ? draft.paragraphs.map((p) => String(p).trim()).filter(Boolean)
    : [];

  const reference = referenceSentence(query.createdAt);
  let body;
  if (answers.length > 1) {
    body = [reference, ...renderAnswers(answers)];
  } else {
    const paragraphs = answers.length === 1 ? answerParagraphs(answers[0]) : flat;
    if (paragraphs.length === 0) return '';
    body = [`${reference} ${paragraphs[0]}`, ...paragraphs.slice(1)];
  }

  return [
    DRAFT_SALUTATION,
    ...body,
    IPC_DISCLAIMER,
    IPC_SIGNATURE,
  ].join('\n\n');
}
