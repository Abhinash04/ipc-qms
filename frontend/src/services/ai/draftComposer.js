export const IPC_SIGNATURE = `Regards,
AR&D Division
Indian Pharmacopoeia Commission (IPC)
Ministry of Health & Family Welfare
Government of India`;

export const NOT_ESTABLISHED_SENTENCE =
  'The available IPC material does not establish this requirement.';

const heading = (answer, index) => {
  const topic = String(answer.topic || '').replace(/\s+/g, ' ').trim();
  return `${index + 1}. ${topic || `Question ${index + 1}`}`;
};

function renderAnswers(answers) {
  return answers.map((answer, index) => {
    const paragraphs = Array.isArray(answer.paragraphs)
      ? answer.paragraphs.map((p) => String(p).trim()).filter(Boolean)
      : [];

    const lines = [heading(answer, index)];

    if (answer.sufficiency === 'NOT_ESTABLISHED' || paragraphs.length === 0) {
      lines.push(NOT_ESTABLISHED_SENTENCE);
      return lines.join('\n\n');
    }

    lines.push(...paragraphs);

    const gap = String(answer.notEstablished || '').trim();
    if (answer.sufficiency !== 'ANSWERED' && gap) lines.push(gap);

    return lines.join('\n\n');
  });
}

export function assembleDraftEmail({ query, draft }) {
  if (!query || !draft) return '';

  const answers = Array.isArray(draft.answers)
    ? draft.answers.filter((a) => a && (a.questionText || a.sufficiency || a.paragraphs))
    : [];

  const flat = Array.isArray(draft.paragraphs)
    ? draft.paragraphs.map((p) => String(p).trim()).filter(Boolean)
    : [];

  const sections = answers.length > 0 ? renderAnswers(answers) : flat;
  if (sections.length === 0) return '';

  const subject =
    typeof draft.subject === 'string' && draft.subject.trim()
      ? draft.subject.trim()
      : `Response regarding ${query.subject || 'your enquiry'}`;

  const recipient = query.inquirer?.name || 'Sir/Madam';

  const blocks = [
    '[AI-GENERATED FIRST DRAFT — requires review and editing by the assigned official before it can proceed.]',
    `Subject: ${subject}`,
    `Dear ${recipient},`,
    ...sections,
  ];

  blocks.push(
    `Should you require any further clarification, please write back quoting reference ${query.queryId}.`,
    IPC_SIGNATURE,
  );

  return blocks.join('\n\n');
}
