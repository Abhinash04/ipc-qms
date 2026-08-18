import mongoose from 'mongoose';
import env from './env.js';

let connected = false;

async function connectDb({ silent = false } = {}) {
  if (connected) return true;
  if (!env.DATABASE_URL) {
    if (!silent) console.warn('[qms] DATABASE_URL not set — mailbox will run in-memory only');
    return false;
  }

  try {
    await mongoose.connect(env.DATABASE_URL, {
      serverSelectionTimeoutMS: 3000,
    });
    connected = true;
    if (!silent) console.log(`[qms] MongoDB connected — email + mailbox persistence enabled`);
    return true;
  } catch (error) {
    connected = false;
    if (!silent) {
      console.warn(`[qms] MongoDB unavailable (${error.message.split('\n')[0]})`);
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

export { connectDb, disconnectDb, isConnected, mongoose };
