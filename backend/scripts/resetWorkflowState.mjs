/**
 * Clear the workflow state from MongoDB, leaving configuration intact.
 *
 * This is a maintenance tool, NOT a seed. It inserts nothing. Its purpose is to
 * return a development database to the state a fresh install would have, so the
 * next real enquiry is case 00001 rather than continuing somebody else's
 * sequence.
 *
 *   npm run db:reset              # clear the default DATABASE_URL
 *   npm run db:reset -- --dry-run # report what would go, change nothing
 *   npm run db:reset -- --force   # required when NODE_ENV=production
 *
 * The `users` collection is deliberately untouched: it is re-seeded from
 * src/constants/users.js on every connect, and those 13 accounts are the staff
 * directory the application needs, not fixtures.
 */
import env from '../src/config/env.js';
import { connectDb, disconnectDb, mongoose } from '../src/config/db.js';

/**
 * Everything the workflow writes. Order does not matter — there are no
 * foreign-key constraints in MongoDB — but the grouping documents intent.
 */
const COLLECTIONS = [
  // The case and everything hanging off it
  'querycases',
  'workflowsteps',
  'reviews',
  'responseversions',
  'notifications',
  // The email record
  'emailmessages',
  'emailthreads',
  // The send ledger — Case IDs restart, so it must go with the cases, or the
  // next case 00001 would read as already answered.
  'outboundemails',
  'mailboxmessages',
  'mailboxdecisions',
  'mailboxtriages',
  // Sequence state and history
  'querycounters',
  'counters',
  'auditevents',
];

/** Configuration, not state. Never dropped by this script. */
const PRESERVED = ['users'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

function redactUri(uri) {
  // Never print credentials, even to a local terminal.
  return String(uri || '').replace(/\/\/[^@]+@/, '//<credentials>@');
}

async function main() {
  console.log('\nQMS workflow state reset — clears cases, leaves user accounts alone.\n');

  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Nothing to reset.\n');
    process.exit(1);
  }

  if (env.NODE_ENV === 'production' && !force) {
    console.error('Refusing to run against NODE_ENV=production without --force.');
    console.error('This deletes every query case in the database.\n');
    process.exit(1);
  }

  console.log(`  Database   ${redactUri(env.DATABASE_URL)}`);
  console.log(`  NODE_ENV   ${env.NODE_ENV}`);
  console.log(`  Mode       ${dryRun ? 'dry run — nothing will be deleted' : 'delete'}\n`);

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
