export const EMAIL_DIRECTION = {
  INBOUND: 'INBOUND',
  OUTBOUND: 'OUTBOUND',
};

export const EMAIL_TYPE = {
  INCOMING_QUERY: 'INCOMING_QUERY',
  ACKNOWLEDGEMENT: 'ACKNOWLEDGEMENT',
  FORWARD: 'FORWARD',
  OUTGOING_RESPONSE: 'OUTGOING_RESPONSE',
};

export const EMAIL_STATUS = {
  SENT: 'SENT',
  RECEIVED: 'RECEIVED',
  FAILED: 'FAILED',
};

export const EMAIL_TYPE_LABELS = {
  [EMAIL_TYPE.INCOMING_QUERY]: 'Original enquiry',
  [EMAIL_TYPE.ACKNOWLEDGEMENT]: 'Acknowledgement',
  [EMAIL_TYPE.FORWARD]: 'Forwarded to Officer-in-Charge',
  [EMAIL_TYPE.OUTGOING_RESPONSE]: 'Final response',
};

export function describeDirection(direction) {
  return direction === EMAIL_DIRECTION.INBOUND ? 'Received by IPC' : 'Sent by IPC';
}

export function describeParticipants(message) {
  const to = Array.isArray(message.to) ? message.to.join(', ') : message.to;
  return `${message.from} → ${to}`;
}

export function createEmailMessage({
  messageId,
  threadId,
  queryId = null,
  direction,
  emailType,
  from,
  to = [],
  cc = [],
  bcc = [],
  subject,
  body,
  attachments = [],
  timestamp,
  providerMessageId = null,
  providerThreadId = null,
  status,
}) {
  if (!messageId) throw new Error('createEmailMessage: messageId is required');
  if (!threadId) throw new Error('createEmailMessage: threadId is required');
  if (!Object.values(EMAIL_DIRECTION).includes(direction)) {
    throw new Error(`createEmailMessage: invalid direction "${direction}"`);
  }
  if (!Object.values(EMAIL_TYPE).includes(emailType)) {
    throw new Error(`createEmailMessage: invalid emailType "${emailType}"`);
  }
  if (!from) throw new Error('createEmailMessage: from is required');

  const recipients = Array.isArray(to) ? to : [to];
  if (recipients.length === 0) throw new Error('createEmailMessage: at least one recipient is required');

  return {
    messageId,
    threadId,
    queryId,
    direction,
    emailType,
    from,
    to: recipients,
    cc: Array.isArray(cc) ? cc : [cc].filter(Boolean),
    bcc: Array.isArray(bcc) ? bcc : [bcc].filter(Boolean),
    subject: subject || '(no subject)',
    body: body || '',
    attachments,
    timestamp: timestamp || new Date().toISOString(),
    providerMessageId,
    providerThreadId,
    status: status || (direction === EMAIL_DIRECTION.INBOUND ? EMAIL_STATUS.RECEIVED : EMAIL_STATUS.SENT),
  };
}

export function createEmailThread({ threadId, queryId = null, subject, createdAt }) {
  if (!threadId) throw new Error('createEmailThread: threadId is required');
  return {
    threadId,
    queryId,
    subject: subject || '(no subject)',
    createdAt: createdAt || new Date().toISOString(),
  };
}

export function sortThreadMessages(messages) {
  return [...messages].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}
