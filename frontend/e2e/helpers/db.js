import { MongoClient } from 'mongodb';
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

const PRESERVED = new Set(['users']);

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
    ingested: true,
  });

  return mailboxMessageId;
}
export async function unblockMailboxDelivery(mailboxMessageId) {
  const database = await db();
  await database.collection('mailboxmessages').deleteOne({ mailboxMessageId });
}
