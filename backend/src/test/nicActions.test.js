import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';

import { redact, getPassword, describeCredential, invalidate } from '../services/email/nic/credentials.js';
import { read_nicemail, send_nicemail } from '../services/email/nic/actions.js';

const NIC_ENV = {
  NIC_EMAIL: 'contact.test@gov.invalid',
  NIC_IMAP_HOST: 'imap.test.invalid',
  NIC_SMTP_HOST: 'smtp.test.invalid',
  NIC_TEST_RECIPIENT: 'contact.test@gov.invalid',
  NIC_APP_PASSWORD: 'test-app-password',
};

beforeEach(() => {
  for (const [key, value] of Object.entries(NIC_ENV)) vi.stubEnv(key, value);
  invalidate();
});

afterEach(() => {
  vi.unstubAllEnvs();
  invalidate();
});

describe('credential handling', () => {
  it('redacts the secret wherever it appears', () => {
    const leaked = 'a1 NO LOGIN "user" "hunter2" failed';
    expect(redact(leaked, 'hunter2')).toBe('a1 NO LOGIN "user" "«redacted»" failed');
  });

  it('leaves text untouched when there is no secret', () => {
    expect(redact('nothing to hide', '')).toBe('nothing to hide');
  });

  it('reads the inline password', async () => {
    invalidate();
    expect(await getPassword()).toBe('test-app-password');
    expect(describeCredential()).toEqual({ configured: true, source: 'NIC_APP_PASSWORD' });
  });

  it('prefers a password file over the inline value', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nic-cred-'));
    const file = path.join(dir, 'secret');
    await writeFile(file, 'from-the-file\n');

    vi.stubEnv('NIC_APP_PASSWORD_FILE', file);
    invalidate();

    expect(await getPassword()).toBe('from-the-file');
    expect(describeCredential().source).toBe('NIC_APP_PASSWORD_FILE');

    await rm(dir, { recursive: true, force: true });
  });

  it('reports an absent credential rather than throwing', async () => {
    vi.stubEnv('NIC_APP_PASSWORD', '');
    invalidate();

    expect(await getPassword()).toBe('');
    expect(describeCredential().configured).toBe(false);
  });
});

describe('read_nicemail', () => {
  it('fetches and normalises the newest message', async () => {

    const raw = Buffer.from(
      [
        'From: Inquirer <inquirer@example.invalid>',
        'To: contact.test@gov.invalid',
        'Subject: Monograph clarification',
        'Message-ID: <abc123@example.invalid>',
        'Date: Tue, 09 Sep 2026 10:00:00 +0000',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Please clarify the Nickel test dilution.',
      ].join('\r\n'),
    );

    const createClient = async () => ({
      connect: async () => {},
      mailbox: { exists: 1 },
      getMailboxLock: async () => ({ release: () => {} }),
      fetch: async function* () {
        yield { uid: 42, source: raw };
      },
      logout: async () => {},
    });

    const result = await read_nicemail({ limit: 1, createClient });

    expect(result.ok).toBe(true);
    expect(result.stage).toBe('fetch');

    const [message] = result.data.messages;
    expect(message.subject).toBe('Monograph clarification');
    expect(message.fromAddresses).toEqual(['inquirer@example.invalid']);
    expect(message.toAddresses).toEqual(['contact.test@gov.invalid']);
    expect(message.messageId).toBe('<abc123@example.invalid>');
    expect(message.date).toBe('2026-09-09T10:00:00.000Z');
    expect(message.text).toContain('Nickel test dilution');
    expect(message.uid).toBe(42);
  });

  it('reports an empty mailbox as success, not failure', async () => {

    const createClient = async () => ({
      connect: async () => {},
      mailbox: { exists: 0 },
      getMailboxLock: async () => ({ release: () => {} }),
      fetch: async function* () {},
      logout: async () => {},
    });

    const result = await read_nicemail({ createClient });
    expect(result.ok).toBe(true);
    expect(result.data.messages).toEqual([]);
  });

  it('reports an authentication failure as the authenticate stage', async () => {

    const createClient = async () => ({
      connect: async () => {
        throw Object.assign(new Error('Invalid credentials'), {
          authenticationFailed: true,
          responseText: 'a1 NO [AUTHENTICATIONFAILED] Invalid credentials(Failure)',
        });
      },
      logout: async () => {},
    });

    const result = await read_nicemail({ createClient });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe('authenticate');
    expect(result.error).toContain('AUTHENTICATIONFAILED');
  });

  it('reports an unreachable server as the connect stage', async () => {

    const createClient = async () => ({
      connect: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      },
      logout: async () => {},
    });

    const result = await read_nicemail({ createClient });
    expect(result.stage).toBe('connect');
  });

  it('never lets the password reach the error text', async () => {

    const createClient = async () => ({
      connect: async () => {
        throw new Error('LOGIN "contact.test@gov.invalid" "test-app-password" rejected');
      },
      logout: async () => {},
    });

    const result = await read_nicemail({ createClient });

    expect(result.error).not.toContain('test-app-password');
    expect(result.error).toContain('«redacted»');
  });
});

