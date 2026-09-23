/**
 * Recreate the database structure on a target MongoDB — collections and
 * indexes only, no workflow data.
 *
 * This is the "host it on Atlas" step. It is deliberately not a dump-and-
 * restore: src/config/db.js already treats the Mongoose schemas as the
 * authority for what collections and indexes exist, so a copy of a local
 * Compass database would only carry a developer's cases across and then be
 * overwritten by syncIndexes on the first connect anyway. What the cluster
 * needs is the shape, plus the staff directory the application cannot work
 * without.
 *
 *   npm run db:provision -- --uri "mongodb+srv://..."   # explicit target
 *   ATLAS_DATABASE_URL=... npm run db:provision          # or from the env
 *   npm run db:provision -- --dry-run                    # report, change nothing
 *   npm run db:provision -- --truncate                   # also clear existing workflow data
 *   npm run db:provision -- --no-seed                    # skip the user seed
 *
 * The target must name a database in the URI (…mongodb.net/query_management_system),
 * otherwise everything would land in `test`.
 */
import mongoose from 'mongoose';
import * as models from '../src/models/index.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const truncate = args.includes('--truncate');
const seed = !args.includes('--no-seed');

function argValue(name) {
  const inline = args.find((a) => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Never print credentials, even to a local terminal. */
const redact = (uri) => String(uri || '').replace(/\/\/[^@]+@/, '//<credentials>@');

/**
 * Everything the workflow writes — the same list resetWorkflowState.mjs owns,
 * for the same reason: `users` is configuration and is never cleared here.
 */
const WORKFLOW_COLLECTIONS = [
  'querycases', 'workflowsteps', 'reviews', 'responseversions', 'notifications',
  'emailmessages', 'emailthreads', 'outboundemails', 'mailboxmessages',
  'mailboxdecisions', 'querycounters', 'counters', 'auditevents',
];

async function main() {
  const uri = argValue('--uri') || process.env.ATLAS_DATABASE_URL || '';

  if (!uri) {
    console.error(
      'No target given. Pass --uri "mongodb+srv://user:pass@cluster.mongodb.net/query_management_system?retryWrites=true&w=majority"\n' +
        'or set ATLAS_DATABASE_URL. The local DATABASE_URL is ignored on purpose, so this\n' +
        'cannot be run against the development database by accident.',
    );
    process.exitCode = 1;
    return;
  }

  // A `mongodb+srv://host/?opts` URI has no database name; Mongoose would then
  // provision `test` and the app would read an empty cluster.
  const dbName = (uri.split('?')[0].split('/')[3] || '').trim();
  if (!dbName) {
    console.error(`The URI names no database: ${redact(uri)}\nAdd one, e.g. .../query_management_system?retryWrites=true`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nProvisioning ${redact(uri)}`);
  console.log(`Database: ${dbName}${dryRun ? '   (dry run — nothing will be written)' : ''}\n`);

  // Atlas sits behind DNS SRV lookup and TLS, so the 3s the app uses against
  // 127.0.0.1 is not enough for a first connect from a cold client.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000, maxPoolSize: 5 });

  const modelNames = Object.keys(models).filter(
    (name) => models[name] && typeof models[name].createCollection === 'function',
  );

  if (dryRun) {
    const existing = (await mongoose.connection.db.listCollections().toArray()).map((c) => c.name);
    for (const name of modelNames) {
      const coll = models[name].collection.collectionName;
      const indexes = models[name].schema.indexes().length;
      console.log(
        `  ${existing.includes(coll) ? 'exists ' : 'create '} ${coll.padEnd(20)} ` +
          `${indexes} declared compound/option index(es) + field indexes`,
      );
    }
    await mongoose.disconnect();
    console.log('\nDry run complete.\n');
    return;
  }

  for (const name of modelNames) {
    const Model = models[name];
    const coll = Model.collection.collectionName;
    await Model.createCollection().catch(() => {});
    try {
      await Model.syncIndexes();
    } catch (error) {
      console.warn(`  ! ${coll}: index sync failed — ${error.message.split('\n')[0]}`);
      continue;
    }
    const indexes = await Model.collection.indexes();
    console.log(`  ok ${coll.padEnd(20)} ${indexes.length} index(es)`);
  }

  if (truncate) {
    console.log('\nClearing workflow collections (users left alone):');
    for (const coll of WORKFLOW_COLLECTIONS) {
      const { deletedCount } = await mongoose.connection.db.collection(coll).deleteMany({});
      if (deletedCount) console.log(`  cleared ${coll} (${deletedCount} document(s))`);
    }
  }

  if (seed) {
    const { User } = models;
    const { USERS } = await import('../src/constants/users.js');
    let inserted = 0;
    for (const u of USERS) {
      const res = await User.updateOne(
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
      );
      if (res.upsertedCount) inserted += 1;
    }
    console.log(`\nUsers: ${USERS.length} in the directory, ${inserted} newly inserted.`);
  }

  console.log('\nDocument counts on the target:');
  for (const coll of [...WORKFLOW_COLLECTIONS, 'users']) {
    const count = await mongoose.connection.db.collection(coll).countDocuments().catch(() => null);
    if (count) console.log(`  ${coll.padEnd(20)} ${count}`);
  }

  await mongoose.disconnect();
  console.log('\nDone. Point the backend at this cluster with DATABASE_URL in .env\n');
}

main().catch(async (error) => {
  console.error(`\nProvisioning failed: ${error.message.split('\n')[0]}\n`);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
