/**
 * A two-key interlock on an official government mailbox.
 *
 * Selecting a NICeMail transport is not enough on its own: until
 * NIC_ALLOW_OUTBOUND is explicitly `true`, sends are confined to one test
 * recipient. Misconfiguring one variable should not be able to start mailing
 * the public from a .gov.in address.
 *
 * Mirrors the interlock in transports/nicTransport.js (SMTP) for the
 * browser-agent transport, which names its own test-recipient variable but
 * must refuse in exactly the same way.
 */
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

/**
 * The internal forward, while the main interlock is still closed.
 *
 * The forward goes to one configured internal address and no other: both
 * caseMail and emailService read it from identityForRole, never from a caller,
 * so there is nothing here for a request body to influence. Opening it lets an
 * operator rehearse intake end to end without first opening the mailbox to
 * every address on the internet, which is the only alternative.
 *
 * `internalForward` arrives as a boolean and the address is re-derived here.
 * Passing the address in would make the allowed set a function of whatever
 * called us.
 */
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

  // A configuration refusal, not a delivery failure: retrying cannot succeed
  // until an environment variable changes, so the caller is told not to offer
  // a retry that is guaranteed to fail the same way.
  throw Object.assign(
    new Error(
      `${label} refused to send to ${blocked.join(', ')}. ` +
        `Outbound mail is confined to ${confinement} until NIC_ALLOW_OUTBOUND=true.`,
    ),
    { configuration: true },
  );
}

export { outboundAllowed, internalForwardAllowed, assertRecipientAllowed };
