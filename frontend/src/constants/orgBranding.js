export const IPC_FRONT_OFFICE_NAME = 'Indian Pharmacopoeia Commission (IPC) Front Office';

const IPC_SHORT_NAME = 'IPC';

const LEGACY_NAME = /^\s*eco[\s-]?clubs?\b/i;

export function brandedName(name) {
  return typeof name === 'string' && LEGACY_NAME.test(name) ? IPC_FRONT_OFFICE_NAME : name;
}

export function brandUser(user) {
  if (!user || brandedName(user.name) === user.name) return user;
  return { ...user, name: IPC_FRONT_OFFICE_NAME };
}

export function brandedFrom(from) {
  if (typeof from !== 'string') return from;
  const match = from.match(/^\s*"?([^"<]*?)"?\s*(<[^>]+>)\s*$/);
  if (match) return LEGACY_NAME.test(match[1]) ? `${IPC_FRONT_OFFICE_NAME} ${match[2]}` : from;
  return from.includes('@') ? from : brandedName(from);
}

export function greetingName(name) {
  if (!name) return '';
  if (brandedName(name) === IPC_FRONT_OFFICE_NAME) return IPC_SHORT_NAME;
  return name.split(' ')[0];
}
