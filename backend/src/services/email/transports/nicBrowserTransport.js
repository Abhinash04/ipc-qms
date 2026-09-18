import browserConfig from '../../../config/browserConfig.js';
import { sendMail } from '../nic/browser/sendMail.js';
import { assertRecipientAllowed } from '../nic/outboundGuard.js';

/**
 * Sending through the signed-in NICeMail web session, as a QMS transport.
 *
 * Chosen per case, not globally: emailService selects it for the external mail
 * (acknowledgement, final response) of a case whose enquiry arrived in the
 * NICeMail browser mailbox. Everything else keeps EMAIL_TRANSPORT.
 *
 * Same contract as nicTransport.js: throws on any failure, so a caller never
 * mistakes an unsent message for a sent one.
 */

const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);

export async function send(message, { asRole = null, sender = null } = {}) {
  const to = asList(message.to);
  const cc = asList(message.cc);
  const bcc = asList(message.bcc);

  if (bcc.length) {
    throw new Error('The NICeMail browser transport does not send Bcc; refusing rather than dropping it.');
  }

  assertRecipientAllowed([...to, ...cc], {
    testRecipient: browserConfig.testRecipient,
    variable: 'NIC_BROWSER_TEST_RECIPIENT',
    label: 'NICeMail browser transport',
  });

  const result = await (sender || sendMail)({
    to,
    cc,
    subject: message.subject,
    body: message.body,
    // Resolved by emailService: `{ filename, mimeType, content: Buffer }`.
    attachments: message.attachments || [],
  });

  return {
    providerMessageId: result?.providerMessageId || null,
    providerThreadId: message.providerThreadId || null,
    transport: 'nic-browser',
    sentAsRole: asRole,
  };
}

export const name = 'nic-browser';
