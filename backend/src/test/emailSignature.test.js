import { describe, it, expect } from 'vitest';
import * as letter from '../services/email/templates/signature.js';
import { ACKNOWLEDGEMENT_BODY, buildAcknowledgement } from '../services/email/templates/acknowledgement.js';
import * as composer from '../../../frontend/src/services/ai/draftComposer.js';

const { IPC_SIGNATURE, IPC_DISCLAIMER, withOfficialClosing } = letter;

const STANDARD_SIGNATURE = [
  'Thanks & regards,',
  'O/o Secretary-cum-Scientific Director',
  'Indian Pharmacopoeia Commission',
  'Ghaziabad',
].join('\n');

const STANDARD_DISCLAIMER =
  'This response is being provided for informational purposes only with respect to specific query on the subject. ' +
  'This shall not be treated as an official interpretation of Indian Pharmacopoeia (IP) standard or relied on to ' +
  'demonstrate compliance with IP requirements.';

const closed = (body) => `${body}\n\n${IPC_DISCLAIMER}\n\n${IPC_SIGNATURE}`;

describe('the IPC house style', () => {
  it('signs off as the Office of the Secretary-cum-Scientific Director', () => {
    expect(IPC_SIGNATURE).toBe(STANDARD_SIGNATURE);
  });

  it('carries the standard informational-purposes disclaimer', () => {
    expect(IPC_DISCLAIMER).toBe(STANDARD_DISCLAIMER);
  });

  it.each([
    ['Ms. Pujan Mehta', 'Madam,'],
    ['Mrs Kavita Rao', 'Madam,'],
    ['Smt. Asha Devi', 'Madam,'],
    ['Mr. Dibakar Banerjee', 'Sir,'],
    ['Shri Ram Kumar', 'Sir,'],
    ['Dr. Neha Singh', 'Sir/Madam,'],
    ['Sambhaji Shelar', 'Sir/Madam,'],
    ['', 'Sir/Madam,'],
  ])('greets %j as %s', (name, salutation) => {
    expect(letter.salutationFor(name)).toBe(salutation);
  });

  it('addresses the inquirer by name and email, with the firm only when it is known', () => {
    expect(letter.addressBlock({ name: 'Ms. Pujan Mehta', email: 'Pujan_Mehta@intaspharma.com' })).toBe(
      'To,\nMs. Pujan Mehta <Pujan_Mehta@intaspharma.com>',
    );
    expect(
      letter.addressBlock({ name: 'Mr. Dibakar Banerjee', email: 'd.banerjee@emceepharma.com', organization: 'Emcee Pharmaceuticals Pvt. Ltd.' }),
    ).toBe('To,\nMr. Dibakar Banerjee <d.banerjee@emceepharma.com>\nM/s Emcee Pharmaceuticals Pvt. Ltd.');
    expect(letter.addressBlock({ name: 'a@b.example', email: 'a@b.example' })).toBe('To,\na@b.example');
  });

  it.each([
    ['Clarification Required on Lactose Monohydrate Monograph', 'Sub: Clarification Required on Lactose Monohydrate Monograph -reg.'],
    ['Re: Fwd: 2.5.3. Weight Variation of IP 2026', 'Sub: 2.5.3. Weight Variation of IP 2026 -reg.'],
    ['Water for Injection: Microbial Testing – reg.', 'Sub: Water for Injection: Microbial Testing -reg.'],
    ['', 'Sub: Your query -reg.'],
  ])('writes the subject %j as %j', (subject, line) => {
    expect(letter.subjectLine(subject)).toBe(line);
  });

  it('dates the reference as DD.MM.YYYY in Indian time, or leaves the date out', () => {
    expect(letter.referenceSentence('2026-09-10T08:00:00.000Z')).toBe(
      'This is in reference to your email dated 10.09.2026 on the subject matter cited above.',
    );
    expect(letter.formatLetterDate('2026-08-31T20:00:00.000Z')).toBe('01.09.2026');
    expect(letter.referenceSentence('not a date')).toBe(
      'This is in reference to your email on the subject matter cited above.',
    );
  });

  it('renders exactly as the AI draft composer does', () => {
    const inquirer = { name: 'Ms. Pujan Mehta', email: 'pujan@intas.example' };
    expect(composer.IPC_SIGNATURE).toBe(IPC_SIGNATURE);
    expect(composer.IPC_DISCLAIMER).toBe(IPC_DISCLAIMER);
    expect(composer.IPC_GREETING).toBe(letter.IPC_GREETING);
    expect(composer.letterOpening({ inquirer, subject: 'Re: Lactose' })).toBe(letter.letterOpening({ inquirer, subject: 'Re: Lactose' }));
    expect(composer.referenceSentence('2026-09-10T08:00:00.000Z')).toBe(letter.referenceSentence('2026-09-10T08:00:00.000Z'));
  });
});

