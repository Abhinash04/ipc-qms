import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';
import { beforeAll, afterEach } from 'vitest';
import * as mailbox from '../services/email/mailbox/index.js';
import * as attachmentStore from '../services/attachments/attachmentStore.js';
import env from '../config/env.js';

beforeAll(() => {
  mailbox.forceInMemory();

  env.ATTACHMENT_DIR = path.join(os.tmpdir(), `qms-test-attachments-${randomUUID()}`);
});

afterEach(async () => {
  await attachmentStore.reset();
});
