import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import env from '../config/env.js';
import { resetRegisteredUsers } from '../controllers/authController.js';
import * as googleAuthService from '../services/auth/googleAuthService.js';

describe('Google Auth API & Verification (POST /api/auth/google & /api/v1/auth/google)', () => {
  beforeEach(() => {
    resetRegisteredUsers();
    vi.restoreAllMocks();
  });

  it('returns 503 GOOGLE_NOT_CONFIGURED when GOOGLE_CLIENT_ID is not configured', async () => {
    const originalEnvId = env.GOOGLE_CLIENT_ID;
    const originalProcessId = process.env.GOOGLE_CLIENT_ID;
    env.GOOGLE_CLIENT_ID = '';
    delete process.env.GOOGLE_CLIENT_ID;

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'some-token', department: 'Quality Assurance' });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('GOOGLE_NOT_CONFIGURED');
    expect(res.body.message).toMatch(/Google Sign Up is not configured yet/i);

    env.GOOGLE_CLIENT_ID = originalEnvId;
    if (originalProcessId) process.env.GOOGLE_CLIENT_ID = originalProcessId;
  });

  it('returns 400 MISSING_CREDENTIAL when credential payload is missing', async () => {
    const res = await request(app)
      .post('/api/auth/google')
      .send({ department: 'Quality Assurance' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('MISSING_CREDENTIAL');
  });

  it('returns 400 DEPARTMENT_REQUIRED when registering a new Google user without department', async () => {
    vi.spyOn(googleAuthService, 'verifyGoogleToken').mockResolvedValue({
      sub: 'google-sub-123',
      email: 'new.google.user@example.com',
      name: 'Google User',
      picture: 'https://example.com/photo.jpg',
    });

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'valid-token-123' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('DEPARTMENT_REQUIRED');
    expect(res.body.message).toMatch(/select a Department/i);
  });

  it('successfully registers a new Google user with role INQUIRER', async () => {
    vi.spyOn(googleAuthService, 'verifyGoogleToken').mockResolvedValue({
      sub: 'google-sub-123',
      email: 'new.google.user@example.com',
      name: 'Google User',
      picture: 'https://example.com/photo.jpg',
    });

    const res = await request(app)
      .post('/api/auth/google')
      .send({
        credential: 'valid-token-123',
        department: 'Regulatory Affairs',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toMatchObject({
      name: 'Google User',
      email: 'new.google.user@example.com',
      role: 'INQUIRER',
      department: 'Regulatory Affairs',
    });

    const cookie = res.headers['set-cookie'];
    expect(cookie).toBeDefined();
  });

  it('enforces role INQUIRER even if frontend sends a privileged role', async () => {
    vi.spyOn(googleAuthService, 'verifyGoogleToken').mockResolvedValue({
      sub: 'google-sub-456',
      email: 'hacker.google@example.com',
      name: 'Hacker User',
      picture: '',
    });

    const res = await request(app)
      .post('/api/auth/google')
      .send({
        credential: 'valid-token-456',
        department: 'IT',
        role: 'SUPER_ADMIN',
      });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('INQUIRER');
  });

  it('authenticates existing Google user on subsequent logins without duplicating user', async () => {
    vi.spyOn(googleAuthService, 'verifyGoogleToken').mockResolvedValue({
      sub: 'google-sub-789',
      email: 'repeat.google@example.com',
      name: 'Repeat Google User',
      picture: 'https://example.com/repeat.jpg',
    });

    const regRes = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'token-789', department: 'Pharmacopoeia' });

    expect(regRes.status).toBe(201);

    const loginRes = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'token-789', department: 'Different Department' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.user.department).toBe('Pharmacopoeia');
  });

  it('rejects Google authentication when email belongs to an existing local account (LOCAL_ACCOUNT_EXISTS)', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Local User',
        email: 'local.user@example.com',
        department: 'Quality Control',
        password: 'Password123!',
        confirmPassword: 'Password123!',
      });

    vi.spyOn(googleAuthService, 'verifyGoogleToken').mockResolvedValue({
      sub: 'google-sub-collision',
      email: 'local.user@example.com',
      name: 'Local User Google',
      picture: '',
    });

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'token-collision', department: 'Quality Control' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('LOCAL_ACCOUNT_EXISTS');
    expect(res.body.message).toMatch(/account with this email already exists/i);
  });
});
