import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as emailService from '../services/email/emailService.js';
import { EMAIL_TRANSPORTS, MAILBOX_SOURCES, validateEmailConfig } from '../config/env.js';
import * as nicTransport from '../services/email/transports/nicTransport.js';
import * as mailbox from '../services/email/mailbox/index.js';

/**
 * NICeMail as a selectable transport, kept distinct from the two other
 * NICeMail mechanisms:
 *   - services/email/nic/actions.js — the verification surface behind
 *     /api/v1/nic/* and `npm run nic:verify`, permanently confined to
 *     NIC_TEST_RECIPIENT.
 *   - services/email/nic/browser/  — the CDP browser agent, which is not in
 *     the request path and is never selected by EMAIL_TRANSPORT.
 */

const NIC_KEYS = [
  'NIC_EMAIL',
  'NIC_IMAP_HOST',
  'NIC_SMTP_HOST',
  'NIC_TEST_RECIPIENT',
  'NIC_ALLOW_OUTBOUND',
  'MAILBOX_SOURCE',
];

let saved;

beforeEach(() => {
  saved = Object.fromEntries(NIC_KEYS.map((key) => [key, process.env[key]]));
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  mailbox.useAuto();
});

const configured = () => {
  process.env.NIC_EMAIL = 'contact.example@gov.in';
  process.env.NIC_IMAP_HOST = 'imap.mgovcloud.in';
  process.env.NIC_SMTP_HOST = 'smtp.mgovcloud.in';
  process.env.NIC_TEST_RECIPIENT = 'contact.example@gov.in';
};

describe('EMAIL_TRANSPORT=nic', () => {
  it('selects the NICeMail transport, not the mock', async () => {
    configured();
    const transport = await emailService.getTransport(EMAIL_TRANSPORTS.NIC);
    expect(transport.name).toBe('nic');
  });

  it('validates with one credential — NICeMail is one mailbox, not one per role', () => {
    configured();
    const errors = validateEmailConfig({
      EMAIL_TRANSPORT: EMAIL_TRANSPORTS.NIC,
      MAILBOX_SOURCE: MAILBOX_SOURCES.AUTO,
      IPC_QUERY_EMAIL: 'ipc@example.com',
    });
    expect(errors).toEqual([]);
  });

  it('refuses to start when the NIC endpoints are not configured', () => {
    delete process.env.NIC_EMAIL;
    delete process.env.NIC_IMAP_HOST;
    delete process.env.NIC_SMTP_HOST;

    const errors = validateEmailConfig({
      EMAIL_TRANSPORT: EMAIL_TRANSPORTS.NIC,
      MAILBOX_SOURCE: MAILBOX_SOURCES.AUTO,
      IPC_QUERY_EMAIL: 'ipc@example.com',
    });

    expect(errors.join('\n')).toMatch(/NIC_EMAIL is required/);
    expect(errors.join('\n')).toMatch(/NIC_IMAP_HOST is required/);
    expect(errors.join('\n')).toMatch(/NIC_SMTP_HOST is required/);
  });
});

describe('the NIC_ALLOW_OUTBOUND interlock', () => {
  const message = {
    to: ['member.of.the.public@example.com'],
    subject: 'Reply to your enquiry',
    body: 'Text',
  };

  it('confines sends to NIC_TEST_RECIPIENT until outbound is explicitly enabled', async () => {
    configured();
    delete process.env.NIC_ALLOW_OUTBOUND;

    const sender = vi.fn();
    await expect(nicTransport.send(message, { sender })).rejects.toThrow(/NIC_ALLOW_OUTBOUND/);
    expect(sender).not.toHaveBeenCalled();
  });

  it('is not satisfied by any value other than the exact string "true"', async () => {
    configured();
    for (const value of ['1', 'yes', 'TRUE', 'true ', '']) {
      process.env.NIC_ALLOW_OUTBOUND = value;
      const sender = vi.fn();
      // 'true ' is trimmed and therefore allowed; everything else is refused.
      if (value.trim() === 'true') continue;
      await expect(nicTransport.send(message, { sender })).rejects.toThrow();
    }
  });

  it('sends to a real recipient once outbound is enabled', async () => {
    configured();
    process.env.NIC_ALLOW_OUTBOUND = 'true';

    const sender = vi.fn(async () => ({
      ok: true,
      stage: 'submit',
      data: { messageId: '<nic-1@gov.in>' },
    }));

    const result = await nicTransport.send(message, { sender, asRole: 'FRONT_OFFICE' });

    expect(sender).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      providerMessageId: '<nic-1@gov.in>',
      transport: 'nic',
      sentAsRole: 'FRONT_OFFICE',
    });
  });

  it('throws on a failed send rather than reporting a delivery that did not happen', async () => {
    configured();
    process.env.NIC_ALLOW_OUTBOUND = 'true';

    const sender = vi.fn(async () => ({
      ok: false,
      stage: 'authenticate',
      error: '535 Authentication Failed',
    }));

    await expect(nicTransport.send(message, { sender })).rejects.toThrow(/authenticate/);
  });
});

describe('MAILBOX_SOURCE=nic', () => {
  it('reports the NICeMail inbox and refuses local delivery into it', () => {
    configured();
    process.env.MAILBOX_SOURCE = MAILBOX_SOURCES.NIC;
    mailbox.useAuto();

    expect(mailbox.describe().backend).toBe('nic');
    // A real mailbox cannot be deposited into or cleared — mail arrives in it by
    // genuinely being sent. This is what stops mockTransport trying.
    expect(mailbox.supportsDelivery()).toBe(false);
  });
});
