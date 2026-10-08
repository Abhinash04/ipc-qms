import { describe, it, expect } from 'vitest';
import {
  bodyText,
  contentHash,
  jaccard,
  normaliseSubject,
  queryIdsIn,
  senderKey,
  shingles,
} from '../services/email/mailbox/mailFingerprint.js';

describe('the mail fingerprint', () => {
  it('keys a sender by the bare, lower-case address', () => {
    expect(senderKey('Anita Rao <Anita.Rao@Example.invalid>')).toBe('anita.rao@example.invalid');
    expect(senderKey('')).toBeNull();
  });

  it('strips reply and forward prefixes and the -reg. suffix from a subject', () => {
    expect(normaliseSubject('RE: Fwd: Re[2]: Query on IPRS -reg.')).toBe('query on iprs');
    expect(normaliseSubject('  Dissolution   limits ')).toBe('dissolution limits');
  });

  it('reads the new text of a reply, not the quoted original', () => {
    expect(bodyText({ body: 'New info here.\n\nOn Mon, 1 Sep 2026, Anita wrote:\n> old text' })).toBe('New info here.');
    expect(bodyText({ body: 'Top line\n> quoted line\nlast line' })).toBe('Top line last line');
  });

  it('falls back to the HTML body when there is no text body', () => {
    expect(bodyText({ body: '', bodyHtml: '<p>Hello <b>IPC</b></p>' })).toBe('Hello IPC');
  });

  it('hashes the same content identically despite case, spacing and a reply prefix', () => {
    const a = contentHash({ subject: 'Re: Dissolution limits', body: 'Please  clarify\nthe limits.' });
    const b = contentHash({ subject: 'dissolution limits', body: 'please clarify the limits' });
    expect(a).toBe(b);
  });

  it('hashes different content, or different attachments, differently', () => {
    const base = { subject: 'Dissolution limits', body: 'Please clarify the limits.' };
    expect(contentHash(base)).not.toBe(contentHash({ ...base, body: 'Please clarify the assay.' }));
    expect(contentHash(base)).not.toBe(contentHash({ ...base, attachments: [{ filename: 'coa.pdf' }] }));
  });

  it('measures overlap with word shingles', () => {
    expect(jaccard(shingles('a b c d e'), shingles('a b c d e'))).toBe(1);
    expect(jaccard(shingles('a b c d e f'), shingles('x y z'))).toBe(0);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it('finds case numbers in any case and reports each once', () => {
    expect(queryIdsIn('Re: [QRY-2026-00012] status', 'see qry-2026-00012 and QRY-2026-00999')).toEqual([
      'QRY-2026-00012',
      'QRY-2026-00999',
    ]);
    expect(queryIdsIn('QRY-26-1', null)).toEqual([]);
  });
});
