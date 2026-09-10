import { describe, it, expect, vi } from 'vitest';
import authorizeAttachmentAccess from '../middleware/authorizeAttachmentAccess.js';

/**
 * The real, unmocked seam.
 *
 * It was a deliberate no-op while the backend had no authentication at all.
 * Now that `verifyToken` runs ahead of it on every attachment route, it is a
 * real fail-closed guard: it lets an authenticated caller through and rejects
 * anything that reaches it without `req.user` — which can only happen if a
 * route is mis-wired to omit `verifyToken`.
 *
 * Per-case narrowing is still outstanding; see the TODO on the middleware.
 */
describe('authorizeAttachmentAccess (real implementation)', () => {
  it('calls next() with no error when the request is authenticated', () => {
    const next = vi.fn();
    authorizeAttachmentAccess({ user: { id: 'USR-0002', role: 'FRONT_OFFICE' } }, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('fails closed with 401 when no authenticated user reached it', () => {
    const next = vi.fn();
    // A route that forgot verifyToken must break loudly, not silently open.
    authorizeAttachmentAccess({ headers: {} }, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    const [error] = next.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(401);
  });

  it('does not yet narrow by case — any authenticated role passes', () => {
    const next = vi.fn();
    authorizeAttachmentAccess({ user: { id: 'USR-0001', role: 'INQUIRER' }, params: { id: 'att_x' } }, {}, next);
    expect(next).toHaveBeenCalledWith();
  });
});
