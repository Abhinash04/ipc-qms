import { describe, it, expect, beforeEach, vi } from 'vitest';

import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import {
  assembleDraftEmail,
  IPC_SIGNATURE,
  NOT_ESTABLISHED_SENTENCE,
  PARTIAL_GAP_SENTENCE,
} from '@/services/ai/draftComposer';

vi.mock('@/services/api/mailboxService');

const s = () => useWorkflowStore.getState();

const FRONT_OFFICE = findUserById('USR-0002');
const OIC = findUserById('USR-0003');
const OFFICIAL = findUserById('USR-0004');
const INQUIRER = findUserById('USR-0001');

const fakeForward = (payload) =>
  Promise.resolve({
    from: 'Test Front Officer <front-office@test.invalid>',
    to: ['officer@test.invalid'],
    subject: `Fwd: ${payload.subject}`,
    body: payload.body,
    providerMessageId: 'mock-msg-forward',
    providerThreadId: 'mock-thread-1',
    sentAt: '2026-08-18T10:00:00.000Z',
  });

const enquiry = () => ({
  mailboxMessageId: 'MSG-00001',
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Clarification on monograph revision',
  body: 'Please clarify the applicable monograph.',
  receivedAt: '2026-08-18T09:00:00.000Z',
});

const GEMMA_DRAFT = {
  subject: 'Response regarding monograph revision',
  paragraphs: ['The monograph is under revision.', 'The current edition remains in force.'],
  unanswered: ['The product batch number was not supplied.'],
  termsUsed: ['IP'],
  aiGenerated: true,
  fallback: false,
};

async function assignedQuery() {
  const { queryId } = s().ingestEmail(enquiry());
  s().verifyQuery(queryId, FRONT_OFFICE);
  await s().forwardToOic(queryId, FRONT_OFFICE, fakeForward);
  s().assignQuery(queryId, OFFICIAL.id, OIC);
  return queryId;
}

beforeEach(async () => {
  await s().hydrate();
  await s().resetDemo();
});

describe('assembleDraftEmail keeps identity out of the model’s hands', () => {
  const query = {
    queryId: 'QRY-2026-00001',
    subject: 'Monograph revision',
    inquirer: { name: 'Abhinash Pritiraj', email: 'a@example.com' },
  };

  it('greets the real inquirer from query data', () => {
    const email = assembleDraftEmail({ query, draft: GEMMA_DRAFT });
    expect(email).toContain('Dear Abhinash Pritiraj,');
  });

  it('ends with the constant IPC signature', () => {
    expect(assembleDraftEmail({ query, draft: GEMMA_DRAFT }).endsWith(IPC_SIGNATURE)).toBe(true);
  });

  it('quotes the real query id as the reference', () => {
    expect(assembleDraftEmail({ query, draft: GEMMA_DRAFT })).toContain('QRY-2026-00001');
  });

  it('never lets a model-supplied name reach the output', () => {
    const poisoned = {
      ...GEMMA_DRAFT,
      recipient: 'Dr Someone Else',
      signature: 'Dr Invented Officer, Scientific Officer',
      paragraphs: ['A clean paragraph.'],
    };
    const email = assembleDraftEmail({ query, draft: poisoned });
    expect(email).not.toContain('Dr Someone Else');
    expect(email).not.toContain('Dr Invented Officer');
  });

  it('renders unanswered items as an explicit block', () => {
    const email = assembleDraftEmail({ query, draft: GEMMA_DRAFT });
    expect(email).toContain('could not be answered');
    expect(email).toContain('1. The product batch number was not supplied.');
  });

  it('omits the unanswered block when the model answered everything', () => {
    const email = assembleDraftEmail({ query, draft: { ...GEMMA_DRAFT, unanswered: [] } });
    expect(email).not.toContain('could not be answered');
  });

  it('returns an empty string when there is nothing to compose', () => {
    expect(assembleDraftEmail({ query, draft: { paragraphs: [] } })).toBe('');
    expect(assembleDraftEmail({ query: null, draft: GEMMA_DRAFT })).toBe('');
  });

  it('falls back to a neutral salutation when the inquirer has no name', () => {
    const anonymous = { ...query, inquirer: { email: 'a@example.com' } };
    expect(assembleDraftEmail({ query: anonymous, draft: GEMMA_DRAFT })).toContain('Dear Sir/Madam,');
  });
});

