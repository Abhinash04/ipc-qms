import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * What sending through the NICeMail compose form reports, in each outcome.
 *
 * The callers' idempotency rests on it. The acknowledgement and the final
 * response are each recorded only once a send *succeeds*; a reported failure
 * leaves nothing recorded, so the next ✓ or Approve sends again. So:
 *
 *   - a message counts as sent only when the form closed AND it is in the Sent
 *     folder, newer than the press of Send — never on the click alone;
 *   - a failure before Send is a plain failure: the draft is discarded, nothing
 *     went, and a retry is safe;
 *   - a failure after Send cannot be read from the UI, and must say so, so the
 *     person retrying checks the Sent folder first.
 *
 * The browser is a fake page that behaves the way the calibrated Zoho form
 * does (npm run nic:browser:calibrate): New Mail opens the form, an address
 * typed into To and committed becomes a chip, Send closes the form and files
 * the message under Sent. The real selectors resolve against it by key.
 */

const page = vi.hoisted(() => ({ state: null }));
const browser = vi.hoisted(() => ({ opened: 0 }));

vi.mock('../config/browserConfig.js', () => ({
  // Short, so the "nothing happened" cases fail in milliseconds, not seconds.
  default: { timeoutMs: 60, mailboxAddress: 'nic-mailbox@test.invalid' },
}));

vi.mock('../services/email/nic/browser/session.js', () => ({
  withNicemail: async (work) => {
    browser.opened += 1;
    return work(page.state.session);
  },
}));

import { SELECTORS } from '../services/email/nic/browser/selectors.js';
import { waitTimeout } from '../services/email/nic/browser/cdp.js';
import { composeEmail, sendMail } from '../services/email/nic/browser/sendMail.js';
import { ACKNOWLEDGEMENT_BODY } from '../services/email/templates/acknowledgement.js';

const MAILBOX = 'nic-mailbox@test.invalid';
const INQUIRER = 'ravi@pharma.example';
const MESSAGE = {
  to: [INQUIRER],
  subject: 'Acknowledgement of Query Received [QRY-2026-00001]',
  body: 'Dear Ravi,\nWe have received your query.',
};

const FORM = ['toInput', 'ccInput', 'subjectInput', 'bodyEditor', 'fileInput', 'sendButton', 'discardButton', 'fromAddress'];

/** NICeMail's survey dialog, as the live page shows it. */
const SURVEY = {
  name: '',
  text: 'Email Satisfaction Survey for the new NICeMail Services. Participate now!',
  buttons: ['Close', 'Participate now!'],
};

/** The prompt Zoho raises on Send when the body reads like it expects a reply. */
const FOLLOW_UP = {
  name: '',
  text: 'Add follow-up reminder? You can add follow-up reminder, as your message has below text. as soon as possible',
  buttons: ['Close', '10 minutes', 'Add Reminder and Send', 'Skip and Send'],
};

/** Which registry key a spec handed to the page is. */
const keyOf = (spec) => Object.keys(SELECTORS).find((key) => JSON.stringify(SELECTORS[key]) === JSON.stringify(spec));

