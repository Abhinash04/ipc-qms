import { mongoose } from '../config/db.js';

/**
 * The workflow store's id counters, kept apart from `Counter` in
 * MailboxMessage.js on purpose.
 *
 * `Counter.value` is a Number incremented atomically with `$inc` to mint
 * mailbox message ids. The workflow store instead holds a whole map —
 * `{ QRY, THREAD, MSG, AUD, NOTIF, STEP, REV, RESP }` — and writing that object
 * into a Number field throws a CastError that fails the entire persist.
 */
const queryCounterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    /**
     * `Mixed`, not `Object`, so per-key atomic operators reach it.
     *
     * Ids are minted with `$inc: { 'value.QRY': 1 }` and the client's reported
     * counter is merged with `$max: { 'value.QRY': n }`. Under a plain `Object`
     * path, Mongoose's strict mode strips those dotted updates and the write
     * silently does nothing.
     */
    value: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { versionKey: false, minimize: false },
);

const QueryCounter =
  mongoose.models.QueryCounter || mongoose.model('QueryCounter', queryCounterSchema);

export { QueryCounter };