describe('assembleDraftEmail renders one numbered section per question', () => {
  const query = {
    queryId: 'QRY-2026-00004',
    subject: 'Degradation products and excipient compatibility',
    inquirer: { name: 'Abhinash Pritiraj', email: 'a@example.com' },
  };

  const SECTIONED = {
    subject: 'Response regarding degradation products and excipient compatibility',
    answers: [
      {
        question: 1,
        questionText:
          'The impurity appears above the identification threshold. Is characterisation required?',
        sufficiency: 'PARTIAL',
        paragraphs: ['Related substances in IP monographs are controlled by chromatographic methods.'],
        sources: ['GD-10#37', 'FAQ#20'],
      },
      {
        question: 2,
        questionText: 'Is there published guidance on excipient compatibility study design?',
        sufficiency: 'NOT_ESTABLISHED',
        paragraphs: [],
        sources: [],
      },
      {
        question: 3,
        questionText: 'Would a change of excipient require a fresh stability commitment?',
        sufficiency: 'NOT_ESTABLISHED',
        paragraphs: [],
        sources: [],
      },
    ],
  };

  it('numbers every question', () => {
    const email = assembleDraftEmail({ query, draft: SECTIONED });
    expect(email).toContain('1. The impurity appears above the identification threshold');
    expect(email).toContain('2. Is there published guidance on excipient compatibility');
    expect(email).toContain('3. Would a change of excipient require a fresh stability commitment?');
  });

  it('answers the question the IPC material supports', () => {
    const email = assembleDraftEmail({ query, draft: SECTIONED });
    expect(email).toContain('Related substances in IP monographs are controlled');
  });

  it('states plainly where the IPC material does not establish an answer', () => {
    const email = assembleDraftEmail({ query, draft: SECTIONED });
    const occurrences = email.split(NOT_ESTABLISHED_SENTENCE).length - 1;
    expect(occurrences).toBe(2);
  });

  it('keeps per-answer source traceability', () => {
    expect(assembleDraftEmail({ query, draft: SECTIONED })).toContain('Sources: GD-10#37; FAQ#20');
  });

  it('renders the model’s own statement of what is not settled', () => {
    const withGap = {
      answers: [
        {
          question: 1,
          questionText: 'Is characterisation required?',
          sufficiency: 'PARTIAL',
          paragraphs: ['Related substances are controlled by chromatographic methods.'],
          notEstablished: 'The material does not settle the identification threshold question.',
          sources: ['GD-10#37'],
        },
      ],
    };
    const email = assembleDraftEmail({ query, draft: withGap });
    expect(email).toContain('The material does not settle the identification threshold question.');
  });

  it('supplies a fallback gap sentence when the model omits one on a PARTIAL answer', () => {
    const noGap = {
      answers: [
        {
          question: 1,
          questionText: 'Is characterisation required?',
          sufficiency: 'PARTIAL',
          paragraphs: ['Related substances are controlled by chromatographic methods.'],
          sources: [],
        },
      ],
    };
    expect(assembleDraftEmail({ query, draft: noGap })).toContain(PARTIAL_GAP_SENTENCE);
  });

  it('does not append a gap sentence to a fully ANSWERED question', () => {
    const answered = {
      answers: [
        {
          question: 1,
          questionText: 'Where can I buy the IP?',
          sufficiency: 'ANSWERED',
          paragraphs: ['Copies are available directly from the IPC.'],
          sources: [],
        },
      ],
    };
    const email = assembleDraftEmail({ query, draft: answered });
    expect(email).not.toContain(PARTIAL_GAP_SENTENCE);
    expect(email).not.toContain(NOT_ESTABLISHED_SENTENCE);
  });

  it('does not collapse the questions into one unanswered list', () => {
    expect(assembleDraftEmail({ query, draft: SECTIONED })).not.toContain('could not be answered');
  });

  it('still greets the real inquirer and signs off constantly', () => {
    const email = assembleDraftEmail({ query, draft: SECTIONED });
    expect(email).toContain('Dear Abhinash Pritiraj,');
    expect(email.endsWith(IPC_SIGNATURE)).toBe(true);
    expect(email).toContain('QRY-2026-00004');
  });

  it('falls back to the not-established sentence when a section has no paragraphs', () => {
    const empty = { answers: [{ question: 1, questionText: 'A question?', sufficiency: 'PARTIAL', paragraphs: [] }] };
    expect(assembleDraftEmail({ query, draft: empty })).toContain(NOT_ESTABLISHED_SENTENCE);
  });

  it('truncates an over-long question headline', () => {
    const long = {
      answers: [
        {
          question: 1,
          questionText: 'x'.repeat(300),
          sufficiency: 'NOT_ESTABLISHED',
          paragraphs: [],
        },
      ],
    };
    expect(assembleDraftEmail({ query, draft: long })).toContain('…');
  });
});

