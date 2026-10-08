import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';

describe('POST /api/v1/auth/register', () => {
  const sampleUser = {
    name: 'New Test User',
    email: 'newuser.test@ipc.example',
    department: 'Quality Assurance & Standards',
    designation: 'Senior Scientific Officer',
    password: 'SecurePassword123',
    confirmPassword: 'SecurePassword123',
  };

  it('creates a new user successfully and returns 201 without password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(sampleUser);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      message: 'Account created successfully',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash|SecurePassword123/i);
  });

  it('rejects registration when password and confirmPassword do not match', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        ...sampleUser,
        email: 'mismatch@ipc.example',
        confirmPassword: 'WrongPassword321',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Password and confirm password must match/i);
  });

  it('rejects registration when email is invalid', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        ...sampleUser,
        email: 'not-an-email',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/valid email/i);
  });

  it('rejects registration when a required field is missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Incomplete User',
        email: 'incomplete@ipc.example',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/required/i);
  });

  it('rejects registration with 409 Conflict when email already exists', async () => {
    // First registration
    await request(app)
      .post('/api/v1/auth/register')
      .send({
        ...sampleUser,
        email: 'dup.user@ipc.example',
      });

    // Duplicate registration attempt (with different casing)
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        ...sampleUser,
        email: 'DUP.USER@ipc.example',
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/already exists/i);
  });

  it('works on /api/auth/register route alias as well', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        ...sampleUser,
        email: 'alias.route@ipc.example',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('assigns role based on designation and allows newly registered user to sign in to designated role', async () => {
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        ...sampleUser,
        email: 'oic.user@ipc.example',
        designation: 'Officer-in-Charge',
        password: 'MyPassword123',
        confirmPassword: 'MyPassword123',
      });

    expect(regRes.status).toBe(201);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'oic.user@ipc.example', password: 'MyPassword123' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user).toMatchObject({
      email: 'oic.user@ipc.example',
      role: 'OFFICER_IN_CHARGE',
    });
  });
});
