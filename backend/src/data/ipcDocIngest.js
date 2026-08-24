const MATH_MACROS = [
  'rightleftharpoons',
  'rightarrow',
  'antilog',
  'approx',
  'lambda',
  'alpha',
  'gamma',
  'delta',
  'sigma',
  'theta',
  'omega',
  'infty',
  'ldots',
  'sqrt',
  'circ',
  'cdot',
  'left',
  'right',
  'beta',
  'sum',
  'log',
  'leq',
  'geq',
  'pi',
  'pm',
  'mu',
];

const ROSTER_HEADINGS = [
  'commission members',
  'ipc secretariat and staff',
  'secretary-cum-scientific director, ipc',
  'personnel staff to the secretary-cum-scientific director',
  'analytical research and development division',
  'reference standard division',
  'phytopharmaceuticals division',
  'biologics division',
  'microbiology division',
];

const DISCLAIMER_FINGERPRINT = 'This Guidance Document is compiled by';

const MIN_CHUNK_CHARS = 40;
const MAX_CHUNK_CHARS = 1600;

export function repairLatexEscapes(text) {
  if (!text) return '';

  let out = String(text)
    .replace(/\r(?=ightleftharpoons)/g, '\\r')
    .replace(/\r(?=ightarrow)/g, '\\r')
    .replace(/\t(?=imes)/g, '\\t')
    .replace(/\t(?=ext)/g, '\\t')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  out = out.replace(/(^|[^\\a-zA-Z])rac\{/g, '$1\\frac{');

  const macroPattern = new RegExp(`(?<!\\\\)\\b(${MATH_MACROS.join('|')})\\b`, 'g');
  out = out.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, (span) =>
    span.replace(macroPattern, '\\$1'),
  );

  return out;
}

export function stripBoilerplate(markdown) {
  const lines = String(markdown || '').split('\n');
  const kept = [];
  let skipping = false;
  let skipLevel = 0;

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);

    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim().toLowerCase();

      if (skipping && level <= skipLevel) {
        skipping = false;
      }

      if (!skipping && (title === 'disclaimer' || title === 'references')) {
        skipping = true;
        skipLevel = level;
        continue;
      }
    }

    if (skipping) continue;
    if (line.includes(DISCLAIMER_FINGERPRINT)) continue;
    kept.push(line);
  }

  return kept.join('\n');
}

function isRosterHeading(title) {
  return ROSTER_HEADINGS.includes(title.trim().toLowerCase());
}

function splitOversized(text) {
  if (text.length <= MAX_CHUNK_CHARS) return [text];

  const paragraphs = text.split(/\n{2,}/);
  const parts = [];
  let buffer = '';

  for (const paragraph of paragraphs) {
    if (buffer && `${buffer}\n\n${paragraph}`.length > MAX_CHUNK_CHARS) {
      parts.push(buffer);
      buffer = paragraph;
    } else {
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    }
  }

  if (buffer) parts.push(buffer);
  return parts;
}

function amendmentLabel(sections) {
  for (const section of sections) {
    for (const crumb of section.breadcrumb) {
      const match = /AMENDMENT\s+LIST[-\s]*0?(\d+)/i.exec(crumb || '');
      if (match) return `Amendment List-${match[1].padStart(2, '0')}`;
    }
  }
  return null;
}

export function chunkByHeadings(markdown, meta = {}) {
  const prepared = stripBoilerplate(repairLatexEscapes(markdown));
  const lines = prepared.split('\n');

  const sections = [];
  let breadcrumb = [];
  let current = null;

  const flush = () => {
    if (current && current.body.join('\n').trim()) sections.push(current);
    current = null;
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);

    if (!heading) {
      if (current) current.body.push(line);
      continue;
    }

    flush();

    const level = heading[1].length;
    const title = heading[2].trim().replace(/\s+/g, ' ');

    breadcrumb = breadcrumb.slice(0, level - 1);
    breadcrumb[level - 1] = title;

    if (isRosterHeading(title)) {
      current = null;
      continue;
    }

    current = { title, level, breadcrumb: breadcrumb.filter(Boolean).slice(), body: [] };
  }

  flush();

  const alLabel = meta.kind === 'AMENDMENT' ? amendmentLabel(sections) : null;
  const chunks = [];

  for (const section of sections) {
    const body = section.body.join('\n').trim();
    if (!body) continue;

    const trail = section.breadcrumb.slice(1).join(' › ') || section.title;
    const label = alLabel && !trail.includes(alLabel) ? `${alLabel} › ${trail}` : trail;

    const parts = splitOversized(body);

    parts.forEach((part, index) => {
      const text = part.trim();
      if (text.length < MIN_CHUNK_CHARS) return;

      chunks.push({
        docId: meta.docId,
        docTitle: meta.title,
        documentId: meta.documentId || null,
        kind: meta.kind || 'DOCUMENT',
        amendmentList: alLabel,
        section: parts.length > 1 ? `${label} (part ${index + 1} of ${parts.length})` : label,
        text,
      });
    });
  }

  return chunks.map((chunk, index) => ({ id: `${meta.docId}#${index + 1}`, ...chunk }));
}

export function expertWorkingGroupNames(markdown) {
  const prepared = repairLatexEscapes(markdown);
  const lines = prepared.split('\n');
  const names = [];
  let inGroups = false;

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!heading) continue;

    const level = heading[1].length;
    const title = heading[2].trim();

    if (level === 2) {
      inGroups = title.toLowerCase() === 'expert working groups';
      continue;
    }

    if (inGroups && level === 3) names.push(title);
  }

  return names;
}
