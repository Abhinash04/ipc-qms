import mongoose from 'mongoose';
import env from './env.js';

let connected = false;

const requireDatabase = () => env.NODE_ENV === 'production';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

class DatabaseUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatabaseUnavailableError';
  }
}

const redact = (text) => String(text || '').replace(/\/\/\S*@/g, '//<credentials>@');

function databaseTarget(uri = env.DATABASE_URL) {
  const match = /^mongodb(\+srv)?:\/\/([^?]*)/i.exec(String(uri || '').trim());
  if (!match) return null;
  const address = match[2].slice(match[2].lastIndexOf('@') + 1);
  const slash = address.indexOf('/');
  const hosts = (slash === -1 ? address : address.slice(0, slash))
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .map((host) => (LOOPBACK_HOSTS.has(host) ? host : host.replace(/:\d+$/, '')))
    .filter(Boolean);
  return { srv: Boolean(match[1]), hosts, name: slash === -1 ? '' : address.slice(slash + 1).trim() };
}

function isSharedDatabase(uri = env.DATABASE_URL) {
  if (!uri) return false;
  const target = databaseTarget(uri);
  return !target || target.srv || !target.hosts.length || target.hosts.some((host) => !LOOPBACK_HOSTS.has(host));
}

const isDatabaseConfigured = () => Boolean(env.DATABASE_URL);

async function connectDb({ silent = false } = {}) {
  if (connected) return true;
  if (!env.DATABASE_URL) {
    if (requireDatabase()) {
      throw new DatabaseUnavailableError(
        'DATABASE_URL is required when NODE_ENV=production. Query Cases, workflow ' +
          'state and the audit trail have no in-memory fallback.',
      );
    }
    if (!silent) console.warn('[qms] DATABASE_URL not set — mailbox will run in-memory only');
    return false;
  }

  const target = databaseTarget();
  if (!target?.name) {
    throw new DatabaseUnavailableError(
      'DATABASE_URL must be a mongodb:// or mongodb+srv:// URI that names its database, e.g. ' +
        '...mongodb.net/query_management_system?retryWrites=true. Without one every collection lands in "test".',
    );
  }
  const shared = isSharedDatabase();

  try {
    await mongoose.connect(env.DATABASE_URL, {
      serverSelectionTimeoutMS: 15000,
      maxPoolSize: 20,
      minPoolSize: 2,
      socketTimeoutMS: 45000,
    });
    connected = true;
    if (!silent) {
      console.log(
        `[qms] MongoDB connected — ${target.hosts.join(',')}/${target.name}` +
          (shared ? ' (shared: resets and mailbox wipes are refused)' : ''),
      );
    }
    try {
      const models = await import('../models/index.js');
      for (const modelName of Object.keys(models)) {
        const Model = models[modelName];
        if (Model && typeof Model.createCollection === 'function') {
          await Model.createCollection().catch(() => {});

          const indexes = shared && env.NODE_ENV !== 'production' ? Model.createIndexes() : Model.syncIndexes();
          await indexes.catch((error) => {
            console.warn(`[qms] could not sync indexes for ${modelName}: ${error.message}`);
          });
        }
      }
      const { User } = models;
      const { USERS } = await import('../constants/users.js');
      for (const u of USERS) {
        await User.updateOne(
          { userId: u.id },
          {
            $setOnInsert: {
              userId: u.id,
              name: u.name,
              email: u.email,
              role: u.role,
              divisionId: u.divisionId,
              active: true,
              createdAt: new Date().toISOString(),
            },
          },
          { upsert: true },
        ).catch(() => {});
      }
    } catch {
    }
    return true;
  } catch (error) {
    connected = false;
    throw new DatabaseUnavailableError(`MongoDB is unreachable at DATABASE_URL: ${redact(error.message.split('\n')[0])}`);
  }
}

async function disconnectDb() {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

const isConnected = () => connected && mongoose.connection.readyState === 1;

mongoose.connection.on('disconnected', () => {
  connected = false;
  console.warn('[qms] MongoDB connection lost — retrying');
});

mongoose.connection.on('reconnected', () => {
  connected = true;
  console.log('[qms] MongoDB reconnected');
});

mongoose.connection.on('error', (error) => {
  console.error(`[qms] MongoDB error: ${redact(error.message.split('\n')[0])}`);
});

export {
  connectDb,
  disconnectDb,
  isConnected,
  isDatabaseConfigured,
  isSharedDatabase,
  databaseTarget,
  mongoose,
  DatabaseUnavailableError,
};
