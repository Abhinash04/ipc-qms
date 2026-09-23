import browserConfig from '../../../config/browserConfig.js';
import { sendMail } from '../nic/browser/sendMail.js';
import { assertRecipientAllowed, outboundAllowed } from '../nic/outboundGuard.js';
import { DELIVERY, labelDelivery } from '../delivery.js';

const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);

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
