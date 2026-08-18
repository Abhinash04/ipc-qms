import { describe, it, expect } from 'vitest';
import {
  EMAIL_DIRECTION,
  EMAIL_TYPE,
  EMAIL_STATUS,
  createEmailMessage,
  createEmailThread,
  sortThreadMessages,
  describeDirection,
  describeParticipants,
} from '@/constants/emailModel';

const base = {
  messageId: 'MSG-00001',
  threadId: 'THREAD-2026-00001',
  direction: EMAIL_DIRECTION.INBOUND,
  emailType: EMAIL_TYPE.INCOMING_QUERY,
  from: 'abhinash.pritiraj@gmail.com',
  to: ['ipc-query-mock@example.com'],
  subject: 'Clarification on monograph revision',
  body: 'Please clarify the revised timeline.',
  timestamp: '2026-08-17T09:00:00.000Z',
};

describe('createEmailMessage', () => {
  it('builds a complete message record', () => {
    const msg = createEmailMessage(base);
    expect(msg.messageId).toBe('MSG-00001');
    expect(msg.threadId).toBe('THREAD-2026-00001');
    expect(msg.from).toBe('abhinash.pritiraj@gmail.com');
    expect(msg.to).toEqual(['ipc-query-mock@example.com']);
    expect(msg.cc).toEqual([]);
    expect(msg.bcc).toEqual([]);
    expect(msg.attachments).toEqual([]);
    expect(msg.queryId).toBeNull();
    expect(msg.providerMessageId).toBeNull();
  });

  it('defaults inbound status to RECEIVED and outbound to SENT', () => {
    expect(createEmailMessage(base).status).toBe(EMAIL_STATUS.RECEIVED);
    expect(
      createEmailMessage({
        ...base,
        direction: EMAIL_DIRECTION.OUTBOUND,
        emailType: EMAIL_TYPE.ACKNOWLEDGEMENT,
      }).status,
    ).toBe(EMAIL_STATUS.SENT);
  });

  it('normalises a single string recipient into an array', () => {
    const msg = createEmailMessage({ ...base, to: 'ipc-query-mock@example.com', cc: 'x@example.com' });
    expect(msg.to).toEqual(['ipc-query-mock@example.com']);
    expect(msg.cc).toEqual(['x@example.com']);
  });

  it('is provider-agnostic — provider ids are null unless supplied', () => {
    const msg = createEmailMessage({ ...base, providerMessageId: 'gmail-abc', providerThreadId: 'gmail-thr' });
    expect(msg.providerMessageId).toBe('gmail-abc');
    expect(msg.providerThreadId).toBe('gmail-thr');
  });

  it('rejects invalid or missing required fields', () => {
    expect(() => createEmailMessage({ ...base, messageId: null })).toThrow(/messageId/);
    expect(() => createEmailMessage({ ...base, threadId: null })).toThrow(/threadId/);
    expect(() => createEmailMessage({ ...base, from: null })).toThrow(/from/);
    expect(() => createEmailMessage({ ...base, to: [] })).toThrow(/recipient/);
    expect(() => createEmailMessage({ ...base, direction: 'SIDEWAYS' })).toThrow(/direction/);
    expect(() => createEmailMessage({ ...base, emailType: 'NONSENSE' })).toThrow(/emailType/);
  });
});

describe('direction convention (from the QMS/IPC perspective)', () => {
  it('treats inquirer → IPC as INBOUND', () => {
    const msg = createEmailMessage(base);
    expect(msg.direction).toBe(EMAIL_DIRECTION.INBOUND);
    expect(describeDirection(msg.direction)).toBe('Received by IPC');
  });

  it('treats IPC → inquirer as OUTBOUND', () => {
    const msg = createEmailMessage({
      ...base,
      direction: EMAIL_DIRECTION.OUTBOUND,
      emailType: EMAIL_TYPE.OUTGOING_RESPONSE,
      from: 'arnd-ipc-mock@example.com',
      to: ['abhinash.pritiraj@gmail.com'],
    });
    expect(msg.direction).toBe(EMAIL_DIRECTION.OUTBOUND);
    expect(describeDirection(msg.direction)).toBe('Sent by IPC');
  });

  it('renders participants in plain language for the UI', () => {
    expect(describeParticipants(createEmailMessage(base))).toBe(
      'abhinash.pritiraj@gmail.com → ipc-query-mock@example.com',
    );
  });
});

describe('createEmailThread', () => {
  it('builds a thread record', () => {
    const thread = createEmailThread({
      threadId: 'THREAD-2026-00001',
      queryId: 'QRY-2026-00001',
      subject: 'Clarification on monograph revision',
      createdAt: '2026-08-17T09:00:00.000Z',
    });
    expect(thread.threadId).toBe('THREAD-2026-00001');
    expect(thread.queryId).toBe('QRY-2026-00001');
  });

  it('requires a threadId', () => {
    expect(() => createEmailThread({})).toThrow(/threadId/);
  });
});

describe('sortThreadMessages', () => {
  it('orders messages chronologically without mutating the input', () => {
    const input = [
      { messageId: 'MSG-00003', timestamp: '2026-08-19T09:00:00.000Z' },
      { messageId: 'MSG-00001', timestamp: '2026-08-17T09:00:00.000Z' },
      { messageId: 'MSG-00002', timestamp: '2026-08-18T09:00:00.000Z' },
    ];
    const sorted = sortThreadMessages(input);
    expect(sorted.map((m) => m.messageId)).toEqual(['MSG-00001', 'MSG-00002', 'MSG-00003']);
    expect(input[0].messageId).toBe('MSG-00003');
  });
});
