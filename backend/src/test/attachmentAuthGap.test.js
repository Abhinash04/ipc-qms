import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { AUTH } from './helpers/auth.js';

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
