import { describe, it, expect, afterEach, vi } from 'vitest';

import { MailboxMessage, Counter } from '../models/MailboxMessage.js';
import * as mongoMailbox from '../services/email/mailbox/mongoIpcMailbox.js';

/**
 * The Mongo primary mailbox shares its collection with the NICeMail browser
 * mailbox. Every query it makes must leave the NICeMail rows alone: they
 * belong to another Front Office, and a NICeMail row is the only record that
 * stops the next inbox sync storing a removed message again.
 *
 * No database: the model's methods are replaced, and what is asserted is the
 * filter each operation hands to MongoDB.
 */

const NOT_NICEMAIL = { source: { $ne: 'nic-browser' } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Mongo primary mailbox and NICeMail rows', () => {
  it('lists none, even for the NICeMail address', async () => {
    const find = vi.spyOn(MailboxMessage, 'find').mockReturnValue({ sort: async () => [] });

    await mongoMailbox.list('nic-mailbox@example.invalid');

    expect(find).toHaveBeenCalledWith(expect.objectContaining({ to: 'nic-mailbox@example.invalid', ...NOT_NICEMAIL }));
  });

  it('marks none ingested and deletes none', async () => {
    const update = vi.spyOn(MailboxMessage, 'findOneAndUpdate').mockResolvedValue(null);
    const remove = vi.spyOn(MailboxMessage, 'findOneAndDelete').mockResolvedValue(null);

    expect(await mongoMailbox.markIngested('nic-mailbox@example.invalid', 'NICB-1')).toBeNull();
    expect(await mongoMailbox.remove('nic-mailbox@example.invalid', 'NICB-1')).toBeNull();

    expect(update.mock.calls[0][0]).toMatchObject({ mailboxMessageId: 'NICB-1', ...NOT_NICEMAIL });
    expect(remove.mock.calls[0][0]).toMatchObject({ mailboxMessageId: 'NICB-1', ...NOT_NICEMAIL });
  });

  it('leaves them when it is reset, and does not count them after', async () => {
    const deleteMany = vi.spyOn(MailboxMessage, 'deleteMany').mockResolvedValue({});
    vi.spyOn(Counter, 'deleteOne').mockResolvedValue({});
    const count = vi.spyOn(MailboxMessage, 'countDocuments').mockResolvedValue(0);
    const distinct = vi.spyOn(MailboxMessage, 'distinct').mockResolvedValue([]);

    await mongoMailbox.reset();
    await mongoMailbox.stats();

    expect(deleteMany).toHaveBeenCalledWith(NOT_NICEMAIL);
    expect(count).toHaveBeenCalledWith(NOT_NICEMAIL);
    expect(distinct).toHaveBeenCalledWith('to', NOT_NICEMAIL);
  });
});
