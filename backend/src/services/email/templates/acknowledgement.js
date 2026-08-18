const SUBJECT = 'Acknowledgement of Query Received – Indian Pharmacopoeia Commission';

const BODY = `Dear Sir/Madam,

Greetings from the Indian Pharmacopoeia Commission (IPC)!

This is to acknowledge that we have received your email/query. Your query has been duly noted and forwarded to the concerned division for review.

The matter is currently under consideration, and we will provide you with an appropriate response as soon as possible.

We appreciate your patience and understanding.

Thank you.

Regards,
AR&D Division
Indian Pharmacopoeia Commission (IPC)
Ministry of Health & Family Welfare
Government of India

This is an auto-generated email. Please do not reply to this message.`;

function buildAcknowledgement({ to, fromEmail, fromName, queryId }) {
  if (!to) throw new Error('buildAcknowledgement: "to" is required');
  if (!fromEmail) throw new Error('buildAcknowledgement: "fromEmail" is required');

  return {
    from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
    to: [to],
    subject: queryId ? `${SUBJECT} [${queryId}]` : SUBJECT,
    body: BODY,
  };
}

export { buildAcknowledgement, SUBJECT as ACKNOWLEDGEMENT_SUBJECT, BODY as ACKNOWLEDGEMENT_BODY };
