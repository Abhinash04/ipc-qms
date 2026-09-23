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
        return [];
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

  const NAMED_BY_CONTENT = new Set([
    'button', 'link', 'treeitem', 'tab', 'menuitem', 'option', 'checkbox', 'radio', 'switch', 'heading', 'cell',
  ]);

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

    if (!view.innerWidth || !view.innerHeight) return true;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };

  const ATTRIBUTE = /^[a-zA-Z_:][-\w:.]*$/;
  const quoted = (value) => JSON.stringify(String(value));

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
