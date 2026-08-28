import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * Documents and guards the security gap recorded in backend/README.md
 * ("Security status: NOT production-ready"): the attachment endpoints have
 * no authentication in this backend, so `authorizeAttachmentAccess` is a
 * deliberate no-op seam rather than a real check. This test does not (and
 * cannot) prove access is denied — it proves the seam is mounted on every
 * attachment route's request path, so the day real authorization lands
 * there is exactly one place to fill in and every route already runs it.
 *
 * The real pass-through behaviour itself is covered separately in
 * authorizeAttachmentAccess.test.js, without any mocking.
 *
 * vi.mock is hoisted above the imports below, so the mock is in place before
 * app.js (and therefore attachmentRoutes.js) is loaded and the middleware is
 * wired into the router — spying on the already-bound reference after the
 * fact would not work, since Express captures the function value once at
 * route-registration time.
 */
const authorizeSpy = vi.fn((req, res, next) => next());
vi.mock('../middleware/authorizeAttachmentAccess.js', () => ({ default: authorizeSpy }));

const { default: app } = await import('../app.js');

beforeEach(() => {
  authorizeSpy.mockClear();
});

describe('authorizeAttachmentAccess seam is on every attachment route', () => {
  it('runs on POST /attachments', async () => {
    await request(app).post('/api/v1/attachments').field('note', 'checking the seam runs');
    expect(authorizeSpy).toHaveBeenCalledTimes(1);
  });

  it('runs on GET /attachments/:id', async () => {
    await request(app).get('/api/v1/attachments/att_00000000-0000-4000-8000-000000000000');
    expect(authorizeSpy).toHaveBeenCalledTimes(1);
  });

  it('runs on GET /attachments/:id/meta', async () => {
    await request(app).get('/api/v1/attachments/att_00000000-0000-4000-8000-000000000000/meta');
    expect(authorizeSpy).toHaveBeenCalledTimes(1);
  });

  it('does not run on unrelated routes — it is scoped to attachments only', async () => {
    await request(app).get('/api/v1/health');
    expect(authorizeSpy).not.toHaveBeenCalled();
  });
});
