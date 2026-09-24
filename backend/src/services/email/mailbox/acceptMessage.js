import {
  QueryCase,
  QueryCounter,
  EmailMessage,
  EmailThread,
} from '../../../models/index.js';
import * as caseMail from '../caseMail.js';
import { isDuplicateKey, OUTCOMES } from '../outbox.js';
import * as audit from '../../audit/auditService.js';
import * as gemmaService from '../../ai/gemmaService.js';
import * as decisions from './decisions.js';
import { ACTOR_TYPES } from '../../../constants/roles.js';
import { AUDIT_RESULTS } from '../../../constants/auditActions.js';

const COUNTER_KEY = 'counters';
const pad = (n) => String(n).padStart(5, '0');

function bareAddress(header) {
  const raw = String(header || '');
  return (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim();
}

function displayName(header) {
  const raw = String(header || '').trim();
  const name = raw.includes('<') ? raw.split('<')[0].trim().replace(/^"|"$/g, '') : '';
  return name || bareAddress(raw);
}

async function mintIds(timestamp) {
  const counter = await QueryCounter.findOneAndUpdate(
    { key: COUNTER_KEY },
    { $inc: { 'value.QRY': 1, 'value.THREAD': 1, 'value.MSG': 1 } },
    { returnDocument: 'after', upsert: true },
  ).lean();

  const year = new Date(timestamp || Date.now()).getUTCFullYear();
  const { QRY, THREAD, MSG } = counter.value;

  return {
    queryId: `QRY-${year}-${pad(QRY)}`,
    threadId: `THREAD-${year}-${pad(THREAD)}`,
    messageId: `MSG-${pad(MSG)}`,
  };
}

const record = (actor, event) => ({
  action: event,
  actorType: ACTOR_TYPES.HUMAN,
  actorId: actor?.id ?? null,
  actorRole: actor?.role ?? null,
});

const isUsable = (summary) =>
  summary?.status === 'GENERATED' || summary?.status === 'FALLBACK';

const SENT = new Set([OUTCOMES.SENT, OUTCOMES.ALREADY_SENT]);

function stepError(step, result, noRecipientMessage = null) {
  if (result.outcome === 'NO_RECIPIENT') {
    return { step, outcome: result.outcome, error: noRecipientMessage || result.error };
  }

  const uncertain = result.outcome === OUTCOMES.UNCERTAIN || result.outcome === OUTCOMES.BLOCKED_UNCERTAIN;
  const inProgress = result.outcome === OUTCOMES.IN_PROGRESS;

  return {
    step,
    outcome: result.outcome,
    error: inProgress ? `The ${step} is being sent by another request.` : result.error,
    ...(result.stage ? { stage: result.stage } : {}),
    ...(uncertain ? { unconfirmed: true } : {}),
    ...(inProgress ? { inProgress: true } : {}),
    ...(result.outcome === OUTCOMES.FAILED ? { retryable: true } : {}),
  };
}

async function summarise({ subject, body, inquirerName }) {
  const startedAt = Date.now();

  try {
    const summary = await gemmaService.generateSummary({ subject, body, inquirerName });

    return {
      summary: {
        ...summary,
        status: summary?.fallback ? 'FALLBACK' : 'GENERATED',
        generatedAt: new Date().toISOString(),
        error: null,
      },
      latencyMs: Date.now() - startedAt,
      error: null,
    };
  } catch (error) {
    return {
      summary: {
        text: '',
        keyPoints: [],
        topics: [],
        aiGenerated: false,
        fallback: false,
        status: 'FAILED',
        generatedAt: new Date().toISOString(),
        error: error.message,
      },
      latencyMs: Date.now() - startedAt,
      error: error.message,
    };
  }
}

export async function acceptMessage({ mailboxMessageId, message = {}, actor, sourceMailbox = null }) {
  const errors = [];

  const existingDecision = await decisions.findDecision(mailboxMessageId);
  const decidedQueryId =
    existingDecision?.decision === 'ACCEPTED' ? existingDecision.queryId : null;

  const already = await EmailMessage.findOne({ sourceMessageId: mailboxMessageId }).lean();

  const knownQueryId = decidedQueryId || already?.queryId || null;
  let known = knownQueryId
    ? await QueryCase.findOne({ queryId: knownQueryId }).lean()
    : null;

  const receivedAt = message.receivedAt || new Date().toISOString();
  const now = new Date().toISOString();
  const senderEmail = bareAddress(message.from);

  let queryId = known?.queryId;
  let minted = null;

  if (!known) {
    minted = await mintIds(receivedAt);

    try {
      await QueryCase.create({
        queryId: minted.queryId,
        subject: message.subject || '(no subject)',
        description: message.body || '',
        source: 'Email',
        inquirer: { id: null, name: displayName(message.from), email: senderEmail },
        workflowState: 'RECEIVED',
        businessStatus: 'OPEN',
        priority: 'NORMAL',
        attachments: message.attachments || [],
        threadId: minted.threadId,
        sourceEmailId: minted.messageId,
        sourceMailboxMessageId: mailboxMessageId,
        sourceMailbox,
        createdAt: now,
        updatedAt: now,
      });
      queryId = minted.queryId;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      known = await QueryCase.findOne({ sourceMailboxMessageId: mailboxMessageId }).lean();
      if (!known) throw error;
      queryId = known.queryId;
    }
  }

  const created = !known;

  if (created) {
    const { threadId } = minted;

    await EmailThread.updateOne(
      { threadId },
      { $setOnInsert: { threadId, queryId, createdAt: now } },
      { upsert: true },
    );

    await EmailMessage.updateOne(
      { sourceMessageId: mailboxMessageId },
      {
        $setOnInsert: {
          messageId: minted.messageId,
          threadId,
          queryId,
          direction: 'INBOUND',
          emailType: 'INCOMING_QUERY',
          timestamp: receivedAt,
          from: message.from || senderEmail,
          to: message.to ? [message.to].flat() : [],
          cc: message.cc || [],
          bcc: message.bcc || [],
          subject: message.subject || '(no subject)',
          body: message.body || '',
          attachments: message.attachments || [],
          sourceMessageId: mailboxMessageId,
          providerMessageId: message.providerMessageId || mailboxMessageId,
          providerThreadId: message.providerThreadId || null,
        },
      },
      { upsert: true },
    );

    await audit.record({ ...record(actor, 'QUERY_RECEIVED'), queryId, details: `Enquiry received from ${senderEmail}.` });
    await audit.record({ ...record(actor, 'QUERY_REGISTERED'), queryId, details: 'Front Office accepted the message and registered the query.' });
    await audit.record({
      ...record(actor, 'CASE_ASSOCIATED'),
      queryId,
      messageId: mailboxMessageId,
      threadId: message.providerThreadId || null,
      details: { source: sourceMailbox?.source ?? null },
    });

    await QueryCase.updateOne(
      { queryId },
      { $set: { workflowState: 'FRONT_OFFICE_VERIFICATION', updatedAt: new Date().toISOString() } },
    );
  }

  let aiSummary = known?.aiSummary ?? null;

  if (!isUsable(aiSummary)) {
    const attempt = await summarise({
      subject: message.subject || '',
      body: message.body || '',
      inquirerName: displayName(message.from),
    });

    aiSummary = attempt.summary;

    await QueryCase.updateOne(
      { queryId },
      { $set: { aiSummary, updatedAt: new Date().toISOString() } },
    );

    await audit.record({
      ...record(actor, 'AI_SUMMARY_GENERATED'),
      actorType: ACTOR_TYPES.AGENT,
      queryId,
      result: attempt.error ? AUDIT_RESULTS.FAILURE : AUDIT_RESULTS.SUCCESS,
      error: attempt.error,
      aiMetadata: {
        latencyMs: attempt.latencyMs,
        fallback: Boolean(aiSummary.fallback),
        aiGenerated: Boolean(aiSummary.aiGenerated),
        status: aiSummary.status,
        trigger: 'accept',
      },
      details: `AI summary ${aiSummary.status.toLowerCase()} for the accepted enquiry.`,
    });

    if (attempt.error) errors.push({ step: 'aiSummary', error: attempt.error });
  }

  const ack = await caseMail.acknowledge({ queryId, actor });
  const acknowledged = SENT.has(ack.outcome);
  if (!acknowledged) {
    errors.push(
      stepError('acknowledgement', ack, 'The incoming message carried no sender address.'),
    );
  }

  const fwd = await caseMail.forward({ queryId, actor, source: created ? message : null });
  const forwarded = SENT.has(fwd.outcome);
  if (!forwarded) errors.push(stepError('forward', fwd));

  return {
    queryId,
    created,
    alreadyDecided: Boolean(known && decidedQueryId),
    acknowledged,
    acknowledgement: {
      outcome: ack.outcome,
      providerMessageId: ack.sent?.providerMessageId || ack.dispatch?.providerMessageId || null,
      sentAt: ack.sent?.sentAt || ack.dispatch?.sentAt || null,
    },
    forwarded,
    aiSummaryStatus: aiSummary?.status ?? null,
    errors,
  };
}
