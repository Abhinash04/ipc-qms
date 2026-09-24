import nicConfig from '../../../config/nicConfig.js';
import { sendMessage } from '../nic/nicSmtp.js';
import { DELIVERY, labelDelivery } from '../delivery.js';

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

  throw labelDelivery(
    new Error(
      `NICeMail transport refused to send to ${blocked.join(', ')}. ` +
        'Outbound mail is confined to NIC_TEST_RECIPIENT until NIC_ALLOW_OUTBOUND=true.',
    ),
    DELIVERY.NOT_SENT,
  );
}

function deliveryForStage(stage, error) {
  if (stage !== 'submit') return DELIVERY.NOT_SENT;
  return /^\s*[45]\d\d\b/.test(String(error || '')) ? DELIVERY.NOT_SENT : DELIVERY.UNCERTAIN;
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
    messageId: message.messageIdHeader || null,
    attachments: (message.attachments || []).map((att) => ({
      filename: att.filename,
      content: att.content,
      contentType: att.mimeType || 'application/octet-stream',
    })),
  });

  if (!result.ok) {
    throw Object.assign(new Error(`NICeMail send failed at ${result.stage}: ${result.error}`), {
      stage: result.stage,
      delivery: deliveryForStage(result.stage, result.error),
    });
  }

  return {
    providerMessageId: result.data.messageId,
    providerThreadId: message.providerThreadId || null,
    transport: 'nic',
    sentAsRole: asRole,
  };
}

export const name = 'nic';