describe('generateAiDraft mints exactly one version', () => {
  it('uses the Gemma draft when the service returns one', async () => {
    const queryId = await assignedQuery();
    await s().generateAiDraft(queryId, OFFICIAL, async () => GEMMA_DRAFT);

    const versions = s().getVersions(queryId);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe('v1');
    expect(versions[0].createdBy).toBe('Gemma AI Draft Assistant');
    expect(versions[0].content).toContain('The monograph is under revision.');
    expect(versions[0].content).toContain(INQUIRER.name);
  });

  it('passes the query, summary and key points to the service', async () => {
    const queryId = await assignedQuery();
    const fetchDraft = vi.fn().mockResolvedValue(GEMMA_DRAFT);
    await s().generateAiDraft(queryId, OFFICIAL, fetchDraft);

    const payload = fetchDraft.mock.calls[0][0];
    expect(payload.subject).toBe('Clarification on monograph revision');
    expect(payload.inquirerName).toBe(INQUIRER.name);
    expect(typeof payload.summaryText).toBe('string');
    expect(Array.isArray(payload.keyPoints)).toBe(true);
  });

  it('falls back to the template draft when the service returns null', async () => {
    const queryId = await assignedQuery();
    await s().generateAiDraft(queryId, OFFICIAL, async () => null);

    const versions = s().getVersions(queryId);
    expect(versions).toHaveLength(1);
    expect(versions[0].createdBy).toBe('AI Draft Assistant');
    expect(versions[0].content).toContain('AI-GENERATED FIRST DRAFT');
  });

  it('falls back rather than failing when the service rejects', async () => {
    const queryId = await assignedQuery();
    await s().generateAiDraft(queryId, OFFICIAL, async () => {
      throw new Error('backend down');
    });

    const versions = s().getVersions(queryId);
    expect(versions).toHaveLength(1);
    expect(versions[0].createdBy).toBe('AI Draft Assistant');
  });

  it('treats a fallback draft from the backend as a fallback, not as Gemma output', async () => {
    const queryId = await assignedQuery();
    await s().generateAiDraft(queryId, OFFICIAL, async () => ({
      ...GEMMA_DRAFT,
      aiGenerated: false,
      fallback: true,
    }));

    expect(s().getVersions(queryId)[0].createdBy).toBe('AI Draft Assistant');
  });

  it('refuses a role that may not draft, before calling the service', async () => {
    const queryId = await assignedQuery();
    const fetchDraft = vi.fn();

    await expect(s().generateAiDraft(queryId, OIC, fetchDraft)).rejects.toThrow(
      /may not perform GENERATE_AI_DRAFT/,
    );
    expect(fetchDraft).not.toHaveBeenCalled();
    expect(s().getVersions(queryId)).toHaveLength(0);
  });
});
