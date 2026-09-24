import browserConfig from '../../../../config/browserConfig.js';
import { connect as cdpConnect } from './cdp.js';
import { MESSAGES, attachToNicemail, release, scoreTab } from './attach.js';
import { pageKit } from './pageKit.js';
import { LITERALS, SELECTORS, UNCALIBRATED, describeSpec, entryOf } from './selectors.js';
import { extractOpenMessage, inboxView } from './readInbox.js';
import { withNicemail } from './session.js';

const AX_TIMEOUT_MS = 30000;
const AX_NAMED_ROLES = new Set(['button', 'link', 'treeitem', 'tab', 'menuitem', 'textbox', 'searchbox', 'combobox']);
const EXPECTED_ON_INBOX = [
  'appReady',
  'folderInbox',
  'folderActive',
  'mailList',
  'listRow',
  'listRowSender',
  'listRowSubject',
  'listRowDate',
  'listRowSize',
  'previewPane',
];
const POPUPS = new Set(['surveyCloseButton', 'followUpSkipButton']);
const EXPECTED_ON_COMPOSE = [
  'fromAddress',
  'toInput',
  'ccInput',
  'subjectInput',
  'bodyEditor',
  'fileInput',
  'sendButton',
  'discardButton',
];

const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const URL_TEXT = /\bhttps?:\/\/[^\s"'<>]+/g;

function withoutQueryValues(url) {
  try {
    const parsed = new URL(url);
    const keys = [...new Set(parsed.searchParams.keys())];
    return `${parsed.origin}${parsed.pathname}${keys.length ? `?${keys.join('&')}` : ''}${parsed.hash}`;
  } catch {
    return String(url).split('?')[0];
  }
}

export function redact(value, { showAddresses = false } = {}) {
  if (typeof value === 'string') {
    const stripped = value.replace(URL_TEXT, withoutQueryValues);
    return showAddresses ? stripped : stripped.replace(EMAIL, '$1***@$2');
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, { showAddresses }));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [redact(key, { showAddresses }), redact(item, { showAddresses })]),
    );
  }
  return value;
}

