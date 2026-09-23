import browserConfig from '../../../config/browserConfig.js';
import { sendMail } from '../nic/browser/sendMail.js';
import { assertRecipientAllowed, outboundAllowed } from '../nic/outboundGuard.js';
import { DELIVERY, labelDelivery } from '../delivery.js';

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

/**
 * Only one failure here can have sent anything: Send pressed and the compose
 * form never confirmed it (`unconfirmed`, raised by sendMail). Everything else
 * — the interlock, a missing selector, no Chrome — fails before Send is
 * pressed, so it is labelled NOT_SENT and may be retried.
 */
export async function send(message, options = {}) {
  try {
    return await sendThroughBrowser(message, options);
  } catch (error) {
    throw labelDelivery(error, DELIVERY.NOT_SENT);
  }
}

async function sendThroughBrowser(
  message,
  { asRole = null, sender = null, internalForward = false, onStage = null } = {},
) {
  const to = asList(message.to);
  const cc = asList(message.cc);
  const bcc = asList(message.bcc);

  if (bcc.length) {
    throw new Error('The NICeMail browser transport does not send Bcc; refusing rather than dropping it.');
  }

  try {
    assertRecipientAllowed([...to, ...cc], {
      testRecipient: browserConfig.testRecipient,
      variable: 'NIC_BROWSER_TEST_RECIPIENT',
      label: 'NICeMail browser transport',
      internalForward,
    });
  } catch (error) {
    onStage?.('NIC BROWSER', { step: 'outbound_guard', result: 'refused' });
    // Object.assign, deliberately: `configuration` set by the guard must
    // survive, and labelDelivery would not carry it.
    throw Object.assign(error, { failedStep: 'outbound_guard' });
  }
  onStage?.('NIC BROWSER', {
    step: 'outbound_guard',
    result: 'allowed',
    mode: outboundAllowed() ? 'production-outbound' : 'test-recipient',
  });

  const result = await (sender || sendMail)(
    {
      to,
      cc,
      subject: message.subject,
      body: message.body,
      // Resolved by emailService: `{ filename, mimeType, content: Buffer }`.
      attachments: message.attachments || [],
    },
    { onStage },
  );

  return {
    providerMessageId: result?.providerMessageId || null,
    providerThreadId: message.providerThreadId || null,
    transport: 'nic-browser',
    sentAsRole: asRole,
  };
}

export const name = 'nic-browser';
