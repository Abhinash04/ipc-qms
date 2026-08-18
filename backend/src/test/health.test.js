import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';

describe('GET /api/v1/health', () => {
  it('returns 200 with a healthy payload', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.service).toBe('qms-backend');
    expect(typeof res.body.timestamp).toBe('string');
  });
});

describe('unknown routes', () => {
  it('returns 404 with the requested path', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not Found');
    expect(res.body.path).toBe('/api/v1/does-not-exist');
  });
});
