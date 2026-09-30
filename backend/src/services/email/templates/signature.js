export const IPC_SIGNATURE = `Regards,
Indian Pharmacopoeia Commission (IPC)
Ministry of Health & Family Welfare
Government of India`;

const SIGN_OFF =
  /^((with\s+)?(kind|best|warm|warmest)?\s*regards|yours\s+(faithfully|sincerely|truly)|sincerely)\s*,?$/i;

const SIGN_OFF_WINDOW = 8;

export function withIpcSignature(body) {
  const text = String(body ?? '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
  if (text.endsWith(IPC_SIGNATURE)) return text;

  const lines = text.split('\n');
  let cut = lines.length;
  for (let index = lines.length - 1; index >= Math.max(0, lines.length - SIGN_OFF_WINDOW); index -= 1) {
    if (SIGN_OFF.test(lines[index].trim())) {
      cut = index;
      break;
    }
  }

  const kept = lines.slice(0, cut).join('\n').replace(/\s+$/, '');
  return kept ? `${kept}\n\n${IPC_SIGNATURE}` : IPC_SIGNATURE;
}
