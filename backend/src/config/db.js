import mongoose from 'mongoose';
import env from './env.js';

let connected = false;

const requireDatabase = () => env.NODE_ENV === 'production';

class DatabaseUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatabaseUnavailableError';
  }
}

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

  try {
    await mongoose.connect(env.DATABASE_URL, {
      serverSelectionTimeoutMS: 3000,
      maxPoolSize: 20,
      minPoolSize: 2,
      socketTimeoutMS: 45000,
    });
    connected = true;
    if (!silent) console.log(`[qms] MongoDB connected — email + mailbox persistence enabled`);
    try {
      const models = await import('../models/index.js');
      for (const modelName of Object.keys(models)) {
        const Model = models[modelName];
        if (Model && typeof Model.createCollection === 'function') {
          await Model.createCollection().catch(() => {});

          await Model.syncIndexes().catch((error) => {
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
      // Ignore collection init 
    }
    return true;
  } catch (error) {
    connected = false;
    const reason = error.message.split('\n')[0];

    if (requireDatabase()) {
      throw new DatabaseUnavailableError(`MongoDB is unreachable at DATABASE_URL: ${reason}`);
    }

    if (!silent) {
      console.warn(`[qms] MongoDB unavailable (${reason})`);
      console.warn('[qms] Falling back to in-memory mailbox — data will not survive a restart');
    }
    return false;
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
  console.error(`[qms] MongoDB error: ${error.message.split('\n')[0]}`);
});

export { connectDb, disconnectDb, isConnected, mongoose, DatabaseUnavailableError };
