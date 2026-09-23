import { ROLES, ACTOR_TYPES } from './roles.js';

/**
 * The four NIC agent autonomy levels, as capabilities rather than as a
 * numeric level.
 *
 * A number invites comparison (`level >= 3`), and comparison is how an agent
 * ends up one arithmetic slip away from sending official government
 * correspondence. A capability is either held or it is not.
 */
export const CAPABILITIES = {
  /** L1 — connect, sync, read, parse, classify, summarise, associate. */
  NIC_READ: 'NIC_READ',
  /** L2 — create a Case, prepare a draft/reply/forward, recommend an OIC. */
  NIC_PREPARE: 'NIC_PREPARE',
  /** L3 — send, reply, forward, mark read, move. Human approval required. */
  NIC_SEND: 'NIC_SEND',
  /** L4 — move to Trash, bulk modification. Human, and heavily audited. */
  NIC_DESTRUCTIVE: 'NIC_DESTRUCTIVE',
};

const { NIC_READ, NIC_PREPARE, NIC_SEND, NIC_DESTRUCTIVE } = CAPABILITIES;

/**
 * Capabilities that only a human may ever hold.
 *
 * This is the single rule that keeps the spec's "AI must not automatically
 * send official correspondence" true no matter how the role table is later
 * edited: it is checked before the role table is consulted at all.
 */
const HUMAN_ONLY = new Set([NIC_SEND, NIC_DESTRUCTIVE]);

/** What the sync agent may do acting on its own, with no human behind it. */
const AGENT_CAPABILITIES = [NIC_READ, NIC_PREPARE];

/**
 * ADMIN is a configuration role (users, divisions, categories, workflows) and
 * holds no operational mail capability — see docs/workflow/role-permission-matrix.md.
 * An inquirer is external and never reaches the official mailbox at all.
 */
const ROLE_CAPABILITIES = {
  [ROLES.SUPER_ADMIN]: [NIC_READ, NIC_PREPARE, NIC_SEND, NIC_DESTRUCTIVE],
  [ROLES.FRONT_OFFICE]: [NIC_READ, NIC_PREPARE, NIC_SEND, NIC_DESTRUCTIVE],
  [ROLES.OFFICER_IN_CHARGE]: [NIC_READ, NIC_PREPARE],
  [ROLES.ASSIGNED_OFFICIAL]: [NIC_READ],
  [ROLES.REVIEWER]: [NIC_READ],
  [ROLES.ADMIN]: [],
};

/**
 * Does this actor hold `capability`?
 *
 * `actor` is the shape `authenticate` puts on `req.user`, or the synthetic
 * actor the sync agent constructs for itself. An unknown role, a missing
 * actor, or an unknown capability all resolve to `false` — the check fails
 * closed rather than defaulting to permitted.
 */
export function can(actor, capability) {
  if (!actor || !capability) return false;

  const actorType = actor.actorType || ACTOR_TYPES.HUMAN;

  if (actorType === ACTOR_TYPES.AGENT) return AGENT_CAPABILITIES.includes(capability);
  if (HUMAN_ONLY.has(capability) && actorType !== ACTOR_TYPES.HUMAN) return false;

  return (ROLE_CAPABILITIES[actor.role] || []).includes(capability);
}

/** Everything this actor may do — for `GET /auth/me`, not for gating. */
export function capabilitiesFor(actor) {
  return Object.values(CAPABILITIES).filter((capability) => can(actor, capability));
}

export { ROLE_CAPABILITIES, AGENT_CAPABILITIES, HUMAN_ONLY };
