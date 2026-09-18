import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * What sending through the NICeMail compose form reports, in each outcome.
 *
 * Every other test mocks `sendMail` away, so the one question that decides
 * whether an inquirer is emailed twice was never asked: after Send is pressed,
 * how does the agent tell a sent message from an unsent one?
 *
 * It matters because the callers' idempotency rests on it. The acknowledgement
 * and the final response are each recorded only once a send *succeeds*; a
 * reported failure leaves nothing recorded, so the next ✓ or Approve sends
 * again. So:
 *
 *   - a message that went out must never be reported as a failure;
 *   - a failure before Send is a plain failure — nothing left, safe to retry;
 *   - a failure after Send is not knowable from the UI, and must say so, so the
 *     person retrying checks the Sent folder first.
 *
 * The browser is replaced by a page whose elements appear and disappear the way
 * Zoho's do. The selectors are replaced by name — matching them against the real
 * NICeMail DOM is a calibration question, answered by `nic:browser:discover`,
 * not by a unit test.
 */

const ui = vi.hoisted(() => ({
  present: new Set(),
  clicks: [],
  /** What pressing Send does to the page — the case under test. */
  onSend: () => {},
}));

vi.mock('../config/browserConfig.js', () => ({
  // Short, so the "nothing happened" case fails in milliseconds, not seconds.
  default: { timeoutMs: 60 },
}));

vi.mock('../services/email/nic/browser/session.js', () => ({
  // One unit of browser work, run against the fake page below.
  withNicemail: async (work) => work({}),
}));

