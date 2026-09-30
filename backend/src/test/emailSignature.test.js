import { describe, it, expect } from 'vitest';
import { IPC_SIGNATURE, withIpcSignature } from '../services/email/templates/signature.js';
import { ACKNOWLEDGEMENT_BODY, buildAcknowledgement } from '../services/email/templates/acknowledgement.js';
import { IPC_SIGNATURE as DRAFT_SIGNATURE } from '../../../frontend/src/services/ai/draftComposer.js';

const STANDARD = [
  'Regards,',
  'Indian Pharmacopoeia Commission (IPC)',
  'Ministry of Health & Family Welfare',
  'Government of India',
].join('\n');

describe('the IPC email signature', () => {
  it('is the standard four-line block', () => {
    expect(IPC_SIGNATURE).toBe(STANDARD);
  });

  it('is the same block the AI draft replies end with', () => {
    expect(DRAFT_SIGNATURE).toBe(IPC_SIGNATURE);
  });

  it('closes the acknowledgement, before the auto-generated notice', () => {
    expect(ACKNOWLEDGEMENT_BODY).toContain(`Thank you.\n\n${IPC_SIGNATURE}\n\nThis is an auto-generated email.`);
    expect(buildAcknowledgement({ to: 'a@example.com', fromEmail: 'fo@example.com' }).body).toBe(ACKNOWLEDGEMENT_BODY);
  });

  it('names no division', () => {
    expect(ACKNOWLEDGEMENT_BODY).not.toMatch(/AR&D|Division\b/);
    expect(IPC_SIGNATURE).not.toMatch(/AR&D|Division\b/);
  });
});

describe('signing a reply', () => {
  it('appends the signature to an unsigned reply', () => {
    expect(withIpcSignature('The limit is 0.5%.')).toBe(`The limit is 0.5%.\n\n${IPC_SIGNATURE}`);
  });

  it('leaves a reply that already ends with the signature exactly once', () => {
    const signed = `The limit is 0.5%.\n\n${IPC_SIGNATURE}`;
    expect(withIpcSignature(signed)).toBe(signed);
    expect(withIpcSignature(`${signed}\n\n  \n`)).toBe(signed);
    expect(withIpcSignature(signed.replace(/\n/g, '\r\n'))).toBe(signed);
  });

  it('replaces an old divisional sign-off with the IPC signature', () => {
    const old = 'The limit is 0.5%.\n\nRegards,\nAR&D Division\nIndian Pharmacopoeia Commission';
    expect(withIpcSignature(old)).toBe(`The limit is 0.5%.\n\n${IPC_SIGNATURE}`);
  });

  it.each(['Yours faithfully,', 'Best regards,', 'With kind regards', 'Sincerely,'])(
    'replaces a closing that starts with "%s"',
    (closing) => {
      const text = `The limit is 0.5%.\n\n${closing}\nDr. A. Kumar\nPrincipal Scientific Officer`;
      expect(withIpcSignature(text)).toBe(`The limit is 0.5%.\n\n${IPC_SIGNATURE}`);
    },
  );

  it('keeps a "regards" that is part of the answer rather than a closing', () => {
    const text = 'With regards to the dissolution test, the limit is 80% (Q).';
    expect(withIpcSignature(text)).toBe(`${text}\n\n${IPC_SIGNATURE}`);
  });

  it('does not reach back past the last few lines for a closing', () => {
    const body = ['Regards,', ...Array.from({ length: 10 }, (_, i) => `Point ${i + 1}.`)].join('\n');
    expect(withIpcSignature(body)).toBe(`${body}\n\n${IPC_SIGNATURE}`);
  });

  it('signs an empty reply with the signature alone', () => {
    expect(withIpcSignature('')).toBe(IPC_SIGNATURE);
    expect(withIpcSignature(null)).toBe(IPC_SIGNATURE);
  });
});
