/**
 * The page-side element resolver, shared by every lookup the agent makes.
 *
 * NICeMail is Zoho, and Zoho's class names are generated: a build-hashed class
 * such as `zmbtn__rhuj3` changes on every deploy. What does not change is what
 * an element IS — a button called "New Mail", a textbox labelled "To". So an
 * element is described in selectors.js as an ordered list of strategies, most
 * semantic first, and this resolves them the way a person would look:
 *
 *   1. role + accessible name   { role: 'button', name: 'New Mail' }
 *   2. aria-label               { label: 'Search ( / )' }
 *   3. title                    { title: 'Inbox' }
 *   4. stable attributes        { testid } | { attr, value } | { id }
 *   5. visible text             { text: 'New Mail', tag?: 'button' }
 *   6/7. structure / class      { css: '…' }
 *
 * There is no visual or coordinate fallback: the agent's tab is a background
 * tab Chrome never composites, so there is nothing to look at or hit-test.
 *
 * An entry can also demand that what it found is `visible`, carries the
 * expected accessible `name`, and is `unique`. Those checks are what stop a
 * present-but-wrong element from resolving — the compose selector once matched
 * a hidden "send outbox now" button, because an element that exists counted
 * as found.
 *
 * `pageKit` is serialised by cdp.js and rebuilt inside every evaluated
 * expression, so it must stay self-contained (nothing from module scope) and it
 * must only READ: it runs in the operator's own document during discovery.
 * It searches open shadow roots and same-origin iframes; a cross-origin frame
 * cannot be read from here and is reported instead.
 */
