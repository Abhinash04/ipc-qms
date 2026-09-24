import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ROLES } from '../constants/roles.js';

const store = { getMetadata: vi.fn() };
vi.mock('../services/attachments/attachmentStore.js', () => store);

const party = { value: true };
vi.mock('../services/authz/caseAccess.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, isPartyToCase: vi.fn(async () => party.value) };
});

vi.mock('../models/index.js', () => ({ EmailMessage: { findOne: vi.fn() } }));
vi.mock('../config/db.js', async (importOriginal) => ({ ...(await importOriginal()), isConnected: () => true }));

const { default: authorizeAttachmentAccess, resolveAttachmentCase } = await import(
  '../middleware/authorizeAttachmentAccess.js'
);
const { EmailMessage } = await import('../models/index.js');

const run = async (req) => {
  const next = vi.fn();
  await authorizeAttachmentAccess({ params: {}, body: {}, ...req }, {}, next);
  return next;
};

const OUTSIDER = { id: 'USR-0005', role: ROLES.REVIEWER };
const OFFICIAL = { id: 'USR-0004', role: ROLES.ASSIGNED_OFFICIAL };
const SUPER_ADMIN = { id: 'USR-0008', role: ROLES.SUPER_ADMIN };

beforeEach(() => {
  party.value = true;
  store.getMetadata.mockReset().mockResolvedValue(null);
});

describe('fail-closed basics', () => {
  it('rejects with 401 when no authenticated user reached it', async () => {
    const next = await run({ headers: {} });

    expect(next).toHaveBeenCalledTimes(1);
    const [error] = next.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(401);
  });

  it('passes an unknown attachment through for the controller to 404', async () => {
    store.getMetadata.mockResolvedValue(null);

    const next = await run({ user: OUTSIDER, params: { id: 'att_missing' } });

    expect(next).toHaveBeenCalledWith();
  });

  it('passes a malformed id through rather than turning the throw into a 500', async () => {
    store.getMetadata.mockRejectedValue(new Error('attachmentStore: invalid id'));

    const next = await run({ user: OUTSIDER, params: { id: 'not-an-id' } });

    expect(next).toHaveBeenCalledWith();
  });
});

describe('reading an attachment that belongs to a case', () => {
  const meta = { attachmentId: 'att_x', queryId: 'QRY-2026-00001', uploadedBy: 'USR-0002' };

  it('admits a principal party to that case', async () => {
    store.getMetadata.mockResolvedValue(meta);
    party.value = true;

    expect(await run({ user: OFFICIAL, params: { id: 'att_x' } })).toHaveBeenCalledWith();
  });

  it('refuses a principal who is not', async () => {
    store.getMetadata.mockResolvedValue(meta);
    party.value = false;

    const next = await run({ user: OUTSIDER, params: { id: 'att_x' } });

    const [error] = next.mock.calls[0];
    expect(error?.status).toBe(403);
  });

  it('admits a role that sees every case without consulting membership', async () => {
    store.getMetadata.mockResolvedValue(meta);
    party.value = false;

    expect(await run({ user: SUPER_ADMIN, params: { id: 'att_x' } })).toHaveBeenCalledWith();
  });
});

describe('an attachment saved from a NICeMail message', () => {
  const NIC_ID = '1790067280420134900';
  const meta = { attachmentId: 'att_nic', queryId: null, uploadedBy: null, providerMessageId: NIC_ID };
  const storedAs = (queryId) =>
    EmailMessage.findOne.mockReset().mockReturnValue({ select: () => ({ lean: async () => (queryId ? { queryId } : null) }) });

  it('finds its case through the NICeMail id the message is stored with', async () => {
    storedAs('QRY-2026-00004');

    expect(await resolveAttachmentCase(meta)).toBe('QRY-2026-00004');
    expect(EmailMessage.findOne).toHaveBeenCalledWith({
      $or: [{ sourceMessageId: NIC_ID }, { providerMessageId: NIC_ID, direction: 'INBOUND' }],
    });
  });

  it('admits an official on that case', async () => {
    storedAs('QRY-2026-00004');
    store.getMetadata.mockResolvedValue(meta);
    party.value = true;

    expect(await run({ user: OFFICIAL, params: { id: 'att_nic' } })).toHaveBeenCalledWith();
  });
});

describe('an attachment with no case yet', () => {
  it('admits the uploader to their own', async () => {
    store.getMetadata.mockResolvedValue({ queryId: null, uploadedBy: 'USR-0005' });

    expect(await run({ user: OUTSIDER, params: { id: 'att_x' } })).toHaveBeenCalledWith();
  });

  it('refuses anyone else', async () => {
    store.getMetadata.mockResolvedValue({ queryId: null, uploadedBy: 'USR-0002' });

    const [error] = (await run({ user: OUTSIDER, params: { id: 'att_x' } })).mock.calls[0];
    expect(error?.status).toBe(403);
  });

  it('refuses a scoped role when no uploader was recorded', async () => {
    store.getMetadata.mockResolvedValue({ queryId: null, uploadedBy: null });

    const [error] = (await run({ user: OFFICIAL, params: { id: 'att_x' } })).mock.calls[0];
    expect(error?.status).toBe(403);
  });

  it('still admits a role that sees every case', async () => {
    store.getMetadata.mockResolvedValue({ queryId: null, uploadedBy: null });

    expect(await run({ user: SUPER_ADMIN, params: { id: 'att_x' } })).toHaveBeenCalledWith();
  });
});

describe('uploading', () => {
  it('allows an upload that names no case', async () => {
    expect(await run({ user: OUTSIDER, body: {} })).toHaveBeenCalledWith();
  });

  it('refuses planting a document on a case the caller is not party to', async () => {
    party.value = false;

    const next = await run({ user: OUTSIDER, body: { queryId: 'QRY-SOMEONE-ELSE' } });

    const [error] = next.mock.calls[0];
    expect(error?.status).toBe(403);
  });

  it('allows an upload onto the caller own case', async () => {
    party.value = true;

    expect(await run({ user: OFFICIAL, body: { queryId: 'QRY-MINE' } })).toHaveBeenCalledWith();
  });
});
