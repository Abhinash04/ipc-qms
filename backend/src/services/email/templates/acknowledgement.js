import { IPC_SIGNATURE, letterOpening, referenceSentence } from './signature.js';

const SUBJECT = 'Acknowledgement of Query Received – Indian Pharmacopoeia Commission';

const AUTO_NOTICE = 'This is an auto-generated email. Please do not reply to this message.';

function acknowledgementBody({ to = '', inquirerName = '', subject = '', receivedAt = null } = {}) {
  return [
    letterOpening({ inquirer: { name: inquirerName, email: to }, subject }),
    `${referenceSentence(receivedAt)} This is to acknowledge that your query has been duly received and forwarded to the concerned division for examination.`,
    'The matter is currently under consideration, and an appropriate response will be provided to you at the earliest. We appreciate your patience and understanding.',
    IPC_SIGNATURE,
    AUTO_NOTICE,
  ].join('\n\n');
}

const BODY = acknowledgementBody();

function buildAcknowledgement({ to, fromEmail, fromName, queryId, inquirerName, subject, receivedAt }) {
  if (!to) throw new Error('buildAcknowledgement: "to" is required');
  if (!fromEmail) throw new Error('buildAcknowledgement: "fromEmail" is required');

  return {
    from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
    to: [to],
    subject: queryId ? `${SUBJECT} [${queryId}]` : SUBJECT,
    body: acknowledgementBody({ to, inquirerName, subject, receivedAt }),
  };
}

export {
  buildAcknowledgement,
  acknowledgementBody,
  SUBJECT as ACKNOWLEDGEMENT_SUBJECT,
  BODY as ACKNOWLEDGEMENT_BODY,
};
