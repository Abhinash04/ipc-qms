import { describe, it, expect, vi } from 'vitest';

import {
  LITERALS,
  SELECTORS,
  UNCALIBRATED,
  describeSpec,
  entryOf,
  locate,
  requireElement,
} from '../services/email/nic/browser/selectors.js';

const fakeSession = (count = 1) => ({ evaluate: vi.fn(async () => count), send: vi.fn(async () => ({})) });

describe('compose selector', () => {
  it('never names the toolbar "send outbox now" control', () => {
    expect(JSON.stringify(SELECTORS)).not.toContain('tpbr-snd-nw-btn');
    expect(JSON.stringify(SELECTORS.composeButton)).toContain('new-btn-opt');
  });

  it('demands the name "New Mail", visible and unique', () => {
    expect(SELECTORS.composeButton).toMatchObject({ name: 'New Mail', visible: true, unique: true });
    expect(SELECTORS.composeButton.strategies[0]).toEqual({ role: 'button', name: 'New Mail' });
  });
});

describe('the registry', () => {
  it('uses no build-hashed CSS-module class — those change on every Zoho deploy', () => {
    const text = JSON.stringify(SELECTORS, (key, value) => (typeof value === 'function' ? value('1') : value));
    expect(text).not.toMatch(/__[a-z0-9]{5,}\b/i);
  });

  it('names only keys that exist', () => {
    for (const key of [...UNCALIBRATED, ...LITERALS]) expect(SELECTORS).toHaveProperty(key);
  });

  it('keeps uncalibrated exactly what no live run has proven — lifting a key is a deliberate diff', () => {
    expect([...UNCALIBRATED].sort()).toEqual(['attachmentEntry', 'ccToggle', 'listRowAttachment']);
  });

  it('names the compose controls by what they are, as the live form showed them', () => {
    expect(SELECTORS.toInput.strategies[0]).toEqual({ role: 'combobox', name: 'To Recipients' });
    expect(SELECTORS.sendButton).toMatchObject({ name: 'Send', strategies: [{ role: 'button', name: 'Send' }, { testid: 'com_send' }] });
    expect(SELECTORS.bodyEditor.strategies[0]).toEqual({ role: 'textbox', name: 'Rich text editor area' });
  });

  it('checks every control the compose flow clicks or types into', () => {
    for (const key of ['composeButton', 'toInput', 'ccToggle', 'ccInput', 'subjectInput', 'bodyEditor', 'sendButton']) {
      expect(SELECTORS[key]).toMatchObject({ visible: true, unique: true });
    }
    expect(SELECTORS.fileInput).toMatchObject({ unique: true });
  });
});

describe('entryOf', () => {
  it('reads a CSS string and a list of them as ordered css strategies', () => {
    expect(entryOf('a')).toEqual({ strategies: [{ css: 'a' }] });
    expect(entryOf(['a', 'b'])).toEqual({ strategies: [{ css: 'a' }, { css: 'b' }] });
    expect(entryOf(SELECTORS.composeButton)).toBe(SELECTORS.composeButton);
  });

  it('refuses an uncalled builder instead of letting it match nothing', () => {
    expect(() => entryOf(SELECTORS.rowById)).toThrow(TypeError);
  });

  it('describes a spec by its strategies', () => {
    expect(describeSpec(SELECTORS.composeButton)).toBe('role="button" name="New Mail" | testid="new-btn-opt"');
  });
});

describe('locate', () => {
  it('does not even ask the page about an uncalibrated spec', async () => {
    const session = fakeSession(1);

    expect(await locate(session, SELECTORS.ccToggle)).toBeNull();
    expect(session.evaluate).not.toHaveBeenCalled();
  });

  it('reads a page script that failed as no match', async () => {
    const session = { evaluate: vi.fn(async () => Promise.reject(new Error('NICeMail page script failed'))) };

    expect(await locate(session, 'button')).toBeNull();
  });
});

describe('requireElement', () => {
  it.each([...UNCALIBRATED])('refuses the uncalibrated "%s" before asking the page anything', async (key) => {
    const session = fakeSession();

    await expect(requireElement(session, key)).rejects.toMatchObject({
      stage: 'ui',
      selector: key,
      uncalibrated: true,
    });
    expect(session.evaluate).not.toHaveBeenCalled();
    expect(session.send).not.toHaveBeenCalled();
  });

  it('still resolves a calibrated element', async () => {
    const session = fakeSession(1);

    const found = await requireElement(session, 'folderInbox');

    expect(found.selector).toBe(SELECTORS.folderInbox);
  });

  it('reports a calibrated element that matches nothing as a recalibration, not a calibration gap', async () => {
    const session = fakeSession(0);

    await expect(requireElement(session, 'folderInbox')).rejects.toMatchObject({
      stage: 'ui',
      selector: 'folderInbox',
      uncalibrated: false,
      message: expect.stringMatching(/Recalibrate/),
    });
  });
});
