import { describe, it, expect, afterEach, vi } from 'vitest';

import { sendTrace, traceSink } from '../services/email/sendTrace.js';

/**
 * The per-send log lines. They carry addresses and subjects on purpose — that
 * is what an operator traces a send by — and must never carry a credential,
 * or become the reason a send fails.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const capture = () => {
  const lines = [];
  vi.spyOn(traceSink, 'write').mockImplementation((line) => lines.push(line));
  return lines;
};

describe('sendTrace', () => {
  it('writes one line: tag, phase, then the case and the data as JSON', () => {
    const lines = capture();

    sendTrace('ACK', { caseId: 'QRY-2026-00001' })('START', { inquirerEmail: 'ravi@pharma.example', transport: 'nic-browser' });

    expect(lines).toEqual([
      'ACK START {"caseId":"QRY-2026-00001","inquirerEmail":"ravi@pharma.example","transport":"nic-browser"}',
    ]);
  });

  it('drops anything named like a credential, however deep', () => {
    const lines = capture();

    sendTrace('ACK', { caseId: 'Q' })('NIC BROWSER', {
      step: 'x',
      accessToken: 'ya29.secret',
      snapshot: { cookie: 'session=abc', password: 'hunter2', Authorization: 'Bearer z', kept: 1 },
    });

    expect(lines[0]).not.toMatch(/ya29|session=abc|hunter2|Bearer/);
    expect(lines[0]).toContain('"kept":1');
  });

  it('never throws — a log line is not a reason for a send to fail', () => {
    vi.spyOn(traceSink, 'write').mockImplementation(() => {
      throw new Error('stdout closed');
    });
    const circular = {};
    circular.self = circular;

    expect(() => sendTrace('ACK')('RESULT', { circular })).not.toThrow();
  });
});