export const censusDocument =({ appReady, listRow, maxInventory }, kit) => {
  const { list, crossOrigin } = kit.roots();

  let elements = 0;
  let shadowRoots = 0;
  let sameOriginFrames = 0;
  const hashed = new Map();
  let legacyZm = 0;
  for (const root of list) {
    if (root.nodeType === 11) shadowRoots += 1;
    else if (root !== document) sameOriginFrames += 1;
    for (const element of root.querySelectorAll('*')) {
      elements += 1;
      for (const name of element.classList) {
        if (/__[a-z0-9]{5,}$/i.test(name)) hashed.set(name, (hashed.get(name) || 0) + 1);
        else if (/^zm/.test(name)) legacyZm += 1;
      }
    }
  }

  const withRole = kit.all('[role]');
  const roles = {};
  for (const element of withRole) {
    const role = kit.roleOf(element);
    roles[role] = (roles[role] || 0) + 1;
  }

  const LANDMARKS = ['banner', 'navigation', 'main', 'region', 'search', 'toolbar', 'listbox', 'tree', 'tablist', 'dialog'];
  const landmarks = new Map();
  for (const element of withRole) {
    const role = kit.roleOf(element);
    if (!LANDMARKS.includes(role)) continue;
    const name = kit.nameOf(element).slice(0, 60);
    landmarks.set(`${role}|${name}`, { role, name });
  }

  const INTERACTIVE =
    'button, a[href], input, textarea, select, [contenteditable], [role="button"], [role="link"], ' +
    '[role="textbox"], [role="searchbox"], [role="treeitem"], [role="tab"], [role="menuitem"], ' +
    '[role="checkbox"], [role="combobox"]';
  const groups = new Map();
  for (const element of kit.all(INTERACTIVE)) {
    const inRow = Boolean(element.closest('[role="option"]'));
    const summary = kit.summary(element);
    if (inRow) {
      summary.name = '';
      summary.label = '';
      summary.title = '';
    }
    const key = [inRow, summary.role, summary.name, summary.testid, summary.action].join('|');
    const group = groups.get(key) || { ...summary, inRow, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }

  const rowLike = {};
  for (const element of kit.all('[role="option"], [role="row"], [role="listitem"], article')) {
    const container = element.parentElement?.closest('[role]');
    const where = container ? `${kit.roleOf(container)} "${kit.nameOf(container).slice(0, 40)}"` : 'no container';
    const key = `${kit.roleOf(element) || element.tagName.toLowerCase()} in ${where}`;
    rowLike[key] = (rowLike[key] || 0) + 1;
  }

  return {
    url: `${location.origin}${location.pathname}${location.hash}`,
    title: document.title,
    readyState: document.readyState,
    hidden: document.hidden,
    elements,
    shadowRoots,
    sameOriginFrames,
    crossOriginFrames: crossOrigin,
    appReady: kit.all(appReady).length,
    appReadyLight: document.querySelectorAll(appReady).length,
    rows: kit.all(listRow).length,
    options: kit.all('[role="option"]').length,
    passwordFields: kit.all('input[type="password"]').length,
    roles,
    landmarks: [...landmarks.values()],
    inventory: [...groups.values()].slice(0, maxInventory),
    inventoryGroups: groups.size,
    hashedClasses: { distinct: hashed.size, examples: [...hashed.keys()].slice(0, 8) },
    legacyZmClasses: legacyZm,
    rowLike,
  };
};

const describeRegistry = ({ entries }, kit) =>
  entries.map(([key, entry]) => {
    const checked = kit.resolve(entry);
    const raw = checked.strategy === null ? kit.resolve(entry, { raw: true }) : null;
    const sample = checked.elements[0] || raw?.elements[0];
    return {
      key,
      strategy: checked.strategy,
      count: checked.elements.length,
      rawStrategy: raw ? raw.strategy : checked.strategy,
      rawCount: raw ? raw.elements.length : checked.elements.length,
      tried: checked.tried,
      sample: sample ? kit.summary(sample) : null,
    };
  });

const rowsLoaded = ({ listRow }) => document.querySelectorAll(listRow).length || null;

const probeAttachments = ({ container }, kit) => {
  const root = document.querySelector(container);
  if (!root) return [];
  return [...root.querySelectorAll('[class*="att" i], a[href*="attach" i], [download], [data-filename]')]
    .slice(0, 20)
    .map((element) => ({
      ...kit.summary(element),
      classes: [...element.classList].slice(0, 6),
      attributes: [...element.attributes].map((attribute) => attribute.name).slice(0, 12),
      href: element.href || (element.getAttribute('href') ? new URL(element.getAttribute('href'), location.href).href : null),
      text: kit.norm(element.textContent).slice(0, 60),
    }));
};

function summariseAxTree(nodes) {
  const roles = {};
  const named = new Map();
  for (const node of nodes) {
    const role = node.role?.value;
    if (!role || node.ignored) continue;
    roles[role] = (roles[role] || 0) + 1;
    const name = String(node.name?.value || '').trim();
    if (name && AX_NAMED_ROLES.has(role) && named.size < 80) named.set(`${role}|${name}`, { role, name: name.slice(0, 60) });
  }
  return { nodes: nodes.length, roles, named: [...named.values()] };
}

const flattenFrames = (node, parentId = null) => [
  { id: node.frame.id, parentId, url: node.frame.url },
  ...(node.childFrames || []).flatMap((child) => flattenFrames(child, node.frame.id)),
];

const firstLine = (error) => String(error?.message || error).split('\n')[0];

function registryEntries(firstRowId) {
  const entries = Object.entries(SELECTORS)
    .filter(([key, spec]) => typeof spec !== 'function' && !LITERALS.has(key))
    .map(([key, spec]) => [key, entryOf(spec)]);
  if (firstRowId) {
    for (const key of ['rowById', 'rowUnreadToggleById', 'previewMessageById']) {
      entries.push([`${key}(first row)`, entryOf(SELECTORS[key](firstRowId))]);
    }
  }
  return entries;
}

function registryWarnings(result) {
  const warnings = [];
  const tried = result.tried || [];
  if (result.count === 0) {
    if (tried.some((step) => step.raw > 0 && step.visible === 0)) warnings.push('HIDDEN');
    else if (tried.some((step) => step.visible > 0 && step.named === 0)) warnings.push('NAME_MISMATCH');
    else if (tried.some((step) => step.ambiguous)) warnings.push('AMBIGUOUS');
    else if (result.rawCount === 0) warnings.push('MISSING');
  } else if (result.strategy > 0) {
    warnings.push('FALLBACK');
  }
  return warnings;
}

export async function inspectDocument(session, { rows = 5 } = {}) {
  const doc = { errors: [] };
  const attempt = async (part, work) => {
    try {
      return await work();
    } catch (error) {
      doc.errors.push(`${part}: ${firstLine(error)}`);
      return null;
    }
  };

  doc.frames = await attempt('frames', async () => {
    const { frameTree } = await session.send('Page.getFrameTree');
    return flattenFrames(frameTree);
  });
  doc.census = await attempt('census', () =>
    session.evaluate(
      censusDocument,
      { appReady: SELECTORS.appReady, listRow: SELECTORS.listRow, maxInventory: 60 },
      { kit: pageKit },
    ),
  );
  doc.ax = await attempt('accessibility tree', async () => {
    const { nodes = [] } = await session.send('Accessibility.getFullAXTree', {}, { timeout: AX_TIMEOUT_MS });
    return summariseAxTree(nodes);
  });

  doc.mailApp = Boolean(doc.census?.appReady);
  if (!doc.mailApp) return doc;

  doc.inbox = await attempt('inbox', async () => {
    const view = await inboxView(session);
    return { ...view, total: view.mailRows.length, mailRows: view.mailRows.slice(0, rows) };
  });

  doc.registry = await attempt('registry', async () => {
    const entries = registryEntries(doc.inbox?.mailRows[0]?.providerMessageId);
    const specs = new Map(entries);
    const results = await session.evaluate(describeRegistry, { entries }, { kit: pageKit });
    return results.map((result) => ({
      ...result,
      uncalibrated: UNCALIBRATED.has(result.key),
      spec: describeSpec(specs.get(result.key)),
      warnings: registryWarnings(result),
    }));
  });

  const open = doc.registry?.find((result) => result.key === 'previewMessage');
  if (open?.count) {
    doc.open = await attempt('open message', async () => {
      const extracted = await session.evaluate(extractOpenMessage, {
        sel: SELECTORS,
        messageSelector: SELECTORS.previewMessage,
      });
      if (!extracted) return null;
      const { body, bodyHtml, attachments, ...headers } = extracted;
      return {
        ...headers,
        bodyLength: body.length,
        bodyHtmlLength: bodyHtml?.length ?? null,
        attachments,
        attachmentProbe: await session.evaluate(
          probeAttachments,
          { container: SELECTORS.previewMessage },
          { kit: pageKit },
        ),
      };
    });
  }

  return doc;
}

export async function inspectBrowser({
  connect = cdpConnect,
  attach = attachToNicemail,
  withSession = withNicemail,
  agentTab = false,
  rows = 5,
  showAddresses = false,
} = {}) {
  const report = { endpoint: browserConfig.cdpEndpoint, appUrl: browserConfig.appUrl, targets: [], documents: [] };

  let client;
  try {
    client = await connect(browserConfig.cdpEndpoint, { timeoutMs: browserConfig.timeoutMs });
  } catch (error) {
    report.cdp = { error: firstLine(error) };
    report.diagnosis = diagnose(report);
    return redact(report, { showAddresses });
  }

  try {
    const version = await client.send('Browser.getVersion').catch(() => ({}));
    report.cdp = { product: version.product || null, protocolVersion: version.protocolVersion || null };
    report.contexts = await client
      .send('Target.getBrowserContexts')
      .then(({ defaultBrowserContextId = null, browserContextIds = [] }) => ({ defaultBrowserContextId, browserContextIds }))
      .catch(() => null);

    const targets = await client.listTargets();
    report.otherTargets = {};
    for (const target of targets) {
      if (target.type !== 'page' && target.type !== 'iframe') {
        report.otherTargets[target.type] = (report.otherTargets[target.type] || 0) + 1;
        continue;
      }
      report.targets.push({
        targetId: target.targetId,
        type: target.type,
        url: target.url,
        title: target.title,
        parentId: target.parentId || null,
        browserContextId: target.browserContextId || null,
        score: scoreTab({ url: target.url, title: target.title }),
      });
    }

    const verdict = await attach();
    if (verdict.ok) await release(verdict.data.browser);
    report.attach = verdict.ok
      ? { ok: true, targetId: verdict.data.page.targetId, url: verdict.data.url, title: verdict.data.title }
      : { ok: false, stage: verdict.stage, error: verdict.error };

    for (const target of report.targets.filter((candidate) => candidate.score > 0)) {
      const session = await client.attach(target.targetId);
      try {
        report.documents.push({ targetId: target.targetId, type: target.type, ...(await inspectDocument(session, { rows })) });
      } finally {
        await session.close();
      }
    }

    if (agentTab) {
      const inspectAgentTab = async (session) => {
        await session
          .waitFor(rowsLoaded, { timeout: browserConfig.timeoutMs, argument: { listRow: SELECTORS.listRow } })
          .catch(() => {});
        return inspectDocument(session, { rows });
      };
      const doc = await withSession(inspectAgentTab).catch((error) => ({
        errors: [firstLine(error)],
        stage: error?.stage || null,
      }));
      report.documents.push({ targetId: null, type: 'agent-tab', ...doc });
    }
  } catch (error) {
    report.error = firstLine(error);
  } finally {
    await client.disconnect();
  }

  report.diagnosis = diagnose(report);
  return redact(report, { showAddresses });
}

const SEVERITY = { ok: 0, info: 1, warn: 2, fail: 3 };

export function diagnose(report) {
  const checks = [];
  const check = (status, code, message) => checks.push({ status, code, message });
  const done = () => {
    const worst = checks.reduce((max, entry) => Math.max(max, SEVERITY[entry.status]), 0);
    return { verdict: ['OK', 'OK', 'WARN', 'FAIL'][worst], checks };
  };

  if (report.cdp?.error) {
    check('fail', 'NO_CDP', `${MESSAGES.NO_CHROME} (${report.cdp.error})`);
    return done();
  }
  check('ok', 'CDP', `Connected to ${report.cdp?.product || 'Chrome'} at ${report.endpoint}`);
  if (report.error) check('fail', 'INSPECTION', `The inspection stopped: ${report.error}`);

  const candidates = report.targets.filter((target) => target.score > 0);
  if (!candidates.length) {
    check('fail', 'NO_TAB', MESSAGES.NO_TAB);
    return done();
  }
  check('ok', 'TAB', `NICeMail tab: ${candidates[0].url}`);

  const signIn = report.documents.some((doc) => doc.census?.passwordFields > 0);
  if (report.attach?.stage === 'verify_session' || signIn) {
    check('fail', 'NOT_SIGNED_IN', MESSAGES.NOT_AUTHENTICATED);
    return done();
  }
  check('ok', 'SIGNED_IN', 'Signed in (no sign-in step or password field on any NICeMail document)');

  const apps = report.documents.filter((doc) => doc.mailApp);
  const app = apps.find((doc) => doc.type !== 'agent-tab') || apps[0];
  if (!app) {
    const loading = report.documents.map((doc) => doc.census?.readyState).filter(Boolean);
    check(
      'fail',
      'NO_MAILBOX',
      `No NICeMail document shows the mail list (${SELECTORS.appReady}). Open the Inbox in the NICeMail tab; ` +
        `if it is showing, the list may not have rendered yet${loading.length ? ` (readyState: ${loading.join(', ')})` : ''}.`,
    );
    return done();
  }

  const appTarget = report.targets.find((target) => target.targetId === app.targetId);
  const parent = report.targets.find((target) => target.targetId === appTarget?.parentId);
  if (app.type === 'iframe' && parent) {
    const parentDocument = report.documents.find((doc) => doc.targetId === parent.targetId);
    check(
      'info',
      'MAILBOX_IN_OOPIF',
      `The mailbox is a cross-origin iframe with a CDP target of its own (${app.census.url}), inside ` +
        `${parent.url}, whose own document shows ${parentDocument?.census?.rows ?? 0} mail rows. Anything that reads ` +
        `the tab's main page sees only that shell. The agent is unaffected: it opens ${report.appUrl} as a ` +
        'top-level document of its own.',
    );
  }

  check(
    app.census.shadowRoots ? 'info' : 'ok',
    'SHADOW_DOM',
    app.census.shadowRoots
      ? `${app.census.shadowRoots} open shadow root(s) — searched by the resolver.`
      : 'No shadow DOM in the mail document.',
  );
  if (app.census.appReady && !app.census.appReadyLight) {
    check('fail', 'SHADOW_DOM', 'The mail list sits inside a shadow root, where the reader\'s page code does not look.');
  }
  if (app.census.hidden) {
    check('info', 'HIDDEN_DOCUMENT', 'The document is hidden (a background tab): the agent dispatches DOM events, not mouse input.');
  }

  if (app.census.options && !app.census.rows) {
    check('fail', 'SELECTORS_DRIFTED', `The list shows ${app.census.options} option(s) and none matches listRow.`);
  } else {
    check('ok', 'ROWS', `Mail list rendered: ${app.census.rows} row(s) loaded.`);
  }

  const registry = app.registry || [];
  const missing = registry.filter((result) => EXPECTED_ON_INBOX.includes(result.key) && result.count === 0);
  if (missing.length) {
    check('fail', 'SELECTORS_DRIFTED', `Expected on the Inbox but not found: ${missing.map((result) => result.key).join(', ')}.`);
  }
  const form = registry.filter((result) => EXPECTED_ON_COMPOSE.includes(result.key));
  const absent = form.filter((result) => !result.count);
  if (form.length && absent.length === form.length) {
    check('info', 'COMPOSE', 'No compose form is open, so its controls were not checked. Open New Mail in the NICeMail tab and run this again to check them.');
  } else if (absent.length) {
    check('fail', 'SELECTORS_DRIFTED', `A compose form is open, but not found on it: ${absent.map((result) => result.key).join(', ')}.`);
  } else if (form.length) {
    check('ok', 'COMPOSE', `Compose form open: all ${form.length} of its controls resolve.`);
  }
  const warned = registry.filter(
    (result) => !result.uncalibrated && !POPUPS.has(result.key) && result.warnings.some((warning) => warning !== 'MISSING'),
  );
  if (warned.length) {
    check('warn', 'REGISTRY', warned.map((result) => `${result.key} ${result.warnings.join('/')}`).join('; '));
  }
  const compose = registry.find((result) => result.key === 'composeButton');
  if (compose && !compose.count) {
    check('warn', 'REGISTRY', `composeButton does not resolve: ${compose.warnings.join('/') || 'MISSING'}.`);
  }
  if (registry.length) {
    const calibrated = registry.filter((result) => !result.uncalibrated);
    check(
      'ok',
      'REGISTRY_SUMMARY',
      `${calibrated.filter((result) => result.count).length} of ${calibrated.length} calibrated entries resolve here; ` +
        `${registry.length - calibrated.length} are uncalibrated.`,
    );
  }

  return done();
}

const pad = (label, value) => `  ${String(label).padEnd(34)}${value}`;
const clip = (text, width) => String(text ?? '').replace(/\s+/g, ' ').slice(0, width);
const MARK = { ok: '✓', info: 'i', warn: '!', fail: '✗' };

export function formatReport(report) {
  const lines = [];
  const heading = (title) => lines.push('', `── ${title}`);

  heading('CDP');
  lines.push(pad('Endpoint', report.endpoint));
  if (report.cdp?.error) lines.push(pad('Error', report.cdp.error));
  else lines.push(pad('Browser', `${report.cdp?.product || '?'} (protocol ${report.cdp?.protocolVersion || '?'})`));
  if (report.contexts) {
    lines.push(pad('Browser contexts', `default ${report.contexts.defaultBrowserContextId}, +${report.contexts.browserContextIds.length} other`));
  }

  if (report.targets.length) {
    heading('Pages and iframes Chrome exposes');
    for (const target of report.targets) {
      const mark = target.score > 0 ? `match(${target.score})` : 'no match';
      const parent = target.parentId ? `  in ${target.parentId.slice(0, 8)}` : '';
      lines.push(`  [${mark.padEnd(10)}] ${target.type.padEnd(7)} ${target.targetId.slice(0, 8)} ${clip(target.url, 80)}${parent}`);
    }
    const others = Object.entries(report.otherTargets || {});
    if (others.length) lines.push(`  Other targets: ${others.map(([type, count]) => `${count} ${type}`).join(', ')}`);
  }

  if (report.attach) {
    heading('The tab the agent would attach to');
    if (report.attach.ok) {
      lines.push(pad('Target', report.attach.targetId?.slice(0, 8)), pad('URL', clip(report.attach.url, 90)));
      lines.push(pad('Title', clip(report.attach.title, 70)));
    } else {
      lines.push(pad('Stage reached', report.attach.stage), `  ${report.attach.error}`);
    }
  }

  for (const doc of report.documents) {
    const census = doc.census;
    heading(`${doc.type === 'agent-tab' ? "The agent's own tab" : `Document ${doc.targetId?.slice(0, 8)} (${doc.type})`}`);
    if (census) {
      lines.push(pad('URL', clip(census.url, 90)), pad('Title', clip(census.title, 70)));
      lines.push(pad('Ready / hidden', `${census.readyState} / ${census.hidden ? 'hidden' : 'visible'}`));
      lines.push(pad('Elements', `${census.elements} (${census.shadowRoots} shadow roots, ${census.sameOriginFrames} same-origin frames)`));
      if (census.crossOriginFrames.length) lines.push(pad('Cross-origin frames', clip(census.crossOriginFrames.join(', '), 90)));
      lines.push(pad('Mail list / rows', `${census.appReady ? 'present' : 'absent'} / ${census.rows}`));
      lines.push(pad('Generated classes', `${census.hashedClasses.distinct} hashed (e.g. ${census.hashedClasses.examples.slice(0, 3).join(', ') || '—'}), ${census.legacyZmClasses} legacy zm*`));
      const topRoles = Object.entries(census.roles).sort((a, b) => b[1] - a[1]).slice(0, 12);
      lines.push(pad('Roles', topRoles.map(([role, count]) => `${role} ${count}`).join(', ') || '—'));
      if (census.landmarks.length) lines.push(pad('Landmarks', clip(census.landmarks.map((l) => `${l.role}${l.name ? ` "${l.name}"` : ''}`).join(', '), 120)));
      if (Object.keys(census.rowLike).length) {
        lines.push(pad('Row-like elements', clip(Object.entries(census.rowLike).map(([where, count]) => `${count} ${where}`).join('; '), 120)));
      }
    }
    if (doc.frames) lines.push(pad('Frames (this process)', doc.frames.length));
    if (doc.ax) {
      lines.push(pad('Accessibility tree', `${doc.ax.nodes} nodes`));
      for (const node of doc.ax.named.slice(0, 25)) lines.push(`      ${node.role} "${clip(node.name, 60)}"`);
    }
    if (census?.inventory?.length) {
      lines.push(`  Interactive elements (${census.inventoryGroups} kinds, first ${census.inventory.length}):`);
      for (const item of census.inventory.slice(0, 40)) {
        const hook = [item.testid && `testid=${item.testid}`, item.action && `action=${item.action}`].filter(Boolean).join(' ');
        lines.push(`      ${item.inRow ? `row ×${item.count}` : `×${item.count}`}  ${item.role || item.tag} "${clip(item.name, 40)}" ${hook}${item.visible ? '' : ' (hidden)'}`);
      }
    }

    if (doc.registry) {
      lines.push('  Registry (browser/selectors.js):');
      for (const result of doc.registry) {
        const how = result.count ? `#${result.strategy} → ${result.count}` : `none (raw ${result.rawCount})`;
        const notes = [...result.warnings, result.uncalibrated ? 'UNCALIBRATED' : null].filter(Boolean).join(' ');
        lines.push(`      ${result.key.padEnd(32)}${how.padEnd(16)}${notes}`);
      }
    }
    if (doc.inbox) {
      lines.push(`  Mail rows (${doc.inbox.page}, ${doc.inbox.total} loaded):`);
      for (const row of doc.inbox.mailRows) {
        lines.push(`      ${row.providerMessageId}  ${row.unread ? 'unread' : 'read  '}  ${clip(row.listDate, 10).padEnd(10)} ${clip(row.sizeText, 7).padEnd(7)} ${clip(row.senderAddress || row.senderName, 30).padEnd(30)} ${clip(row.subject, 40)}`);
      }
    }
    if (doc.open) {
      lines.push('  Open message:', pad('From', doc.open.fromAddress), pad('To / Cc / Bcc', `${doc.open.to.length} / ${doc.open.cc.length} / ${doc.open.bcc.length}`));
      lines.push(pad('Timestamp', doc.open.timestampText), pad('Body / HTML', `${doc.open.bodyLength} / ${doc.open.bodyHtmlLength ?? '—'} chars`));
      lines.push(pad('Attachments read', doc.open.attachments.length), pad('Attachment-like elements', doc.open.attachmentProbe.length));
      for (const probe of doc.open.attachmentProbe) {
        lines.push(`      ${probe.tag} ${probe.classes.join('.')} [${probe.attributes.join(',')}] ${clip(probe.href, 60)} "${clip(probe.text, 40)}"`);
      }
    }
    for (const error of doc.errors || []) lines.push(`  (could not read ${error})`);
  }

  heading('Diagnosis');
  for (const entry of report.diagnosis.checks) lines.push(`  ${MARK[entry.status]} ${entry.message}`);
  lines.push('', `  Verdict: ${report.diagnosis.verdict}`);

  return lines;
}
