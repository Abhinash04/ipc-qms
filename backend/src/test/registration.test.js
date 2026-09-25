import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { User } from '../models/User.js';
import { resetRegisteredUsers } from '../controllers/authController.js';
import bcrypt from 'bcryptjs';

describe('POST /api/v1/auth/register & /api/auth/register', () => {
  const validUser = {
    name: 'New Test User',
    email: 'new.user@example.com',
    department: 'Quality Control',
    designation: 'Analyst',
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };

  beforeEach(() => {
    resetRegisteredUsers();
  });

  it('successfully registers a new user with default role INQUIRER', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(validUser);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      message: 'Account created successfully',
    });

    // Verify password is NOT in response
    expect(res.body.password).toBeUndefined();
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('accepts custom role selection when provided', async () => {
    const userWithRole = {
      ...validUser,
      email: 'new.reviewer@example.com',
      role: 'REVIEWER',
    };

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(userWithRole);

    expect(res.status).toBe(201);
  });

  it('rejects registration with 400 when required fields are missing', async () => {
    const incomplete = { ...validUser };
    delete incomplete.department;

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(incomplete);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/All fields are required/i);
  });

  it('rejects registration with 400 when email format is invalid', async () => {
    const badEmail = { ...validUser, email: 'notanemail' };

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(badEmail);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/valid email/i);
  });

  it('rejects registration with 400 when passwords do not match', async () => {
    const mismatched = { ...validUser, confirmPassword: 'DifferentPassword123' };

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(mismatched);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/do not match/i);
  });

  it('rejects duplicate email registration with 409 Conflict', async () => {
    // First registration
    await request(app).post('/api/v1/auth/register').send(validUser);

    // Second registration with same email (even with different casing)
    const duplicate = { ...validUser, email: 'NEW.USER@EXAMPLE.COM' };
    const res = await request(app).post('/api/v1/auth/register').send(duplicate);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/already exists/i);
  });

  it('allows a newly registered user to sign in with their password', async () => {
    // 1. Register
    const regRes = await request(app).post('/api/v1/auth/register').send(validUser);
    expect(regRes.status).toBe(201);

    // 2. Login
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: validUser.email, password: validUser.password });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user).toMatchObject({
      name: 'New Test User',
      email: 'new.user@example.com',
      role: 'INQUIRER',
    });
  });
});
