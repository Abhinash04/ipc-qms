import env from '../src/config/env.js';
import { connectDb, disconnectDb, isSharedDatabase } from '../src/config/db.js';
import { discardAwaiting, PURGEABLE_SOURCES } from '../src/services/email/mailbox/retention.js';

const args = process.argv.slice(2);
const has = (name) => args.includes(name);

function argValue(name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const dryRun = has('--dry-run');
const force = has('--force');
const limit = argValue('--limit') ? parseInt(argValue('--limit'), 10) : undefined;

const redactUri = (uri) => String(uri || '').replace(/\/\/.*@/, '//<credentials>@');

const pad = (value, width) => String(value ?? '').padEnd(width);

async function main() {
  console.log('\nQMS mailbox cleanup — discards every message still awaiting validation, keeps the id stub.\n');

  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Nothing to clean up.');
    process.exitCode = 1;
    return;
  }

  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    console.error(`--limit must be a positive whole number (got "${argValue('--limit')}").`);
    process.exitCode = 1;
    return;
  }

  const shared = isSharedDatabase();
  console.log(`Database         ${redactUri(env.DATABASE_URL)}`);
  console.log(`Shared           ${shared ? 'yes — other developers use this database' : 'no'}`);
  console.log(`NODE_ENV         ${env.NODE_ENV}`);
  console.log(`Mode             ${dryRun ? 'dry run — nothing will be destroyed' : 'discard'}`);
  console.log(`Source           ${PURGEABLE_SOURCES.join(', ')}`);
  console.log(`Limit            ${limit ?? 'none'}\n`);

  if ((env.NODE_ENV === 'production' || shared) && !dryRun && !force) {
    console.error(
      `Refusing to discard mail ${env.NODE_ENV === 'production' ? 'with NODE_ENV=production' : 'on a shared database'} without --force.`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    await connectDb({ silent: true });
  } catch (error) {
    console.error(`Could not connect to the database: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const result = await discardAwaiting({ dryRun, limit });

  if (!result.candidates.length) {
    console.log('No message is awaiting validation.\n');
  } else {
    console.log(`${result.candidates.length} message(s) awaiting validation:\n`);
    for (const candidate of result.candidates) {
      console.log(
        `  ${dryRun ? 'would discard' : 'discard'}  ${pad(candidate.mailboxMessageId, 22)} ` +
          `${pad(String(candidate.receivedAt || '').slice(0, 16), 17)} ${pad(candidate.from, 34)} ` +
          `"${String(candidate.subject || '').slice(0, 44)}"`,
      );
    }
    console.log('');
  }

  console.log('Result:');
  console.log(`  awaiting found        ${result.scanned}`);
  console.log(`  ${dryRun ? 'would discard        ' : 'discarded            '} ${result.discarded}`);
  console.log(`  attachments removed   ${result.attachmentsRemoved}`);
  console.log(`  skipped (decided)     ${result.skipped.decided}`);
  console.log(`  skipped (has a case)  ${result.skipped.linkedCase}`);
  console.log(`  failed                ${result.errors.length}`);
  console.log(`  took                  ${result.durationMs}ms`);
  for (const error of result.errors) console.log(`  error                 ${error}`);

  if (result.errors.length) process.exitCode = 1;
  if (dryRun) console.log('\nDry run complete. Re-run without --dry-run to apply.');
  console.log('');

  await disconnectDb();
}

main().catch(async (error) => {
  console.error(`\nCleanup failed: ${error.message}\n`);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
