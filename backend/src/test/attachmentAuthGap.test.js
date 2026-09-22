import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { AUTH } from './helpers/auth.js';

/**
 * Proves the guard is MOUNTED on every attachment route.
 *
 * It deliberately stubs `authorizeAttachmentAccess` out, so it says nothing
 * about whether access is denied — that is authorizeAttachmentAccess.test.js's
 * job, and since per-case narrowing landed that file does assert real denials.
 * What this one catches is the other failure: a route added later, or re-wired,
 * that never runs the guard at all. Both halves are needed, because a perfect
 * check on a route that does not call it protects nothing.
 *
 * (It was written when the middleware was a deliberate no-op seam and the
 * endpoints had no authentication, which is why it is shaped this way.)
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
    await request(app).post('/api/v1/attachments').set(AUTH).field('note', 'checking the seam runs');
    expect(authorizeSpy).toHaveBeenCalledTimes(1);
  });

  it('runs on GET /attachments/:id', async () => {
    await request(app).get('/api/v1/attachments/att_00000000-0000-4000-8000-000000000000').set(AUTH);
    expect(authorizeSpy).toHaveBeenCalledTimes(1);
  });

  it('runs on GET /attachments/:id/meta', async () => {
    await request(app).get('/api/v1/attachments/att_00000000-0000-4000-8000-000000000000/meta').set(AUTH);
    expect(authorizeSpy).toHaveBeenCalledTimes(1);
  });

  it('does not run on unrelated routes — it is scoped to attachments only', async () => {
    await request(app).get('/api/v1/health').set(AUTH);
    expect(authorizeSpy).not.toHaveBeenCalled();
  });
});
