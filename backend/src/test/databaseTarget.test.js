import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import env from '../config/env.js';
import {
  connectDb,
  disconnectDb,
  isConnected,
  isDatabaseConfigured,
  isSharedDatabase,
  databaseTarget,
  mongoose,
  DatabaseUnavailableError,
} from '../config/db.js';

const Model = { createCollection: vi.fn(), createIndexes: vi.fn(), syncIndexes: vi.fn() };
const User = { updateOne: vi.fn() };

vi.mock('../models/index.js', () => ({ QueryCase: Model, User }));

const original = { DATABASE_URL: env.DATABASE_URL, NODE_ENV: env.NODE_ENV };

beforeEach(() => {
  Model.createCollection.mockReset().mockResolvedValue(undefined);
  Model.createIndexes.mockReset().mockResolvedValue(undefined);
  Model.syncIndexes.mockReset().mockResolvedValue(undefined);
  User.updateOne.mockReset().mockResolvedValue({});
});

afterEach(async () => {
  vi.spyOn(mongoose, 'disconnect').mockResolvedValue(undefined);
  await disconnectDb();
  env.DATABASE_URL = original.DATABASE_URL;
  env.NODE_ENV = original.NODE_ENV;
  vi.restoreAllMocks();
});

describe('databaseTarget', () => {
  it('reads the hosts and the database name, never the credentials', () => {
    expect(
      databaseTarget(
        'mongodb+srv://qms_dev:s3cret@cluster0.x.mongodb.net/query_management_system?retryWrites=true&w=majority',
      ),
    ).toEqual({ srv: true, hosts: ['cluster0.x.mongodb.net'], name: 'query_management_system' });
  });

  it('drops the ports and splits a replica-set host list', () => {
    expect(databaseTarget('mongodb://a.example:27017,B.Example:27018/qms?replicaSet=rs0')).toEqual({
      srv: false,
      hosts: ['a.example', 'b.example'],
      name: 'qms',
    });
  });

  it('drops everything up to the last @, so a password holding an @ never reaches the hosts', () => {
    expect(databaseTarget('mongodb://qms:p@ss@word@127.0.0.1:27017/qms')).toEqual({
      srv: false,
      hosts: ['127.0.0.1'],
      name: 'qms',
    });
  });

  it.each([
    'mongodb://127.0.0.1:27017',
    'mongodb://127.0.0.1:27017/',
    'mongodb+srv://qms_dev:s3cret@c.x.mongodb.net/?retryWrites=true',
  ])('reports no database name for %s', (uri) => {
    expect(databaseTarget(uri).name).toBe('');
  });

  it.each(['', 'garbage', 'postgres://u:p@db.example/qms'])('returns null for %j', (uri) => {
    expect(databaseTarget(uri)).toBeNull();
  });
});

describe('isSharedDatabase', () => {
  it.each([
    '',
    'mongodb://127.0.0.1:27017/q',
    'mongodb://localhost/q',
    'mongodb://LOCALHOST:27017/q',
    'mongodb://[::1]:27017/q',
    'mongodb://::1/q',
    'mongodb://127.0.0.1:27017,localhost:27018/q?replicaSet=rs0',
  ])('is false for %j', (uri) => {
    expect(isSharedDatabase(uri)).toBe(false);
  });

  it.each([
    'mongodb+srv://u:p@c.x.mongodb.net/q',
    'mongodb+srv://localhost/q',
    'mongodb://10.0.0.5/q',
    'mongodb://127.0.0.1:27017,db.example.com:27017/q',
    'garbage',
  ])('is true for %j', (uri) => {
    expect(isSharedDatabase(uri)).toBe(true);
  });

  it('reads DATABASE_URL when no URI is passed', () => {
    env.DATABASE_URL = 'mongodb+srv://u:p@c.x.mongodb.net/q';
    expect(isSharedDatabase()).toBe(true);

    env.DATABASE_URL = '';
    expect(isSharedDatabase()).toBe(false);
  });
});

