import { beforeAll } from 'vitest';
import * as mailbox from '../services/email/mailbox/index.js';

beforeAll(() => {
  mailbox.forceInMemory();
});
