/**
 * Every NICeMail UI selector the browser agent uses, in one place.
 *
 * NICeMail is Zoho-backed and its DOM is generated, so nothing here is known in
 * advance. These are role- and label-based first guesses — accessibility roles
 * are far more stable than Zoho's CSS class names — and they MUST be checked
 * against the live mailbox with `npm run nic:browser:discover`, which reports
 * how many elements each entry matches. Recalibrating the agent means editing
 * this file and nothing else.
 *
 * A spec is `{ role, name }` (getByRole), `{ css }` (locator), or an array of
 * specs tried in order — the first that matches anything wins.
 */

export const SELECTORS = {
  // ── Reading ──────────────────────────────────────────────────────────────
  inboxLink: [{ role: 'link', name: /^inbox/i }, { role: 'treeitem', name: /^inbox/i }],

  messageRow: [{ css: '[role="row"][id]' }, { css: '[role="option"][id]' }, { css: '[role="listitem"][id]' }],

  /** Row attributes that may carry the provider's message id, most specific first. */
  rowIdAttributes: ['data-msgid', 'data-entityid', 'data-id', 'id'],

  readingPane: [{ role: 'main' }, { css: '[role="document"]' }],
  subject: [{ role: 'heading', level: 1 }, { role: 'heading' }],
  fromField: [{ css: '[data-field="from"]' }, { css: '[aria-label^="From"]' }],
  toField: [{ css: '[data-field="to"]' }, { css: '[aria-label^="To"]' }],
  ccField: [{ css: '[data-field="cc"]' }, { css: '[aria-label^="Cc"]' }],
  dateField: [{ css: '[data-field="date"]' }, { css: 'time' }],
  body: [{ css: '[role="document"] iframe' }, { css: '[role="document"]' }],
  attachmentLink: [{ css: '[data-field="attachment"] a' }, { role: 'link', name: /download/i }],

  // ── Composing ────────────────────────────────────────────────────────────
  composeButton: [{ role: 'button', name: /^(new mail|compose|new message|write)$/i }],
  toInput: [{ role: 'combobox', name: /^to/i }, { role: 'textbox', name: /^to/i }],
  ccToggle: [{ role: 'button', name: /^cc$/i }, { role: 'link', name: /^cc$/i }],
  ccInput: [{ role: 'combobox', name: /^cc/i }, { role: 'textbox', name: /^cc/i }],
  subjectInput: [{ role: 'textbox', name: /^subject/i }],
  bodyEditor: [{ css: '[contenteditable="true"]' }],
  fileInput: [{ css: 'input[type="file"]' }],
  sendButton: [{ role: 'button', name: /^send$/i }],
  // Deliberately no "sent confirmation" selector. It was `[role=alert]` /
  // `[role=status]`, which matches error alerts and permanent status regions
  // as readily as a success toast, so a failed send could be recorded as sent.
  // The compose form closing is the signal — see sendMail.js. Add one back only
  // with a text match proven against the live mailbox by nic:browser:discover.
};

const asList = (spec) => (Array.isArray(spec) ? spec : [spec]);

function toLocator(root, spec) {
  if (spec.css) return root.locator(spec.css);
  const { role, ...options } = spec;
  return root.getByRole(role, options);
}

/**
 * The first spec that matches something, as a Locator — or null.
 *
 * `root` is a Page or a Frame; `locateInFrames` searches every frame, for
 * editors Zoho renders inside an iframe.
 */
export async function locate(root, spec) {
  for (const entry of asList(spec)) {
    const locator = toLocator(root, entry);
    try {
      if ((await locator.count()) > 0) return locator;
    } catch {
      // A detached frame answers with an error; it simply has no match.
    }
  }
  return null;
}

export async function locateInFrames(page, spec) {
  for (const frame of page.frames()) {
    const found = await locate(frame, spec);
    if (found) return found;
  }
  return null;
}

/** Like locate(), but a missing element is an error naming the selector. */
export async function requireElement(root, key) {
  const found = await locate(root, SELECTORS[key]);
  if (!found) {
    throw Object.assign(
      new Error(`NICeMail UI element "${key}" was not found. Recalibrate browser/selectors.js.`),
      { stage: 'ui', selector: key },
    );
  }
  return found;
}
