import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { AUDIT_EVENT, PRIORITY, WORKFLOW_STATE } from '@/constants/statusEnums';
import { notify } from '@/services/notify';
import * as queryCaseService from '@/services/api/queryCaseService';
import { persistQueryTransition as writeOnServer } from '@/test/fakeQueryApi';
import { EXTERNAL_INQUIRER as INQUIRER } from '@/test/externalInquirer';

vi.mock('@/services/api/mailboxService');

vi.mock('@/services/api/queryCaseService', async () => {
  const fake = await import('@/test/fakeQueryApi');
  return { ...fake, persistQueryTransition: vi.fn(fake.persistQueryTransition) };
});

const s = () => useWorkflowStore.getState();
const FRONT_OFFICE = findUserById('USR-0002');

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const enquiry = () => ({
  mailboxMessageId: 'MSG-REFRESH-0001',
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Assay limits for the revised monograph',
  body: 'Please confirm the assay limits.',
  receivedAt: '2026-09-20T09:00:00.000Z',
});

async function receivedCase() {
  const { queryId } = s().ingestEmail(enquiry(), async () => null);
  await settled();
  return queryId;
}

const verify = (queryId) =>
  s().applyTransition({
    queryId,
    actor: FRONT_OFFICE,
    event: AUDIT_EVENT.QUERY_REGISTERED,
    patch: { workflowState: WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION },
    details: 'Front Office verified the query details and attachments.',
  });

beforeEach(async () => {
  vi.clearAllMocks();
  useWorkflowStore.setState({ hydrated: false });
  await s().hydrate();
  await s().resetDemo();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a background reload never undoes what the user just did', () => {
  it('keeps an optimistic change made while a reload was in flight', async () => {
    const queryId = await receivedCase();
    const audited = s().counters.AUD;

    const reload = s().refreshFromServer({ quiet: true });
    verify(queryId);

    expect(await reload).toBe(true);
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION);
    expect(s().counters.AUD).toBe(audited + 1);

    await settled();
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION);
    expect(s().getAudit(queryId).filter((e) => e.event === AUDIT_EVENT.QUERY_REGISTERED)).toHaveLength(1);
  });

  it('keeps unchanged cases as the same objects', async () => {
    const queryId = await receivedCase();
    const queries = s().queries;
    const query = s().getQuery(queryId);

    await s().refreshFromServer({ quiet: true });

    expect(s().queries).toBe(queries);
    expect(s().getQuery(queryId)).toBe(query);
  });

  it("picks up a colleague's change written straight to the server", async () => {
    const queryId = await receivedCase();
    const threads = s().emailThreads;

    await writeOnServer({ query: { ...s().getQuery(queryId), priority: PRIORITY.URGENT } });
    await s().refreshFromServer({ quiet: true });

    expect(s().getQuery(queryId).priority).toBe(PRIORITY.URGENT);
    expect(s().emailThreads).toBe(threads);
  });

  it("picks up a colleague's new case once a change of its own is saved", async () => {
    const queryId = await receivedCase();
    await writeOnServer({
      query: { ...s().getQuery(queryId), queryId: 'QRY-2026-00999', createdAt: '2026-09-20T10:00:00.000Z' },
    });

    verify(queryId);

    await vi.waitFor(() => {
      expect(s().getQuery('QRY-2026-00999')).not.toBeNull();
    });
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION);
  });

  it('writes nothing once the user has signed out', async () => {
    const queryId = await receivedCase();

    const reload = s().refreshFromServer({ quiet: true });
    s().resetHydration();

    expect(await reload).toBe(false);
    expect(s().hydrated).toBe(false);
    expect(s().getQuery(queryId)).toBeNull();
  });

  it('reloads the saved state and says why when the server refuses a change', async () => {
    const failed = vi.spyOn(notify, 'error').mockImplementation(() => {});
    const queryId = await receivedCase();
    const audited = s().counters.AUD;
    vi.mocked(queryCaseService.persistQueryTransition).mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 409'), {
        response: { status: 409, data: { error: 'This case was changed by someone else.' } },
      }),
    );

    verify(queryId);
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION);

    await vi.waitFor(() => {
      expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.RECEIVED);
    });
    expect(s().counters.AUD).toBe(audited);
    expect(s().getAudit(queryId).some((e) => e.event === AUDIT_EVENT.QUERY_REGISTERED)).toBe(false);
    expect(failed).toHaveBeenCalledWith(
      'Changes were not saved',
      'This case was changed by someone else.',
      { id: 'query-persistence-failed' },
    );
  });
});
