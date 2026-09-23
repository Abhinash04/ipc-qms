import { IDENTITY_ROLES, identityForRole } from '../../../config/identities.js';

const outboundAllowed = () => String(process.env.NIC_ALLOW_OUTBOUND || '').trim() === 'true';

const sameAddress = (a, b) =>
  String(a || '')
    .trim()
    .toLowerCase() ===
  String(b || '')
    .trim()
    .toLowerCase();

const internalForwardAllowed = () =>
  String(process.env.NIC_ALLOW_INTERNAL_FORWARD || '').trim() === 'true';

function allowedRecipients(testRecipient, internalForward) {
  const allowed = [testRecipient];
  if (!internalForward || !internalForwardAllowed()) return allowed;

  const officer = identityForRole(IDENTITY_ROLES.OFFICER_IN_CHARGE)?.email;
  if (officer) allowed.push(officer);
  return allowed;
}

function assertRecipientAllowed(
  recipients,
  { testRecipient, variable, label, internalForward = false },
) {
  if (outboundAllowed()) return;

  const allowed = allowedRecipients(testRecipient, internalForward);
  const blocked = recipients.filter(
    (address) => !allowed.some((permitted) => sameAddress(address, permitted)),
  );
  if (!blocked.length) return;

  const confinement =
    allowed.length > 1
      ? `${variable} and OFFICER_IN_CHARGE_EMAIL`
      : internalForward
        ? `${variable} (set NIC_ALLOW_INTERNAL_FORWARD=true to also allow OFFICER_IN_CHARGE_EMAIL)`
        : variable;

  throw Object.assign(
    new Error(
      `${label} refused to send to ${blocked.join(', ')}. ` +
        `Outbound mail is confined to ${confinement} until NIC_ALLOW_OUTBOUND=true.`,
    ),
    { configuration: true },
  );
}

export { outboundAllowed, internalForwardAllowed, assertRecipientAllowed };
