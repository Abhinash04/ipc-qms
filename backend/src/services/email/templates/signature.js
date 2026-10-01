export const IPC_SIGNATURE = `Thanks & regards,
O/o Secretary-cum-Scientific Director
Indian Pharmacopoeia Commission
Ghaziabad`;

export const IPC_DISCLAIMER =
  'This response is being provided for informational purposes only with respect to specific query on the subject. ' +
  'This shall not be treated as an official interpretation of Indian Pharmacopoeia (IP) standard or relied on to ' +
  'demonstrate compliance with IP requirements.';

export const IPC_GREETING = 'Greetings from Indian Pharmacopoeia Commission (IPC)!';

const MADAM = /^(ms|mrs|miss|smt|kum|kumari)\.?\s+/i;
const SIR = /^(mr|shri|sh|sri)\.?\s+/i;

export function salutationFor(name) {
  const text = String(name || '').trim();
  if (MADAM.test(text)) return 'Madam,';
  if (SIR.test(text)) return 'Sir,';
  return 'Sir/Madam,';
}

export function addressBlock({ name, email, organization } = {}) {
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim();
  const lines = ['To,'];
  if (cleanName && cleanEmail && cleanName.toLowerCase() !== cleanEmail.toLowerCase()) {
    lines.push(`${cleanName} <${cleanEmail}>`);
  } else if (cleanEmail || cleanName) {
    lines.push(cleanEmail || cleanName);
  }
  const org = String(organization || '').trim();
  if (org) lines.push(/^m\/s\b/i.test(org) ? org : `M/s ${org}`);
  return lines.join('\n');
}

export function subjectLine(subject) {
  let text = String(subject || '').trim();
  while (/^(re|fwd?|fw)\s*:\s*/i.test(text)) text = text.replace(/^(re|fwd?|fw)\s*:\s*/i, '');
  text = text.replace(/\s*[-–—]\s*reg\.?\s*$/i, '').trim();
  return `Sub: ${text || 'Your query'} -reg.`;
}

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

export function letterOpening({ inquirer = {}, subject = '' } = {}) {
  return [addressBlock(inquirer), subjectLine(subject), `${salutationFor(inquirer.name)}\n${IPC_GREETING}`].join('\n\n');
}

const SIGN_OFF =
  /^((thanks|thank\s+you)\s*(&|and)\s*regards|(with\s+)?(kind|best|warm|warmest)?\s*regards|yours\s+(faithfully|sincerely|truly)|sincerely)\s*,?$/i;

const SIGN_OFF_WINDOW = 8;

const DRAFT_MARKER = /^\s*\[(?:AI-GENERATED\s+)?FIRST DRAFT[^\]]*\]\s*(?:\n|$)/i;

const squash = (text) => text.replace(/\s+/g, ' ').trim();

export function withOfficialClosing(body) {
  let text = String(body ?? '').replace(/\r\n/g, '\n').replace(DRAFT_MARKER, '').replace(/\s+$/, '');

  const lines = text.split('\n');
  let cut = lines.length;
  for (let index = lines.length - 1; index >= Math.max(0, lines.length - SIGN_OFF_WINDOW); index -= 1) {
    if (SIGN_OFF.test(lines[index].trim())) {
      cut = index;
      break;
    }
  }
  text = lines.slice(0, cut).join('\n').replace(/\s+$/, '');

  if (!squash(text).includes(squash(IPC_DISCLAIMER))) {
    text = text ? `${text}\n\n${IPC_DISCLAIMER}` : IPC_DISCLAIMER;
  }
  return `${text}\n\n${IPC_SIGNATURE}`;
}