vi.mock('../services/email/nic/browser/selectors.js', () => {
  const locator = (key) => {
    const self = {
      first: () => self,
      count: async () => (ui.present.has(key) ? 1 : 0),
      click: async () => {
        ui.clicks.push(key);
        if (key === 'sendButton') ui.onSend();
      },
      pressSequentially: async () => {},
      press: async () => {},
      fill: async () => {},
      setInputFiles: async () => {},
      waitFor: async ({ state = 'visible', timeout = 30000 } = {}) => {
        const reached = () => (state === 'detached' ? !ui.present.has(key) : ui.present.has(key));
        const started = Date.now();
        while (!reached()) {
          if (Date.now() - started > timeout) {
            throw new Error(`locator.waitFor: Timeout ${timeout}ms exceeded (${key} → ${state})`);
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      },
    };
    return self;
  };

  return {
    // `SELECTORS.x` resolves to the key "x", so both call styles in sendMail.js
    // — `requireElement(page, 'sendButton')` and `locate(page, SELECTORS.ccInput)`
    // — name the same element.
    SELECTORS: new Proxy({}, { get: (_, key) => key }),
    locate: async (_root, key) => (ui.present.has(key) ? locator(key) : null),
    locateInFrames: async (_page, key) => (ui.present.has(key) ? locator(key) : null),
    requireElement: async (_root, key) => {
      if (!ui.present.has(key)) {
        throw Object.assign(new Error(`NICeMail UI element "${key}" was not found.`), {
          stage: 'ui',
          selector: key,
        });
      }
      return locator(key);
    },
  };
});

import { sendMail } from '../services/email/nic/browser/sendMail.js';

const MESSAGE = {
  to: ['ravi@pharma.example'],
  subject: 'Acknowledgement of Query Received [QRY-2026-00001]',
  body: 'We have received your query.',
};

beforeEach(() => {
  ui.present = new Set(['composeButton', 'toInput', 'subjectInput', 'bodyEditor', 'sendButton']);
  ui.clicks = [];
  ui.onSend = () => {};
});

describe('sendMail — a message that went out', () => {
  /**
   * The case that was broken. The compose form closes when the message goes,
   * taking the Send button with it. Waiting for the button to disappear used
   * to *look the button up again*, and a lookup of something that is gone
   * throws — so the fastest, most ordinary successful send was reported as a
   * failure ("sendButton was not found"), nothing was recorded, and the next
   * retry emailed the inquirer a second time.
   */
  it('is reported as sent when the form closes before anything else is seen', async () => {
    ui.onSend = () => ui.present.delete('sendButton');

    await expect(sendMail(MESSAGE)).resolves.toMatchObject({ ok: true });
  });

  /**
   * An alert is not a confirmation. It used to be: any `[role=alert]` or
   * `[role=status]` on the page counted as "sent" — which an error such as
   * "invalid recipient" satisfies while the form stays open, and a permanent
   * status region satisfies before Send is even pressed. Either way a message
   * that never left was recorded as sent, and final approval closed the case.
   */
  it('is not taken as sent because an alert appeared while the form stayed open', async () => {
    ui.onSend = () => ui.present.add('sentConfirmation');

    const error = await sendMail(MESSAGE).catch((caught) => caught);

    expect(error.unconfirmed).toBe(true);
  });

  it('is not taken as sent because of a status region already on the page', async () => {
    ui.present.add('sentConfirmation');
    ui.onSend = () => {};

    const error = await sendMail(MESSAGE).catch((caught) => caught);

    expect(error.unconfirmed).toBe(true);
  });

  it('presses Send exactly once', async () => {
    ui.onSend = () => ui.present.delete('sendButton');

    await sendMail(MESSAGE);

    expect(ui.clicks.filter((key) => key === 'sendButton')).toHaveLength(1);
  });
});

describe('sendMail — a message that may have gone out', () => {
  /**
   * Send was pressed and then nothing observable happened within the timeout.
   * The message may be in the Sent folder or may not; the UI cannot say which.
   * Reporting that as an ordinary failure invites a blind retry, and a blind
   * retry of a message that did go out reaches the inquirer twice.
   */
  it('says it is unconfirmed, and says to check the Sent folder before retrying', async () => {
    ui.onSend = () => {};

    const error = await sendMail(MESSAGE).then(
      () => null,
      (caught) => caught,
    );

    expect(error).toBeTruthy();
    expect(error.unconfirmed).toBe(true);
    expect(error.message).toMatch(/may have sent/i);
    expect(error.message).toMatch(/Sent folder/);
  });

  it('keeps the underlying timeout as the cause, for diagnosis', async () => {
    ui.onSend = () => {};

    const error = await sendMail(MESSAGE).catch((caught) => caught);

    expect(error.cause?.message).toMatch(/Timeout/);
  });

  /**
   * The case page's retry buttons reach this through an HTTP endpoint, and the
   * error handler replaces the message of any error that has no status with a
   * bare "Internal Server Error" outside development — so the one instruction
   * that prevents a second copy never reached the person about to retry. A
   * status marks the message as written for the caller, and `details` is what
   * the handler adds to the response body.
   */
  it('carries a status and the flag, so the warning survives the HTTP error handler', async () => {
    ui.onSend = () => {};

    const error = await sendMail(MESSAGE).catch((caught) => caught);

    expect(error.status).toBe(504);
    expect(error.details).toEqual({ unconfirmed: true });
  });
});

describe('sendMail — a message that certainly did not go out', () => {
  /**
   * Anything that fails before Send is pressed leaves nothing sent, so it must
   * NOT carry the unconfirmed flag: a retry here is exactly right, and telling
   * the person to go and check a Sent folder would be crying wolf.
   */
  it('is a plain failure when the compose form cannot be opened', async () => {
    ui.present.delete('composeButton');

    const error = await sendMail(MESSAGE).catch((caught) => caught);

    expect(error.message).toMatch(/composeButton/);
    expect(error.unconfirmed).toBeUndefined();
    expect(ui.clicks).not.toContain('sendButton');
  });

  it('is a plain failure when there is no Send button to press', async () => {
    ui.present.delete('sendButton');

    const error = await sendMail(MESSAGE).catch((caught) => caught);

    expect(error.message).toMatch(/sendButton/);
    expect(error.unconfirmed).toBeUndefined();
  });
});