describe('send_nicemail', () => {
  const okTransport = () => ({
    verify: async () => true,
    sendMail: async () => ({
      messageId: '<sent-1@gov.invalid>',
      response: '250 2.0.0 OK',
      accepted: ['contact.test@gov.invalid'],
      rejected: [],
    }),
    close: () => {},
  });

  it('submits to the allow-listed recipient', async () => {

    const result = await send_nicemail({ createTransport: okTransport });

    expect(result.ok).toBe(true);
    expect(result.stage).toBe('submit');
    expect(result.data.messageId).toBe('<sent-1@gov.invalid>');
    expect(result.data.accepted).toEqual(['contact.test@gov.invalid']);
  });

  it('refuses any other recipient', async () => {

    const sendMail = vi.fn();
    const result = await send_nicemail({
      to: 'someone.else@example.invalid',
      createTransport: () => ({ verify: async () => true, sendMail, close: () => {} }),
    });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe('config');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('is case-insensitive about the allow-listed address', async () => {

    const result = await send_nicemail({
      to: 'CONTACT.TEST@GOV.INVALID',
      createTransport: okTransport,
    });

    expect(result.ok).toBe(true);
  });

  it('separates an auth rejection from a submission failure', async () => {

    const sendMail = vi.fn();
    const result = await send_nicemail({
      createTransport: () => ({
        verify: async () => {
          throw Object.assign(new Error('Invalid login'), {
            code: 'EAUTH',
            responseCode: 535,
            response: '535 Authentication Failed',
          });
        },
        sendMail,
        close: () => {},
      }),
    });

    expect(result.stage).toBe('authenticate');
    expect(result.error).toContain('535');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('reports a rejected message as a submission failure, not an auth failure', async () => {

    const result = await send_nicemail({
      createTransport: () => ({
        verify: async () => true,
        sendMail: async () => {
          throw Object.assign(new Error('mailbox full'), { response: '552 Mailbox full' });
        },
        close: () => {},
      }),
    });

    expect(result.stage).toBe('submit');
    expect(result.ok).toBe(false);
  });

  it('refuses to send when no credential is configured', async () => {
    vi.stubEnv('NIC_APP_PASSWORD', '');
    invalidate();

    const sendMail = vi.fn();
    const result = await send_nicemail({
      createTransport: () => ({ verify: async () => true, sendMail, close: () => {} }),
    });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe('authenticate');
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('the actions are reachable over HTTP, and gated', () => {
  beforeEach(() => {
    vi.stubEnv('NIC_EMAIL', '');
    vi.stubEnv('NIC_IMAP_HOST', '');
    vi.stubEnv('NIC_SMTP_HOST', '');
  });

  it('refuses an unauthenticated caller', async () => {
    for (const path of ['/api/v1/nic/status', '/api/v1/nic/read', '/api/v1/nic/send']) {
      const method = path.endsWith('status') ? 'get' : 'post';
      const res = await request(app)[method](path).send({});
      expect(res.status, path).toBe(401);
    }
  });

  it('refuses a role that may not operate the mailbox', async () => {
    const res = await request(app)
      .post('/api/v1/nic/send')
      .set(authHeader(ROLES.REVIEWER))
      .send({});

    expect(res.status).toBe(403);
  });

  it('lets the Front Officer call read, reporting the stage rather than throwing', async () => {
    const res = await request(app).post('/api/v1/nic/read').set(authHeader(ROLES.FRONT_OFFICE)).send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.stage).toBe('config');
  });

  it('exposes a non-secret status view', async () => {
    vi.stubEnv('NIC_APP_PASSWORD', 'super-secret-value');

    const res = await request(app).get('/api/v1/nic/status').set(authHeader(ROLES.SUPER_ADMIN));

    expect(res.status).toBe(200);
    expect(res.body.credential).toEqual({ configured: true, source: 'NIC_APP_PASSWORD' });
    expect(JSON.stringify(res.body)).not.toContain('super-secret-value');
  });
});

describe('configuration guard', () => {
  it('fails before opening a socket when the host is missing', async () => {
    vi.stubEnv('NIC_IMAP_HOST', '');

    const createClient = vi.fn();
    const result = await read_nicemail({ createClient });

    expect(result.stage).toBe('config');
    expect(createClient).not.toHaveBeenCalled();
  });
});
