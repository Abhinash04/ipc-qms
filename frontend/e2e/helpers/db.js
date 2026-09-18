import { MongoClient } from 'mongodb';

/**
 * Direct MongoDB access for the end-to-end suite.
 *
 * The point of these tests is that accepting a message *persisted* something —
 * a case, two outbound emails, a decision. The UI reporting success is not that
 * evidence, so every assertion is made here, against the same database the
 * backend wrote to.
 *
 * The `mongodb` driver rather than `mongoose`: mongoose is a backend dependency
 * and its models carry the backend's schemas, defaults and casting. Reading raw
 * documents is exactly what is wanted — it cannot paper over a field the server
 * failed to write.
 *
 * Must match DATABASE_URL in backend/.env.e2e.
 */
export const E2E_MONGO_URL = 'mongodb://127.0.0.1:27017/qms_e2e';
const E2E_DB_NAME = 'qms_e2e';

let client = null;

async function db() {
  if (!client) {
    client = new MongoClient(E2E_MONGO_URL, { serverSelectionTimeoutMS: 5000 });
    try {
      await client.connect();
    } catch (error) {
      client = null;
      throw new Error(
        `Cannot reach MongoDB at ${E2E_MONGO_URL}. The e2e suite needs a local ` +
          `mongod on 127.0.0.1:27017.`,
        { cause: error },
      );
    }
  }
  return client.db(E2E_DB_NAME);
}

export async function closeDb() {
  if (!client) return;
  await client.close();
  client = null;
}

/**
 * Collections the reset leaves alone.
 *
 * `users` is seeded once by the backend at boot (config/db.js upserts
 * constants/users.js into it) and is never re-seeded afterwards, so wiping it
 * mid-run would empty the directory for every later test.
 */
const PRESERVED = new Set(['users']);

/**
 * Empty every collection except `users`.
 *
 * Documents are deleted rather than the collections dropped, deliberately:
 * dropping takes the unique indexes with it (QueryCase.queryId,
 * MailboxDecision.mailboxMessageId, EmailMessage.sourceMessageId), and the
 * backend only builds those once, at connect. A dropped index would not come
 * back and the duplicate-protection this suite exists to check would be
 * silently unenforced.
 */
export async function resetDatabase() {
  const database = await db();
  const collections = await database.listCollections({}, { nameOnly: true }).toArray();

  await Promise.all(
    collections
      .map(({ name }) => name)
      .filter((name) => !PRESERVED.has(name) && !name.startsWith('system.'))
      .map((name) => database.collection(name).deleteMany({})),
  );
}

const read = async (collection, filter = {}) => {
  const database = await db();
  return database.collection(collection).find(filter).toArray();
};

export const readQueryCases = (filter) => read('querycases', filter);
export const readQueryCounters = (filter) => read('querycounters', filter);
export const readEmailMessages = (filter) => read('emailmessages', filter);
export const readEmailThreads = (filter) => read('emailthreads', filter);
export const readMailboxDecisions = (filter) => read('mailboxdecisions', filter);
export const readAuditEvents = (filter) => read('auditevents', filter);
export const readWorkflowSteps = (filter) => read('workflowsteps', filter);
export const readResponseVersions = (filter) => read('responseversions', filter);
export const readReviews = (filter) => read('reviews', filter);
export const readMailboxMessages = (filter) => read('mailboxmessages', filter);

/**
 * Make the next outgoing email fail at the transport.
 *
 * There is no environment switch for "the next send fails" — under
 * EMAIL_TRANSPORT=mock every send succeeds, and `wasReallySent` in
 * services/workflow/finalApproval.js counts a mock result as delivery precisely
 * *because* mock is what the deployment asked for. So the failure is injected
 * where the mock transport actually does work that can fail: it deposits a copy
 * of every message it sends into the IPC mailbox (transports/mockTransport.js →
 * mailbox.deliver), and `mongoIpcMailbox.deliver` mints `MSG-000NN` from the
 * `counters` document and inserts it under a UNIQUE index.
 *
 * Planting a message that already holds the next id in that sequence makes that
 * insert collide, `send` rejects, and the rejection propagates out of
 * `emailService.sendResponse` exactly as a refused SMTP handshake would — which
 * is the failure the case under test is about. Nothing in `src/` is touched and
 * nothing else is affected: the blocker is addressed to its own `.example`
 * recipient, so it is in nobody's inbox listing.
 *
 * @returns the planted id, for `unblockMailboxDelivery`.
 */
export async function blockNextMailboxDelivery() {
  const database = await db();
  const counter = await database.collection('counters').findOne({ key: 'mailboxMessage' });
  const mailboxMessageId = `MSG-${String((counter?.value ?? 0) + 1).padStart(5, '0')}`;

  await database.collection('mailboxmessages').insertOne({
    mailboxMessageId,
    to: 'delivery-blocker@e2e.example',
    from: 'delivery-blocker@e2e.example',
    cc: [],
    bcc: [],
    subject: '(e2e delivery blocker)',
    body: '',
    attachments: [],
    receivedAt: new Date().toISOString(),
    // Already "read", so it can never be offered to a Front Officer to accept.
    ingested: true,
  });

  return mailboxMessageId;
}

/** Remove the blocker, so the next send can complete. */
export async function unblockMailboxDelivery(mailboxMessageId) {
  const database = await db();
  await database.collection('mailboxmessages').deleteOne({ mailboxMessageId });
}
