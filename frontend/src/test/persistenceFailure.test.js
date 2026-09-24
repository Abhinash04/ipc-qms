import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { replaceAll } from '@/services/persistence/queryState';
import { notify } from '@/services/notify';
import * as queryCaseService from '@/services/api/queryCaseService';

vi.mock('@/services/api/queryCaseService', () => ({
  fetchAllQueries: vi.fn(async () => ({ queries: [] })),
  checkQueriesEmpty: vi.fn(async () => true),
  resetQueries: vi.fn(async () => ({ success: true })),
  persistQueryTransition: vi.fn(async () => ({ success: true })),
}));

const refused = (data) =>
  Object.assign(new Error('Request failed with status code 409'), {
    response: { status: 409, data },
  });

let failed;

beforeEach(() => {
  vi.clearAllMocks();
  failed = vi.spyOn(notify, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a change the server refuses with 409', () => {
  it('shows the reason the server gave', async () => {
    const reason = 'Resetting the workflow state is refused on a shared database.';
    vi.mocked(queryCaseService.resetQueries).mockRejectedValueOnce(refused({ error: reason }));

    await expect(replaceAll({ queries: [] })).rejects.toThrow('status code 409');

    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith('Changes were not saved', reason, {
      id: 'query-persistence-failed',
    });
  });

  it('says the server refused it when no reason came back', async () => {
    vi.mocked(queryCaseService.resetQueries).mockRejectedValueOnce(refused(undefined));

    await expect(replaceAll({ queries: [] })).rejects.toThrow('status code 409');

    expect(failed).toHaveBeenCalledWith('Changes were not saved', 'The server refused this change.', {
      id: 'query-persistence-failed',
    });
  });
});
