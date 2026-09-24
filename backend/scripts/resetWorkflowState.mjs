import env from '../src/config/env.js';
import { connectDb, disconnectDb, isSharedDatabase, mongoose } from '../src/config/db.js';

const COLLECTIONS = [
  'querycases',
  'workflowsteps',
  'reviews',
  'responseversions',
  'notifications',
  'emailmessages',
  'emailthreads',
  'outboundemails',
  'mailboxmessages',
  'mailboxdecisions',
  'mailboxtriages',
  'querycounters',
  'counters',
  'auditevents',
];

const PRESERVED = ['users'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

function redactUri(uri) {
  return String(uri || '').replace(/\/\/.*@/, '//<credentials>@');
}

async function main() {
  console.log('\nQMS workflow state reset — clears cases, leaves user accounts alone.\n');

  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Nothing to reset.\n');
    process.exit(1);
  }

  const shared = isSharedDatabase();
  console.log(`  Database   ${redactUri(env.DATABASE_URL)}`);
  console.log(`  Shared     ${shared ? 'yes — other developers use this database' : 'no'}`);
  console.log(`  NODE_ENV   ${env.NODE_ENV}`);
  console.log(`  Mode       ${dryRun ? 'dry run — nothing will be deleted' : 'delete'}\n`);

  if ((env.NODE_ENV === 'production' || (shared && !dryRun)) && !force) {
    console.error(
      `Refusing to run against ${env.NODE_ENV === 'production' ? 'NODE_ENV=production' : 'a shared database'} without --force.`,
    );
    console.error('This deletes every query case in the database.\n');
    process.exit(1);
  }

  await connectDb({ silent: true });

  const present = new Set(
    (await mongoose.connection.db.listCollections().toArray()).map((c) => c.name),
  );

  let total = 0;
  for (const name of COLLECTIONS) {
    if (!present.has(name)) continue;
    const collection = mongoose.connection.db.collection(name);
    const count = await collection.countDocuments();
    if (count === 0) continue;

    total += count;
    if (dryRun) {
      console.log(`  would delete  ${String(count).padStart(5)}  ${name}`);
    } else {
      await collection.deleteMany({});
      console.log(`  deleted       ${String(count).padStart(5)}  ${name}`);
    }
  }

  if (total === 0) console.log('  Nothing to clear — the workflow state is already empty.');

  for (const name of PRESERVED) {
    if (!present.has(name)) continue;
    const count = await mongoose.connection.db.collection(name).countDocuments();
    console.log(`\n  kept          ${String(count).padStart(5)}  ${name}  (staff directory)`);
  }

  console.log(
    dryRun
      ? '\nDry run complete. Re-run without --dry-run to apply.\n'
      : '\nDone. The next accepted enquiry will be case 00001.\n',
  );

  await disconnectDb();
}

main().catch(async (error) => {
  console.error(`\nReset failed: ${error.message}\n`);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