function fakePage() {
  const state = {
    present: new Set(['composeButton']),
    from: `From ${MAILBOX}`,
    chips: { toInput: [], ccInput: [] },
    subject: '',
    body: '',
    route: '#mail/folder/inbox',
    sent: [],
    clicks: [],
    sends: [],
    chooser: null,
    /** The survey dialog is open; `surveyCloses: false` makes its Close do nothing. */
    survey: false,
    surveyCloses: true,
    /** Dialogs other than the survey. */
    dialogs: [],
    /** What the form makes of a typed address — an autocomplete can pick another. */
    chipFor: (address) => address,
    /** The follow-up reminder prompt is open, holding the message. */
    followUp: false,
    /** The message leaves: the form closes and Sent has it. */
    deliver: () => {
      for (const key of FORM) state.present.delete(key);
      state.sent.unshift({ providerMessageId: `${Date.now()}141600`, subject: state.subject, senderAddress: `"Ravi"<${INQUIRER}>` });
    },
    /** What pressing Send does. By default: the message goes. */
    onSend: () => state.deliver(),
  };

  const has = (key) => {
    if (key === 'surveyCloseButton') return state.survey;
    if (key === 'followUpSkipButton') return state.followUp;
    return state.present.has(key);
  };

  const handlers = {
    countMatching: ({ spec }) => (has(keyOf(spec)) ? 1 : 0),
    isVisible: ({ spec }) => has(keyOf(spec)),
    clickOn: ({ spec }) => {
      const key = keyOf(spec);
      if (!has(key)) return false;
      state.clicks.push(key);
      if (key === 'composeButton') for (const field of FORM) state.present.add(field);
      if (key === 'sendButton') state.onSend();
      if (key === 'discardButton') for (const field of FORM) state.present.delete(field);
      if (key === 'fileInput') state.chooser?.({ backendNodeId: 7, mode: 'selectMultiple' });
      if (key === 'surveyCloseButton' && state.surveyCloses) {
        state.survey = false;
        state.afterSurveyClose?.();
      }
      if (key === 'followUpSkipButton') {
        state.followUp = false;
        state.deliver();
      }
      return true;
    },
    sentShown: () => state.route === SELECTORS.sentFolderRoute,
    openDialogs: () => [...(state.survey ? [SURVEY] : []), ...(state.followUp ? [FOLLOW_UP] : []), ...state.dialogs],
    surveyGone: () => !state.survey || null,
    formState: () => ({
      hash: state.route,
      live: [],
      tabs: [],
      send: { raw: has('sendButton') ? 1 : 0, visible: has('sendButton') ? 1 : 0, disabled: 0 },
      active: null,
      editor: { frameFocused: true, focusedInFrame: true, heldLength: state.body.length },
    }),
    fillIn: ({ spec, value }) => {
      if (keyOf(spec) === 'subjectInput') state.subject = value;
      return true;
    },
    entryShown: ({ spec }) => state.present.has(keyOf(spec)) || null,
    entryGone: ({ spec }) => !state.present.has(keyOf(spec)) || null,
    nameOfEntry: () => state.from,
    typeRecipient: ({ spec, address }) => state.chips[keyOf(spec)].push(state.chipFor(address)),
    recipientChips: ({ spec }) => state.chips[keyOf(spec)],
    valueOf: () => state.subject,
    focusEntry: () => true,
    textOf: () => state.body,
    attachmentReady: () => true,
    openRoute: ({ route }) => {
      state.route = route;
      return true;
    },
    listRows: () => (state.route === SELECTORS.sentFolderRoute ? state.sent : []),
  };

  const call = (fn, argument) => {
    const handler = handlers[fn.name];
    if (!handler) throw new Error(`fake page has no handler for ${fn.name}`);
    return handler(argument);
  };

  state.session = {
    evaluate: async (fn, argument) => call(fn, argument),
    waitFor: async (fn, { argument, timeout = 60 } = {}) => {
      const started = Date.now();
      for (;;) {
        const value = call(fn, argument);
        if (value) return value;
        if (Date.now() - started > timeout) throw waitTimeout(`${fn.name} never became true`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
    send: async (method, params) => {
      state.sends.push([method, params]);
      if (method === 'Input.insertText') {
        state.body += params.text;
        state.afterBody?.();
      }
      return {};
    },
    on: (method, listener) => {
      if (method === 'Page.fileChooserOpened') state.chooser = listener;
      return () => {};
    },
  };

  return state;
}

beforeEach(() => {
  page.state = fakePage();
  browser.opened = 0;
});

describe('composeEmail — a message that went out', () => {
  it('is sent only once the form closed and the message is in the Sent folder, and returns its id', async () => {
    const result = await composeEmail(MESSAGE);

    expect(result).toMatchObject({ ok: true, providerMessageId: page.state.sent[0].providerMessageId });
    expect(Date.parse(result.sentAt)).not.toBeNaN();
    // Back on the Inbox afterwards, where the next sync expects the tab.
    expect(page.state.route).toBe(SELECTORS.folderRoute);
  });

  it('fills the form with exactly the recipient, subject and body it was given', async () => {
    await composeEmail(MESSAGE);

    expect(page.state.chips.toInput).toEqual([INQUIRER]);
    expect(page.state.subject).toBe(MESSAGE.subject);
    expect(page.state.body).toBe(MESSAGE.body);
  });

  it('presses Send exactly once', async () => {
    await composeEmail(MESSAGE);

    expect(page.state.clicks.filter((key) => key === 'sendButton')).toHaveLength(1);
  });

  it('adds Cc recipients when there are some', async () => {
    await composeEmail({ ...MESSAGE, cc: ['clerk@pharma.example'] });

    expect(page.state.chips.ccInput).toEqual(['clerk@pharma.example']);
  });

  it('attaches files through the file chooser, handing it the staged files', async () => {
    await composeEmail({ ...MESSAGE, attachments: [{ filename: 'reply.pdf', content: Buffer.from('%PDF-1.4') }] });

    const [, params] = page.state.sends.find(([method]) => method === 'DOM.setFileInputFiles');
    expect(params.backendNodeId).toBe(7);
    expect(params.files).toHaveLength(1);
    expect(params.files[0]).toMatch(/reply\.pdf$/);
  });

  /**
   * The filename reaches here from whatever an external sender called the
   * file: NICeMail's attachment row, through the store's metadata, onto the
   * forward. attachmentPolicy checks the extension, the type and the size and
   * never the path, so a name carrying "../" would otherwise resolve outside
   * the staging directory that join() is supposed to confine it to.
   */
  it('stages an attachment under its base name, whatever path the sender put in it', async () => {
    await composeEmail({
      ...MESSAGE,
      attachments: [{ filename: '../../../escaped.pdf', content: Buffer.from('%PDF-1.4') }],
    });

    const [, params] = page.state.sends.find(([method]) => method === 'DOM.setFileInputFiles');
    expect(params.files[0]).toMatch(/qms-nic-send-[^/\\]*[/\\]escaped\.pdf$/);
    expect(params.files[0]).not.toMatch(/\.\./);
  });

  it('refuses an attachment whose filename is only a path', async () => {
    await expect(
      composeEmail({ ...MESSAGE, attachments: [{ filename: '../..', content: Buffer.from('x') }] }),
    ).rejects.toThrow(/unusable filename/);
  });

  it('is still sendMail to the transport', () => {
    expect(sendMail).toBe(composeEmail);
  });

  it('reports each step as it completes, ending with the Sent-folder id', async () => {
    const stages = [];

    const result = await composeEmail(MESSAGE, { onStage: (phase, data) => stages.push(`${phase}:${data.step}`) });

    expect(stages).toEqual([
      'NIC BROWSER:compose_started',
      'NIC BROWSER:browser_ready',
      'NIC BROWSER:survey_absent',
      'NIC BROWSER:compose_opened',
      'NIC BROWSER:from_verified',
      'NIC BROWSER:recipient_entered',
      'NIC BROWSER:recipients_verified',
      'NIC BROWSER:subject_verified',
      'NIC BROWSER:body_verified',
      'NIC BROWSER:pre_send_clear',
      'NIC BROWSER:send_clicked',
      'VERIFICATION:compose_closed',
      'VERIFICATION:sent_found',
    ]);
    expect(result.providerMessageId).toBe(page.state.sent[0].providerMessageId);
  });

  it('is not stopped by a stage listener that throws', async () => {
    const result = await composeEmail(MESSAGE, {
      onStage: () => {
        throw new Error('log sink down');
      },
    });

    expect(result.ok).toBe(true);
  });

  it('closes the survey dialog with its own Close button — and presses nothing else in it', async () => {
    page.state.survey = true;
    const stages = [];

    const result = await composeEmail(MESSAGE, { onStage: (phase, data) => stages.push(data.step) });

    expect(result.ok).toBe(true);
    expect(page.state.clicks.filter((key) => key === 'surveyCloseButton')).toHaveLength(1);
    expect(stages).toContain('survey_closed');
    expect(page.state.clicks.filter((key) => key === 'sendButton')).toHaveLength(1);
  });

  it('closes a survey that opens while the form is filled, checks the form again, then sends once', async () => {
    page.state.afterBody = () => {
      page.state.survey = true;
    };

    const result = await composeEmail(MESSAGE);

    expect(result.ok).toBe(true);
    const order = page.state.clicks.filter((key) => key === 'surveyCloseButton' || key === 'sendButton');
    expect(order).toEqual(['surveyCloseButton', 'sendButton']);
  });

  it('waits for an editor that lays the body out a moment late', async () => {
    page.state.session.send = async (method, params) => {
      if (method === 'Input.insertText') setTimeout(() => (page.state.body += params.text), 20);
      return {};
    };

    const result = await composeEmail(MESSAGE);

    expect(result.ok).toBe(true);
  });

  it('sends the acknowledgement body as it is, blank lines and all', async () => {
    const result = await composeEmail({ ...MESSAGE, body: ACKNOWLEDGEMENT_BODY });

    expect(result.ok).toBe(true);
    expect(page.state.body).toBe(ACKNOWLEDGEMENT_BODY);
  });

  it('answers the follow-up reminder prompt with "Skip and Send", once, so the message goes as written', async () => {
    page.state.onSend = () => {
      page.state.followUp = true;
    };
    const stages = [];

    const result = await composeEmail({ ...MESSAGE, body: ACKNOWLEDGEMENT_BODY }, { onStage: (phase, data) => stages.push(data) });

    expect(result.ok).toBe(true);
    expect(page.state.clicks.filter((key) => key === 'followUpSkipButton')).toHaveLength(1);
    expect(page.state.clicks.filter((key) => key === 'sendButton')).toHaveLength(1);
    expect(stages.map((data) => data.step)).toContain('follow_up_reminder_skipped');
    expect(stages.find((data) => data.step === 'compose_closed')).toMatchObject({ followUpSkipped: true });
  });

  it('counts a message found in Sent as sent even when the form stayed open', async () => {
    page.state.onSend = () => {
      page.state.sent.unshift({ providerMessageId: `${Date.now()}141600`, subject: page.state.subject, senderAddress: INQUIRER });
    };
    const stages = [];

    const result = await composeEmail(MESSAGE, { onStage: (phase, data) => stages.push(data.step) });

    expect(result.providerMessageId).toBe(page.state.sent[0].providerMessageId);
    expect(stages).toContain('compose_not_closed');
    expect(stages.at(-1)).toBe('sent_found');
  });
});

describe('composeEmail — a message that may have gone out', () => {
  it('is unconfirmed when the form never closes, and keeps the timeout as the cause', async () => {
    page.state.onSend = () => {};

    const error = await composeEmail(MESSAGE).catch((caught) => caught);

    expect(error.unconfirmed).toBe(true);
    expect(error.message).toMatch(/may have sent/i);
    expect(error.message).toMatch(/Sent folder/);
    expect(error.cause?.message).toMatch(/Timeout/);
  });

  it('is unconfirmed when the form closed but the message is not in the Sent folder', async () => {
    page.state.onSend = () => {
      for (const key of FORM) page.state.present.delete(key);
    };

    const error = await composeEmail(MESSAGE).catch((caught) => caught);

    expect(error.unconfirmed).toBe(true);
    expect(error.message).toMatch(/did not appear in the Sent folder/);
  });

  it('does not take a message with the same subject sent a minute earlier as proof', async () => {
    // A retried case, or a test re-run after a database reset: same subject,
    // same recipient, and recent — but from before this press.
    page.state.sent = [{ providerMessageId: `${Date.now() - 60000}141600`, subject: MESSAGE.subject, senderAddress: INQUIRER }];
    page.state.onSend = () => {};

    const error = await composeEmail(MESSAGE).catch((caught) => caught);

    expect(error.unconfirmed).toBe(true);
  });

  it('does not take an older message with the same subject as proof', async () => {
    page.state.sent = [{ providerMessageId: '1700000000000141600', subject: MESSAGE.subject, senderAddress: INQUIRER }];
    page.state.onSend = () => {
      for (const key of FORM) page.state.present.delete(key);
    };

    const error = await composeEmail(MESSAGE).catch((caught) => caught);

    expect(error.unconfirmed).toBe(true);
  });

  it('carries a status and the flag, so the warning survives the HTTP error handler', async () => {
    page.state.onSend = () => {};

    const error = await composeEmail(MESSAGE).catch((caught) => caught);

    expect(error.status).toBe(504);
    expect(error.details).toEqual({ unconfirmed: true });
  });

  it('names the step and what the page showed when the form never closes', async () => {
    page.state.onSend = () => {};
    const stages = [];

    const error = await composeEmail(MESSAGE, { onStage: (phase, data) => stages.push(data) }).catch((caught) => caught);

    expect(error.failedStep).toBe('await_compose_close');
    expect(error.seen).toMatch(/Send button still visible/);
    expect(stages.find((data) => data.step === 'compose_not_closed').snapshot.send).toMatchObject({ visible: 1 });
  });

  it('leaves the follow-up prompt alone when another dialog shares the screen with it', async () => {
    page.state.onSend = () => {
      page.state.followUp = true;
      page.state.dialogs = [{ name: 'Session expired', text: 'Sign in again', buttons: ['OK'] }];
    };

    const error = await composeEmail(MESSAGE).catch((caught) => caught);

    expect(error.unconfirmed).toBe(true);
    expect(page.state.clicks).not.toContain('followUpSkipButton');
    expect(error.seen).toMatch(/Add follow-up reminder/);
  });

  it('is unconfirmed, never "not sent", when checking the Sent folder fails after Send', async () => {
    const openRoute = page.state.session.evaluate;
    page.state.session.evaluate = async (fn, argument, options) => {
      if (fn.name === 'openRoute' && argument.route === SELECTORS.sentFolderRoute) throw new Error('tab went away');
      return openRoute(fn, argument, options);
    };

    const error = await composeEmail(MESSAGE).catch((caught) => caught);

    expect(error.unconfirmed).toBe(true);
    expect(error.failedStep).toBe('find_in_sent');
    expect(error.cause.message).toBe('tab went away');
  });
});

describe('composeEmail — a message that certainly did not go out', () => {
  const failsBeforeSend = async (message = MESSAGE) => {
    const error = await composeEmail(message).catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.unconfirmed).toBeUndefined();
    expect(page.state.clicks).not.toContain('sendButton');
    return error;
  };

  it.each([
    ['no recipient', { ...MESSAGE, to: [] }],
    ['a malformed recipient', { ...MESSAGE, to: ['not-an-address'] }],
    ['a malformed Cc', { ...MESSAGE, cc: ['clerk@'] }],
  ])('refuses %s before a browser is even opened', async (_, message) => {
    const error = await failsBeforeSend(message);

    expect(error.stage).toBe('validate');
    expect(browser.opened).toBe(0);
  });

  it('refuses to send from another account than the NICeMail mailbox, and discards the draft', async () => {
    page.state.from = 'From someone.else@test.invalid';

    const error = await failsBeforeSend();

    expect(error.stage).toBe('verify_session');
    expect(error.failedStep).toBe('verify_from');
    expect(page.state.clicks).toContain('discardButton');
  });

  it('does not press Send while an unknown dialog is open, and says which', async () => {
    page.state.dialogs = [{ name: 'Confirm', text: 'Are you sure?', buttons: ['OK', 'Cancel'] }];

    const error = await failsBeforeSend();

    expect(error.failedStep).toBe('pre_send_check');
    expect(error.message).toMatch(/"Confirm"/);
    expect(page.state.clicks).toContain('discardButton');
  });

  it('refuses when the survey will not close, before a form is even opened', async () => {
    page.state.survey = true;
    page.state.surveyCloses = false;

    const error = await failsBeforeSend();

    expect(error.failedStep).toBe('close_survey');
    expect(page.state.clicks).not.toContain('composeButton');
  });

  it('does not press Send when closing the survey opens another dialog', async () => {
    page.state.afterBody = () => {
      page.state.survey = true;
    };
    page.state.afterSurveyClose = () => {
      page.state.dialogs = [{ name: 'Remind me later?', text: 'We will ask again', buttons: ['Yes', 'No'] }];
    };

    const error = await failsBeforeSend();

    expect(error.failedStep).toBe('pre_send_check');
    expect(error.message).toMatch(/Remind me later/);
  });

  it('never closes the survey while another dialog shares the screen with it', async () => {
    page.state.survey = true;
    page.state.dialogs = [{ name: 'Session expired', text: 'Sign in again', buttons: ['OK'] }];

    const error = await failsBeforeSend();

    expect(error.message).toMatch(/besides its survey/);
    expect(page.state.clicks).not.toContain('surveyCloseButton');
  });

  it('refuses when the form took a different recipient than intended — an autocomplete pick', async () => {
    page.state.chipFor = () => 'ravi.kumar@elsewhere.example';

    await failsBeforeSend();

    expect(page.state.clicks).toContain('discardButton');
  });

  it('refuses when the To line holds a recipient nobody asked for', async () => {
    page.state.chips.toInput.push('leftover@pharma.example');

    await failsBeforeSend();
  });

  it('refuses when the editor does not hold the body', async () => {
    page.state.session.send = async () => ({});

    const error = await failsBeforeSend();

    expect(error.message).toMatch(/editor does not hold/);
    expect(page.state.clicks).toContain('discardButton');
  });

  it('is a plain failure when the compose form cannot be opened', async () => {
    page.state.present.delete('composeButton');

    const error = await failsBeforeSend();

    expect(error.message).toMatch(/composeButton/);
  });
});
