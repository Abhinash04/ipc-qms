export const IPC_SIGNATURE = `Regards,
AR&D Division
Indian Pharmacopoeia Commission (IPC)
Ministry of Health & Family Welfare
Government of India`;

export function assembleDraftEmail({ query, draft }) {
  if (!query || !draft) return '';

  const paragraphs = Array.isArray(draft.paragraphs)
    ? draft.paragraphs.map((p) => String(p).trim()).filter(Boolean)
    : [];
  if (paragraphs.length === 0) return '';

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
    ...paragraphs,
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
