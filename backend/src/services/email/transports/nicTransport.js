import nicConfig from '../../../config/nicConfig.js';
import { sendMessage } from '../nic/nicSmtp.js';

/**
 * Sending through NICeMail SMTP as a QMS transport.
 *
 * Distinct from `services/email/nic/actions.js`. That module is the
 * *verification* surface behind `/api/v1/nic/*` and `npm run nic:verify`: it
 * may only ever send to NIC_TEST_RECIPIENT, because it exists to prove the
 * transport works, not to correspond. This module is the production mail path,
 * selected by EMAIL_TRANSPORT=nic, and it carries real case correspondence.
 *
 * It is NOT the browser agent. The browser agent (services/email/nic/browser/)
 * drives an already-authenticated NICeMail web session over CDP and shares no
 * code with this file.
 */

/**
 * A two-key interlock on an official government mailbox.
 *
 * Selecting the transport is not enough on its own: until NIC_ALLOW_OUTBOUND is
 * explicitly `true`, sends are confined to NIC_TEST_RECIPIENT exactly as the
 * verification action is. Misconfiguring one variable should not be able to
 * start mailing the public from a .gov.in address.
 */
const outboundAllowed = () => String(process.env.NIC_ALLOW_OUTBOUND || '').trim() === 'true';

const sameAddress = (a, b) =>
  String(a || '')
    .trim()
    .toLowerCase() ===
  String(b || '')
    .trim()
    .toLowerCase();

const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);

function assertRecipientAllowed(recipients) {
  if (outboundAllowed()) return;

  const blocked = recipients.filter((address) => !sameAddress(address, nicConfig.testRecipient));
  if (!blocked.length) return;

  throw new Error(
    `NICeMail transport refused to send to ${blocked.join(', ')}. ` +
      'Outbound mail is confined to NIC_TEST_RECIPIENT until NIC_ALLOW_OUTBOUND=true.',
  );
}

export async function send(message, { asRole = null, sender = null } = {}) {
  const to = asList(message.to);
  const cc = asList(message.cc);
  const bcc = asList(message.bcc);

  assertRecipientAllowed([...to, ...cc, ...bcc]);

  const result = await (sender || sendMessage)({
    to: to.join(', '),
    cc,
    bcc,
    from: message.fromName || null,
    subject: message.subject,
    text: message.body,
    // Attachment bytes come from attachmentStore, already resolved by
    // emailService — the same records the Gmail transport MIME-encodes.
    attachments: (message.attachments || []).map((att) => ({
      filename: att.filename,
      content: att.content,
      contentType: att.mimeType || 'application/octet-stream',
    })),
  });

  // nicSmtp reports `{ ok, stage, error }` rather than throwing, so that
  // `nic:verify` can name the stage that failed. A transport must throw: every
  // caller in emailService treats a returned object as a successful send.
  if (!result.ok) {
    throw Object.assign(new Error(`NICeMail send failed at ${result.stage}: ${result.error}`), {
      stage: result.stage,
    });
  }

  return {
    providerMessageId: result.data.messageId,
    // SMTP has no thread identifier. Threading falls back to the client's own
    // reply headers, which is what a plain mail client does anyway.
    providerThreadId: message.providerThreadId || null,
    transport: 'nic',
    sentAsRole: asRole,
  };
}

export const name = 'nic';
