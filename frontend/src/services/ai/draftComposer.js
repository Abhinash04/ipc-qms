export const IPC_SIGNATURE = `Regards,
AR&D Division
Indian Pharmacopoeia Commission (IPC)
Ministry of Health & Family Welfare
Government of India`;

export const NOT_ESTABLISHED_SENTENCE =
  'The available IPC material does not establish an answer to this question. It requires assessment against the applicable monograph and the relevant regulatory requirements.';

export const PARTIAL_GAP_SENTENCE =
  'The available IPC material does not settle the remainder of this question, which requires assessment against the applicable monograph and the relevant regulatory requirements.';

const headline = (text) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= 110) return clean;
  return `${clean.slice(0, 107).trimEnd()}…`;
};

function renderAnswers(answers) {
  return answers.map((answer, index) => {
    const paragraphs = Array.isArray(answer.paragraphs)
      ? answer.paragraphs.map((p) => String(p).trim()).filter(Boolean)
      : [];
    const sources = Array.isArray(answer.sources)
      ? answer.sources.map((s) => String(s).trim()).filter(Boolean)
      : [];

    const lines = [`${index + 1}. ${headline(answer.questionText) || `Question ${index + 1}`}`];

    if (answer.sufficiency === 'NOT_ESTABLISHED' || paragraphs.length === 0) {
      lines.push(NOT_ESTABLISHED_SENTENCE);
    } else {
      lines.push(...paragraphs);

      if (answer.sufficiency !== 'ANSWERED') {
        const gap = String(answer.notEstablished || '').trim();
        lines.push(gap || PARTIAL_GAP_SENTENCE);
      }

      if (sources.length > 0) lines.push(`Sources: ${sources.join('; ')}`);
    }

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

  const unanswered = Array.isArray(draft.unanswered)
    ? draft.unanswered.map((u) => String(u).trim()).filter(Boolean)
    : [];

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

  if (unanswered.length > 0) {
    blocks.push(
      'The following could not be answered from the information supplied and requires input before this response is sent:',
      unanswered.map((item, index) => `${index + 1}. ${item}`).join('\n'),
    );
  }

  blocks.push(
    `Should you require any further clarification, please write back quoting reference ${query.queryId}.`,
    IPC_SIGNATURE,
  );

  return blocks.join('\n\n');
}