describe('isDatabaseConfigured', () => {
  it('follows whether DATABASE_URL is set, not whether it is connected', () => {
    env.DATABASE_URL = '';
    expect(isDatabaseConfigured()).toBe(false);

    env.DATABASE_URL = 'mongodb://127.0.0.1:27017/qms_unit';
    expect(isDatabaseConfigured()).toBe(true);
    expect(isConnected()).toBe(false);
  });
});

describe('connectDb', () => {
  it('refuses a URI that names no database, without echoing it or connecting', async () => {
    const connect = vi.spyOn(mongoose, 'connect').mockRejectedValue(new Error('must not connect'));
    env.DATABASE_URL = 'mongodb+srv://qms_dev:s3cret@c.x.mongodb.net/?retryWrites=true';

    const error = await connectDb({ silent: true }).catch((caught) => caught);

    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect(error.message).toMatch(/names its database/);
    expect(error.message).not.toMatch(/s3cret|qms_dev|c\.x\.mongodb\.net/);
    expect(connect).not.toHaveBeenCalled();
  });

  it.each(['development', 'test'])(
    'fails when a configured database cannot be reached under NODE_ENV=%s, with the credentials redacted',
    async (nodeEnv) => {
      env.NODE_ENV = nodeEnv;
      env.DATABASE_URL = 'mongodb://qms:hun@ter2@10.0.0.5:27017/qms';
      vi.spyOn(mongoose, 'connect').mockRejectedValue(
        new Error('connect ECONNREFUSED mongodb://qms:hun@ter2@10.0.0.5:27017/qms\n    at stack'),
      );

      const error = await connectDb({ silent: true }).catch((caught) => caught);

      expect(error).toBeInstanceOf(DatabaseUnavailableError);
      expect(error.message).toContain('//<credentials>@10.0.0.5:27017/qms');
      expect(error.message).not.toMatch(/hun|ter2|stack/);
      expect(isConnected()).toBe(false);
    },
  );

  it('logs only the hosts and the database, and says when the database is shared', async () => {
    vi.spyOn(mongoose, 'connect').mockResolvedValue(mongoose);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    env.DATABASE_URL = 'mongodb+srv://qms_dev:s3cret@cluster0.x.mongodb.net/query_management_system?retryWrites=true';

    await expect(connectDb()).resolves.toBe(true);

    const printed = log.mock.calls.map(([line]) => line).join('\n');
    expect(printed).toContain(
      '[qms] MongoDB connected — cluster0.x.mongodb.net/query_management_system (shared: resets and mailbox wipes are refused)',
    );
    expect(printed).not.toMatch(/s3cret|qms_dev|retryWrites/);
  });

  it('does not call a local database shared', async () => {
    vi.spyOn(mongoose, 'connect').mockResolvedValue(mongoose);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    env.DATABASE_URL = 'mongodb://127.0.0.1:27017/query_management_system';

    await connectDb();

    expect(log).toHaveBeenCalledWith('[qms] MongoDB connected — 127.0.0.1/query_management_system');
  });

  it.each([
    ['a shared database outside production', 'createIndexes', 'mongodb+srv://u:p@c.x.mongodb.net/qms', 'development'],
    ['a local database', 'syncIndexes', 'mongodb://127.0.0.1:27017/qms', 'development'],
    ['a shared database in production', 'syncIndexes', 'mongodb+srv://u:p@c.x.mongodb.net/qms', 'production'],
  ])('on %s it only calls %s', async (_label, used, uri, nodeEnv) => {
    vi.spyOn(mongoose, 'connect').mockResolvedValue(mongoose);
    env.NODE_ENV = nodeEnv;
    env.DATABASE_URL = uri;

    await connectDb({ silent: true });

    const unused = used === 'createIndexes' ? 'syncIndexes' : 'createIndexes';
    expect(Model[used]).toHaveBeenCalledTimes(1);
    expect(Model[unused]).not.toHaveBeenCalled();
  });
});

describe('the connection error log', () => {
  it('redacts the credentials', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    mongoose.connection.emit('error', new Error('lost mongodb://qms:hun@ter2@10.0.0.5:27017/qms\nstack'));

    expect(error).toHaveBeenCalledWith('[qms] MongoDB error: lost mongodb://<credentials>@10.0.0.5:27017/qms');
  });
});