describe('the acknowledgement', () => {
  const ack = buildAcknowledgement({
    to: 'pujan@intas.example',
    fromEmail: 'fo@ipc.example',
    queryId: 'QRY-2026-00001',
    inquirerName: 'Ms. Pujan Mehta',
    subject: 'Clarification Required on Lactose Monohydrate Monograph',
    receivedAt: '2026-09-10T08:00:00.000Z',
  });

  it('opens like the sample letters', () => {
    expect(ack.body.startsWith(
      'To,\nMs. Pujan Mehta <pujan@intas.example>\n\n' +
        'Sub: Clarification Required on Lactose Monohydrate Monograph -reg.\n\n' +
        'Madam,\nGreetings from Indian Pharmacopoeia Commission (IPC)!\n\n' +
        'This is in reference to your email dated 10.09.2026 on the subject matter cited above. ' +
        'This is to acknowledge that your query has been duly received and forwarded to the concerned division for examination.',
    )).toBe(true);
  });

  it('keeps the signature and the auto-generated notice, but no disclaimer', () => {
    expect(ack.body).toContain(`\n\n${IPC_SIGNATURE}\n\nThis is an auto-generated email. Please do not reply to this message.`);
    expect(ack.body).not.toContain(IPC_DISCLAIMER);
    expect(ack.body).not.toMatch(/AR&D|Division\b/);
  });

  it('keeps the header subject as before', () => {
    expect(ack.subject).toBe('Acknowledgement of Query Received – Indian Pharmacopoeia Commission [QRY-2026-00001]');
  });

  it('still renders sensibly with nothing known about the inquirer', () => {
    expect(ACKNOWLEDGEMENT_BODY).toContain('Sir/Madam,\nGreetings from Indian Pharmacopoeia Commission (IPC)!');
    expect(ACKNOWLEDGEMENT_BODY).toContain('This is in reference to your email on the subject matter cited above.');
  });
});

describe('closing a final reply', () => {
  it('adds the disclaimer and the signature to an unsigned reply', () => {
    expect(withOfficialClosing('This is to inform you that the limit is 0.5%.')).toBe(
      closed('This is to inform you that the limit is 0.5%.'),
    );
  });

  it('is idempotent and never duplicates the disclaimer or the signature', () => {
    const once = closed('The limit is 0.5%.');
    expect(withOfficialClosing(once)).toBe(once);
    expect(withOfficialClosing(`${once}\n\n  \n`)).toBe(once);
    expect(withOfficialClosing(once.replace(/\n/g, '\r\n'))).toBe(once);
  });

  it('keeps a disclaimer the official already placed, even with different line wrapping', () => {
    const wrapped = `The limit is 0.5%.\n\n${IPC_DISCLAIMER.replace('subject. ', 'subject.\n')}`;
    expect(withOfficialClosing(wrapped)).toBe(`${wrapped}\n\n${IPC_SIGNATURE}`);
  });

  it('replaces an older sign-off with the standard one', () => {
    const old = 'The limit is 0.5%.\n\nRegards,\nIndian Pharmacopoeia Commission (IPC)\nMinistry of Health & Family Welfare\nGovernment of India';
    expect(withOfficialClosing(old)).toBe(closed('The limit is 0.5%.'));
    const divisional = 'The limit is 0.5%.\n\nRegards,\nAR&D Division\nIndian Pharmacopoeia Commission';
    expect(withOfficialClosing(divisional)).toBe(closed('The limit is 0.5%.'));
  });

  it.each(['Thanks & regards,', 'Thanks and regards,', 'Yours faithfully,', 'Best regards,', 'Sincerely,'])(
    'replaces a closing that starts with "%s"',
    (closing) => {
      const text = `The limit is 0.5%.\n\n${closing}\nDr. A. Kumar\nPrincipal Scientific Officer`;
      expect(withOfficialClosing(text)).toBe(closed('The limit is 0.5%.'));
    },
  );

  it('removes a draft marker so it never reaches the inquirer', () => {
    expect(withOfficialClosing('[FIRST DRAFT]\n\nThe limit is 0.5%.')).toBe(closed('The limit is 0.5%.'));
    expect(
      withOfficialClosing('[AI-GENERATED FIRST DRAFT — requires review and editing by the assigned official before it can proceed.]\n\nThe limit is 0.5%.'),
    ).toBe(closed('The limit is 0.5%.'));
  });

  it('keeps a "regards" that is part of the answer rather than a closing', () => {
    const text = 'With regards to the dissolution test, the limit is 80% (Q).';
    expect(withOfficialClosing(text)).toBe(closed(text));
  });

  it('closes an empty reply with the disclaimer and signature alone', () => {
    expect(withOfficialClosing('')).toBe(`${IPC_DISCLAIMER}\n\n${IPC_SIGNATURE}`);
  });
});
