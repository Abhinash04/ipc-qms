import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import request from 'supertest';
import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import { AUDIT_ACTIONS } from '../constants/auditActions.js';
import * as audit from '../services/audit/auditService.js';
import { present } from '../services/audit/auditPresentation.js';
import {
  currentPublicIp,
  isPrivateIp,
  publicIpLookupEnabled,
  refreshPublicIp,
} from '../services/audit/publicIp.js';

const PUBLIC_IP = '49.205.41.130';

const service = (body, { ok = true } = {}) => vi.fn(async () => ({ ok, json: async () => body }));

beforeEach(() => audit.resetBuffer());
afterEach(() => vi.unstubAllEnvs());

describe('which addresses the internet never sees', () => {
  it('treats loopback, private and link-local ranges as private', () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.4.0.9', '172.16.0.1', '172.31.255.1', '192.168.68.108', '169.254.1.1', 'fd12::1', 'fe80::1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('treats public addresses as public', () => {
    for (const ip of [PUBLIC_IP, '8.8.8.8', '172.32.0.1', '2406:b400:72:1064::1004']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});

describe('the lookup', () => {
  it('is off under tests and in production unless switched on, and on in development', () => {
    expect(publicIpLookupEnabled()).toBe(false);
    vi.stubEnv('AUDIT_PUBLIC_IP_LOOKUP', 'true');
    expect(publicIpLookupEnabled()).toBe(true);
    vi.stubEnv('AUDIT_PUBLIC_IP_LOOKUP', 'false');
    expect(publicIpLookupEnabled()).toBe(false);
  });

  it('keeps the last good address when the service fails or answers nonsense', async () => {
    await refreshPublicIp(service({ ip: PUBLIC_IP }));
    expect(currentPublicIp()).toBe(PUBLIC_IP);

    await refreshPublicIp(vi.fn(async () => Promise.reject(new Error('offline'))));
    await refreshPublicIp(service({ ip: 'not an ip' }));
    await refreshPublicIp(service({ ip: '192.168.1.1' }));
    await refreshPublicIp(service({}, { ok: false }));
    expect(currentPublicIp()).toBe(PUBLIC_IP);
  });
});

describe('what an event records', () => {
  it('records the network’s public IPv4, keeping the local address and naming the device', async () => {
    await refreshPublicIp(service({ ip: PUBLIC_IP }));

    await request(app).get('/api/v1/audit').set(authHeader(ROLES.ADMIN)).expect(200);

    const [viewed] = await audit.list({ action: AUDIT_ACTIONS.AUDIT_VIEWED });
    expect(viewed.source.ip).toBe(PUBLIC_IP);
    expect(isPrivateIp(viewed.source.localIp)).toBe(true);
    expect(viewed.source.hostname).toBe(os.hostname());

    const view = present(viewed);
    expect(view.ipAddress).toBe(PUBLIC_IP);
    expect(view.localIp).toBe(viewed.source.localIp);
    expect(view.deviceName).toBe(os.hostname());
  });

  it('records the server’s public address on work no request caused', async () => {
    await refreshPublicIp(service({ ip: PUBLIC_IP }));
    await audit.record({ action: AUDIT_ACTIONS.SYNC_COMPLETED, actorType: 'system' });

    const [event] = await audit.list({ action: AUDIT_ACTIONS.SYNC_COMPLETED });
    expect(event.source).toMatchObject({ server: os.hostname(), ip: PUBLIC_IP });
  });

  it('leaves an already public address as it is', () => {
    expect(present({ action: 'LOGIN_SUCCEEDED', source: { ip: '8.8.8.8' } })).toMatchObject({ ipAddress: '8.8.8.8', localIp: '' });
  });
});
