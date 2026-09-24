import env from '../src/config/env.js';
import { connectDb, disconnectDb, mongoose } from '../src/config/db.js';
import { MailboxMessage } from '../src/models/MailboxMessage.js';
import { MailboxTriage } from '../src/models/MailboxTriage.js';
import { findPurgeable, sweepOnce, PURGEABLE_SOURCES } from '../src/services/email/mailbox/retention.js';
import { classifyByRules } from '../src/services/email/mailbox/triageRules.js';
import { recordRules } from '../src/services/email/mailbox/triage.js';

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
const showIndexes = has('--indexes');
const classifyOnly = has('--classify-only');
const noClassify = has('--no-classify');
const backfill = has('--backfill');
const hours = argValue('--hours') ? Number(argValue('--hours')) : env.MAILBOX_RETENTION_HOURS;
const unregisteredHours = argValue('--unregistered-hours')
  ? Number(argValue('--unregistered-hours'))
  : env.MAILBOX_UNREGISTERED_RETENTION_HOURS;
const limit = argValue('--limit') ? parseInt(argValue('--limit'), 10) : env.MAILBOX_PURGE_BATCH;

const redactUri = (uri) => String(uri || '').replace(/\/\/[^@]+@/, '//<credentials>@');

const pad = (value, width) => String(value ?? '').padEnd(width);

async function main() {
  console.log('\nQMS mailbox junk retention — strips junk content, keeps the id stub.\n');

  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Nothing to sweep.');
    process.exitCode = 1;
    return;
  }

  if (!PURGEABLE_SOURCES.length) {
    console.error('PURGEABLE_SOURCES is empty — no mailbox source may be purged. Nothing to do.');
    process.exitCode = 1;
    return;
  }

  if (env.NODE_ENV === 'production' && !dryRun && !force) {
    console.error('Refusing to purge with NODE_ENV=production without --force.');
    process.exitCode = 1;
    return;
  }

  if (!Number.isFinite(unregisteredHours) || unregisteredHours <= 0) {
    console.error(
      `--unregistered-hours must be a positive number (got "${argValue('--unregistered-hours')}").`,
    );
    process.exit(1);
  }
  if (!Number.isFinite(hours) || hours <= 0) {
    console.error(`--hours must be a positive number (got "${argValue('--hours')}").`);
    process.exitCode = 1;
    return;
  }

  console.log(`Database         ${redactUri(env.DATABASE_URL)}`);
  console.log(`NODE_ENV         ${env.NODE_ENV}`);
  console.log(`Mode             ${dryRun ? 'dry run — nothing will be destroyed' : 'purge'}`);
  console.log(`Junk window      ${hours} hours`);
  console.log(`Unregistered     ${unregisteredHours} hours`);
  console.log(`Confidence floor ${env.MAILBOX_JUNK_CONFIDENCE}`);
  console.log(`Purgeable source ${PURGEABLE_SOURCES.join(', ')}`);
  console.log(`Model            ${env.GEMMA_API_URL ? 'configured' : 'not configured — rules only'}\n`);

  await connectDb({ silent: true });

  if (showIndexes) {
    const indexes = await mongoose.connection.db.collection('mailboxtriages').indexes();
    console.log('mailboxtriages indexes:');
    for (const index of indexes) console.log(`  ${pad(index.name, 52)} ${JSON.stringify(index.key)}`);
    console.log('');
    await disconnectDb();
    return;
  }

  const now = Date.now();

  if (backfill) {
    const scope = { source: { $in: PURGEABLE_SOURCES }, purgedAt: null };
    const rows = await MailboxMessage.find(scope)
      .select('mailboxMessageId from subject body bodyHtml attachments receivedAt source')
      .limit(limit)
      .lean();

    let written = 0;
    let junk = 0;
    for (const row of rows) {
      if (await MailboxTriage.findOne({ mailboxMessageId: row.mailboxMessageId }).select('_id').lean()) continue;
      const verdict = classifyByRules(row);
      if (verdict.verdict === 'JUNK') junk += 1;
      if (!dryRun) await recordRules(row.mailboxMessageId, row, { source: row.source });
      written += 1;
    }

    console.log(`Backfill: ${rows.length} row(s) examined, ${written} newly judged, ${junk} of them junk.\n`);
  }

  if (!classifyOnly) {
    const candidates = await findPurgeable({ now, limit, retentionHours: hours, unregisteredHours });
    if (!candidates.length) {
      console.log('No message is old enough to purge.\n');
    } else {
      const ids = candidates.map((candidate) => candidate.mailboxMessageId);
      const rows = await MailboxMessage.find({ mailboxMessageId: { $in: ids } })
        .select('mailboxMessageId from subject attachments source')
        .lean();
      const byId = new Map(rows.map((row) => [row.mailboxMessageId, row]));

      console.log(`${candidates.length} candidate(s):\n`);
      for (const candidate of candidates) {
        const row = byId.get(candidate.mailboxMessageId);
        if (!row) continue;
        const age = Math.round((now - Date.parse(candidate.since)) / 3600000);
        const how =
          candidate.why === 'machine-junk'
            ? `${candidate.classifier}/${candidate.confidence}`
            : candidate.why === 'human-rejected'
              ? 'rejected by a person'
              : 'unregistered, expired';
        console.log(
          `  ${dryRun ? 'would purge' : 'purge'}  ${pad(candidate.mailboxMessageId, 22)} ${pad(`${age}h`, 6)} ` +
            `${pad(how, 18)} ${pad(row.from, 34)} "${String(row.subject || '').slice(0, 44)}"`,
        );
      }
      console.log('');
    }
  }

  const result = await sweepOnce({
    now,
    dryRun,
    retentionHours: hours,
    unregisteredHours,
    limit,
    classify: !noClassify,
    purge: !classifyOnly,
    ignoreGrace: true,
  });

  console.log('Result:');
  console.log(`  classified           ${result.classified}`);
  console.log(`  scanned              ${result.scanned}`);
  console.log(`  ${dryRun ? 'would purge         ' : 'purged              '} ${result.purged}`);
  console.log(`  attachments removed  ${result.attachmentsRemoved}`);
  console.log(`  skipped (accepted)   ${result.skipped.accepted}`);
  console.log(`  skipped (has a case) ${result.skipped.linkedCase}`);
  console.log(`  skipped (ineligible) ${result.skipped.notEligible}`);
  console.log(`  took                 ${result.durationMs}ms`);
  for (const error of result.errors) console.log(`  error                ${error}`);

  if (dryRun) console.log('\nDry run complete. Re-run without --dry-run to apply.');
  console.log('');

  await disconnectDb();
}

main().catch(async (error) => {
  console.error(`\nSweep failed: ${error.message}\n`);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
