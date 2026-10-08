import { ROLES, ACTOR_TYPES } from './roles.js';

export const CAPABILITIES = {
  NIC_READ: 'NIC_READ',
  NIC_PREPARE: 'NIC_PREPARE',
  NIC_SEND: 'NIC_SEND',
  NIC_DESTRUCTIVE: 'NIC_DESTRUCTIVE',
};

const { NIC_READ, NIC_PREPARE, NIC_SEND, NIC_DESTRUCTIVE } = CAPABILITIES;
const HUMAN_ONLY = new Set([NIC_SEND, NIC_DESTRUCTIVE]);
const AGENT_CAPABILITIES = [NIC_READ, NIC_PREPARE];
const ROLE_CAPABILITIES = {
  [ROLES.SUPER_ADMIN]: [NIC_READ, NIC_PREPARE, NIC_SEND, NIC_DESTRUCTIVE],
  [ROLES.FRONT_OFFICE]: [NIC_READ, NIC_PREPARE, NIC_SEND, NIC_DESTRUCTIVE],
  [ROLES.OFFICER_IN_CHARGE]: [NIC_READ, NIC_PREPARE],
  [ROLES.ASSIGNED_OFFICIAL]: [NIC_READ],
  [ROLES.REVIEWER]: [NIC_READ],
  [ROLES.ADMIN]: [],
};

export function can(actor, capability) {
  if (!actor || !capability) return false;

  const actorType = actor.actorType || ACTOR_TYPES.HUMAN;

  if (actorType === ACTOR_TYPES.AGENT) return AGENT_CAPABILITIES.includes(capability);
  if (HUMAN_ONLY.has(capability) && actorType !== ACTOR_TYPES.HUMAN) return false;

  return (ROLE_CAPABILITIES[actor.role] || []).includes(capability);
}

export function capabilitiesFor(actor) {
  return Object.values(CAPABILITIES).filter((capability) => can(actor, capability));
}

export { ROLE_CAPABILITIES, AGENT_CAPABILITIES, HUMAN_ONLY };
