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

const outboundAllowed = () => String(process.env.NIC_ALLOW_OUTBOUND || '').trim() === 'true';

const sameAddress = (a, b) =>
  String(a || '')
    .trim()
    .toLowerCase() ===
  String(b || '')
    .trim()
    .toLowerCase();

function assertRecipientAllowed(recipients, { testRecipient, variable, label }) {
  if (outboundAllowed()) return;

  const blocked = recipients.filter((address) => !sameAddress(address, testRecipient));
  if (!blocked.length) return;

  throw new Error(
    `${label} refused to send to ${blocked.join(', ')}. ` +
      `Outbound mail is confined to ${variable} until NIC_ALLOW_OUTBOUND=true.`,
  );
}

export { outboundAllowed, assertRecipientAllowed };
