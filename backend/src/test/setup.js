import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';
import { beforeAll, afterEach } from 'vitest';
import * as mailbox from '../services/email/mailbox/index.js';
import * as attachmentStore from '../services/attachments/attachmentStore.js';
import env from '../config/env.js';

beforeAll(() => {
  mailbox.forceInMemory();

  // vitest.config.mjs sets a single ATTACHMENT_DIR string for the whole
  // process, but Vitest runs test FILES concurrently across worker threads —
  // a shared literal path there caused real cross-file races (ENOENT/ENOTEMPTY
  // from one file's reset() colliding with another file's writes). Each test
  // file gets its own fresh module registry, so overriding it here, once per
  // file, gives every file an isolated directory with no code-path change.
  env.ATTACHMENT_DIR = path.join(os.tmpdir(), `qms-test-attachments-${randomUUID()}`);
});

afterEach(async () => {
  await attachmentStore.reset();
});
