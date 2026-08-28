import { describe, it, expect, vi } from 'vitest';
import authorizeAttachmentAccess from '../middleware/authorizeAttachmentAccess.js';

/**
 * The real, unmocked seam. It is a deliberate no-op today — see
 * backend/README.md "Security status: NOT production-ready" — this test
 * documents that fact so a future change to real authorization is a visible,
 * intentional diff here rather than a silent behaviour change.
 */
describe('authorizeAttachmentAccess (real implementation)', () => {
  it('calls next() with no error, regardless of the request', () => {
    const next = vi.fn();
    authorizeAttachmentAccess({}, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('never inspects or rejects based on request contents (no auth check exists yet)', () => {
    const next = vi.fn();
    // No Authorization header, no cookies, no req.user — still passes through.
    authorizeAttachmentAccess({ headers: {} }, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
