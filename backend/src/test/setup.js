import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';
import { beforeAll, afterEach } from 'vitest';
import * as mailbox from '../services/email/mailbox/index.js';
import * as attachmentStore from '../services/attachments/attachmentStore.js';
import env from '../config/env.js';

// Test-only key for the audit chain (services/audit/auditChain.js).
env.AUDIT_HMAC_SECRET = 'test-audit-hmac-secret-not-for-production-use-0001';

beforeAll(() => {
  mailbox.forceInMemory();

  env.ATTACHMENT_DIR = path.join(os.tmpdir(), `qms-test-attachments-${randomUUID()}`);
});

afterEach(async () => {
  await attachmentStore.reset();
});