export const pageKit = () => {
  const norm = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

  const matches = (value, want, mode = 'exact') => {
    const have = norm(value).toLowerCase();
    const wanted = norm(want).toLowerCase();
    if (mode === 'prefix') return have.startsWith(wanted);
    if (mode === 'contains') return have.includes(wanted);
    return have === wanted;
  };

  let searched = null;
  /** Every document and shadow root to search, and the frames that could not be. */
  const roots = () => {
    if (searched) return searched;
    searched = { list: [], crossOrigin: [] };
    const visit = (root) => {
      searched.list.push(root);
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) visit(element.shadowRoot);
        if (element.tagName === 'IFRAME' || element.tagName === 'FRAME') {
          let inner;
          try {
            inner = element.contentDocument;
          } catch {
            inner = null;
          }
          if (inner) visit(inner);
          else searched.crossOrigin.push(element.getAttribute('src') || element.getAttribute('name') || '(frame)');
        }
      }
    };
    visit(document);
    return searched;
  };

  const all = (css) => {
    const found = [];
    for (const root of roots().list) {
      try {
        found.push(...root.querySelectorAll(css));
      } catch {
        return []; // A selector the page rejects matches nothing.
      }
    }
    return found;
  };

  const textOf = (element) => norm(element.innerText ?? element.textContent);

  const roleOf = (element) => {
    const explicit = norm(element.getAttribute('role')).split(' ')[0];
    if (explicit) return explicit.toLowerCase();

    const tag = element.tagName;
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
    if (tag === 'A' && element.hasAttribute('href')) return 'link';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'OPTION') return 'option';
    if (tag === 'INPUT') {
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'search') return 'searchbox';
      if (['text', 'email', 'tel', 'url'].includes(type)) return 'textbox';
      return null;
    }
    const editable = element.getAttribute('contenteditable');
    if (editable === '' || editable === 'true') return 'textbox';
    return null;
  };

  /** Where each role's candidates can be, before the role is checked exactly. */
  const ROLE_CSS = {
    button: 'button, summary, input, [role]',
    link: 'a[href], [role]',
    textbox: 'input, textarea, [contenteditable], [role]',
    searchbox: 'input, [role]',
    checkbox: 'input, [role]',
    radio: 'input, [role]',
    combobox: 'select, [role]',
    option: 'option, [role]',
  };

  /** Roles whose accessible name comes from their content. */
  const NAMED_BY_CONTENT = new Set([
    'button', 'link', 'treeitem', 'tab', 'menuitem', 'option', 'checkbox', 'radio', 'switch', 'heading', 'cell',
  ]);

  /** The accessible name, by the common cases of the spec's precedence. */
  const nameOf = (element) => {
    const labelledBy = norm(element.getAttribute('aria-labelledby'));
    if (labelledBy) {
      const text = norm(
        labelledBy
          .split(' ')
          .map((id) => element.ownerDocument.getElementById(id))
          .filter(Boolean)
          .map(textOf)
          .join(' '),
      );
      if (text) return text;
    }

    const label = norm(element.getAttribute('aria-label'));
    if (label) return label;

    if (element.labels?.length) {
      const text = norm([...element.labels].map(textOf).join(' '));
      if (text) return text;
    }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) {
      const placeholder = norm(element.getAttribute('placeholder'));
      if (placeholder) return placeholder;
    }
    if (element.tagName === 'IMG') {
      const alt = norm(element.getAttribute('alt'));
      if (alt) return alt;
    }
    if (NAMED_BY_CONTENT.has(roleOf(element))) {
      const text = textOf(element);
      if (text) return text;
    }
    return norm(element.getAttribute('title'));
  };

  const visible = (element) => {
    if (!element.isConnected || element.closest('[aria-hidden="true"]')) return false;

    const view = element.ownerDocument.defaultView;
    if (typeof element.checkVisibility === 'function') {
      if (!element.checkVisibility({ visibilityProperty: true })) return false;
    } else {
      for (let node = element; node?.nodeType === 1; node = node.parentElement) {
        if (view.getComputedStyle(node).display === 'none') return false;
      }
      if (view.getComputedStyle(element).visibility === 'hidden') return false;
    }

    // A tab that was never given a size lays nothing out, so a zero-sized box
    // there says nothing about the element. Only a real viewport can judge.
    if (!view.innerWidth || !view.innerHeight) return true;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };

  const ATTRIBUTE = /^[a-zA-Z_:][-\w:.]*$/;
  const quoted = (value) => JSON.stringify(String(value));

  /** The CSS that collects a strategy's candidates; the strategy then filters them. */
  const candidatesFor = (strategy) => {
    if (strategy.css) return strategy.css;
    if (strategy.testid !== undefined) return `[data-testid=${quoted(strategy.testid)}]`;
    if (strategy.attr !== undefined) {
      if (!ATTRIBUTE.test(strategy.attr)) return null;
      return strategy.value === undefined ? `[${strategy.attr}]` : `[${strategy.attr}=${quoted(strategy.value)}]`;
    }
    if (strategy.id !== undefined) return `[id=${quoted(strategy.id)}]`;
    if (strategy.label !== undefined) return '[aria-label]';
    if (strategy.title !== undefined) return '[title]';
    if (strategy.role) return ROLE_CSS[strategy.role] || '[role]';
    if (strategy.text !== undefined) return strategy.tag || '*';
    return null;
  };

  const find = (strategy) => {
    const css = candidatesFor(strategy);
    if (!css) return [];

    let found = all(css);
    if (strategy.role) found = found.filter((element) => roleOf(element) === strategy.role);
    if (strategy.label !== undefined) {
      found = found.filter((element) => matches(element.getAttribute('aria-label'), strategy.label, strategy.match));
    }
    if (strategy.title !== undefined) {
      found = found.filter((element) => matches(element.getAttribute('title'), strategy.title, strategy.match));
    }
    if (strategy.role && strategy.name !== undefined) {
      found = found.filter((element) => matches(nameOf(element), strategy.name, strategy.match));
    }
    if (strategy.text !== undefined) {
      found = found.filter((element) => matches(textOf(element), strategy.text, strategy.match));
    }
    return [...new Set(found)];
  };

  /**
   * The elements an entry resolves to: those of the first strategy that
   * produces any, after the entry's own checks. `raw` skips the checks —
   * "is anything there at all", which is what waiting for an element to go
   * away asks. `tried` holds counts only, never element text, because it ends
   * up in error messages and those can reach the outbox.
   */
  const resolve = (entry, { raw = false } = {}) => {
    const tried = [];
    for (const [strategy, spec] of entry.strategies.entries()) {
      const found = find(spec);
      if (!found.length) {
        tried.push({ strategy, raw: 0 });
        continue;
      }
      if (raw) return { strategy, elements: found, tried };

      const shown = entry.visible ? found.filter(visible) : found;
      const named = entry.name !== undefined ? shown.filter((element) => matches(nameOf(element), entry.name, entry.match)) : shown;
      const ambiguous = Boolean(entry.unique) && named.length > 1;
      tried.push({ strategy, raw: found.length, visible: shown.length, named: named.length, ambiguous });
      if (named.length && !ambiguous) return { strategy, elements: named, tried };
    }
    return { strategy: null, elements: [], tried, crossOrigin: roots().crossOrigin };
  };

  const clip = (value, width = 60) => norm(value).slice(0, width);

  /** What an element is, for a report. Clipped; addresses are masked by the caller. */
  const summary = (element) => ({
    tag: element.tagName.toLowerCase(),
    role: roleOf(element),
    name: clip(nameOf(element)),
    label: clip(element.getAttribute('aria-label')),
    title: clip(element.getAttribute('title')),
    testid: element.getAttribute('data-testid'),
    action: element.getAttribute('data-action'),
    id: clip(element.id, 40),
    visible: visible(element),
  });

  return { norm, matches, roots, all, textOf, roleOf, nameOf, visible, find, resolve, summary };
};
