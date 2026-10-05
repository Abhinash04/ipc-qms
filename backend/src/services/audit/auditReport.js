import PDFDocument from 'pdfkit';
import { canonicalJSON, sha256, OPTIONAL_CHAINED_FIELDS } from './auditChain.js';
import { auditIdOf, present, describeFilters, formatDateTime, REPORT_TIME_ZONE_LABEL } from './auditPresentation.js';
import {
  MANDATORY_INFORMATION,
  RECOMMENDATIONS,
  accessReview,
  authenticationByDay,
  checklist,
  controls,
  findings,
  lifecycle,
  periodSummary,
  privilegedActivity,
  reportPeriod,
  securityExceptions,
} from './auditReportData.js';

// Stored fields first (for machine checks), then the same event as a person reads it.
export const RAW_COLUMNS = [
  'seq',
  'timestamp',
  'action',
  'result',
  'actorType',
  'actorId',
  'actorRole',
  'queryId',
  'messageId',
  'threadId',
  'attachmentId',
  'auditId',
  'error',
  'details',
  'aiMetadata',
  'chain',
  'prevHash',
  'hash',
];

const READABLE_COLUMNS = [
  ['dateTime', 'Date and time (IST)'],
  ['user', 'User'],
  ['role', 'Role'],
  ['ipAddress', 'IP address'],
  ['deviceName', 'Device name'],
  ['device', 'Browser / device'],
  ['module', 'Module'],
  ['activity', 'Activity'],
  ['caseNo', 'Case No.'],
  ['status', 'Status'],
  ['details', 'Description'],
  ['narrative', 'Activity in detail'],
  ['auditId', 'Audit ID'],
  ['sessionId', 'Session ID'],
  ['section', 'Section'],
  ['previousValue', 'Previous value'],
  ['newValue', 'New value'],
  ['failureReason', 'Failure reason'],
  ['logSource', 'Log source'],
];

export const REPORT_COLUMNS = [...RAW_COLUMNS, ...READABLE_COLUMNS.map(([, header]) => header)];

/** How a row stands in the chain: chained, legacy (pre-chain) or unpersisted. */
export function chainStatus(row) {
  if (row.unpersisted) return 'unpersisted';
  return typeof row.seq === 'number' ? 'chained' : 'legacy';
}

const readableKey = Object.fromEntries(READABLE_COLUMNS.map(([key, header]) => [header, key]));

// Each row is worded once per export, not once per readable column.
const worded = new WeakMap();
function viewOf(row) {
  if (!worded.has(row)) worded.set(row, present(row));
  return worded.get(row);
}

function cellValue(row, column) {
  if (column === 'chain') return chainStatus(row);
  if (readableKey[column]) return viewOf(row)[readableKey[column]] ?? '';
  const value = row[column];
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * The report's content digest: SHA-256 over the canonical form of the rows exported, as
 * stored. Pass the rows before names, device names and inferred values are filled in for
 * display: those depend on DNS, the staff list and later events, and would give the same
 * selection a different digest each time. It is the same for the CSV and the PDF of one
 * selection, so a copy can be checked against the database.
 */
export function contentDigest(rows) {
  const lines = rows.map((row) => {
    const picked = {};
    for (const column of RAW_COLUMNS) picked[column] = cellValue(row, column);
    for (const field of OPTIONAL_CHAINED_FIELDS) {
      if (row[field] !== null && row[field] !== undefined) picked[field] = row[field];
    }
    return canonicalJSON(picked);
  });
  return sha256(lines.join('\n'));
}

// A cell that a spreadsheet would treat as a formula is neutralised with a
// leading apostrophe (CSV/formula injection).
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function csvCell(raw) {
  let value = String(raw ?? '');
  if (FORMULA_TRIGGER.test(value)) value = `'${value}`;
  if (/[",\r\n]/.test(value) || value !== value.trim()) {
    value = `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** RFC 4180 CSV (CRLF line endings, UTF-8 with BOM so Excel reads Hindi correctly). */
export function buildCsv(rows) {
  const lines = [REPORT_COLUMNS.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(REPORT_COLUMNS.map((column) => csvCell(cellValue(row, column))).join(','));
  }
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

// The built-in PDF fonts only cover Latin-1; anything else (e.g. Devanagari
// in a subject line) is shown as "?" and the CSV carries the exact text.
const latin1 = (text) => String(text ?? '').replace(/[^\n\x20-\x7E\xA0-\xFF]/g, '?');

const clip = (text, max) => {
  const value = latin1(text);
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
};

const CLASSIFICATION = 'Official / Internal Use';

/** The application's name as printed on the report. */
export const APPLICATION_NAME = "AI-powered IP Stakeholder's BRIDGETECH";

// The browser line under the device name; the server's own work already names the server.
const source = (view) => (view.device && !view.device.startsWith('Server ') ? view.device : '');

const RESULT_COLOUR = { Failed: '#b42318', Denied: '#b54708' };
const SEVERITY_COLOUR = { Critical: '#b42318', High: '#b42318', Medium: '#b54708' };
const STATUS_COLOUR = { Recommended: '#b54708', 'Reviewer to confirm': '#555555' };

const ACTIVITIES_COVERED = [
  'User sign-in, sign-out, failed sign-in attempts and rejected sessions',
  'Query receipt, registration, acknowledgement and forwarding',
  'Assignment, transfer and pull-back of queries',
  'Changes in query status and assignment, with previous and new values',
  'AI summaries, drafts and recommendations',
  'Drafting, review, final approval and dispatch of responses',
  'Upload and download of attachments',
  'Views and exports of the audit trail itself',
  'Refused and unauthorised access attempts',
];

/** What the detailed trail adds under the activity: the change made, and why a failure failed. */
function trailNotes(row, view) {
  return [
    row.changes ? `Changed from ${view.previousValue} to ${view.newValue}` : null,
    view.failureReason && !view.did.includes(view.failureReason) ? `Reason: ${view.failureReason}` : null,
  ].filter(Boolean);
}

const ANNEXURE_FIELDS =
  'Audit ID | Timestamp (IST) | User ID | User name | Role | Section | Session ID | Source IP | Device name | Browser | ' +
  'Module | Case No. | Activity | Previous value | New value | Result | Failure reason | Log source';

/**
 * The audit trail report, in the form of a Government of India audit trail report: report
 * particulars, purpose, period summary, the detailed trail with previous and new values,
 * the information captured, the query lifecycle (for a single case), authentication,
 * privileged activity, security events, integrity controls, retention, access-control review,
 * verification checklist, findings, compliance statement, sign-off and an annexure.
 *
 * `rows` are the events matching every filter (the detailed trail); `periodRows` are all events
 * in the report period (the summaries and reviews).
 */
export function buildPdf({
  rows,
  periodRows = rows,
  filters = {},
  generatedBy,
  generatedAt,
  truncated = false,
  verification = null,
  reference = 'BRIDGETECH/ATR',
  department = 'Indian Pharmacopoeia Commission, Ministry of Health & Family Welfare, Government of India',
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30, bufferPages: true });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const generatedOn = `${formatDateTime(generatedAt)} ${REPORT_TIME_ZONE_LABEL}`;
    const period = reportPeriod(filters, periodRows);
    doc.info.Title = `${APPLICATION_NAME} - Audit Trail Report ${reference}`;
    doc.info.Author = latin1(generatedBy);
    doc.info.Subject = `Audit trail, ${period.label}`;

    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 18;
    const ink = '#222222';

    const ensureRoom = (height) => {
      if (doc.y + height > bottom()) {
        doc.addPage();
        doc.y = doc.page.margins.top + 8;
      }
    };

    const heading = (text) => {
      ensureRoom(60);
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#1f2a44').text(text, left, doc.y, { width });
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(8.5).fillColor(ink);
    };

    const paragraph = (text, { size = 8.5, colour = ink } = {}) => {
      doc.font('Helvetica').fontSize(size).fillColor(colour);
      ensureRoom(doc.heightOfString(latin1(text), { width }) + 4);
      doc.text(latin1(text), left, doc.y, { width });
      doc.moveDown(0.3);
    };

    const bullets = (items) => {
      for (const item of items) paragraph(`-  ${item}`);
    };

    /**
     * A table that breaks across pages, repeating its header. Columns are
     * { label, width } (fixed) or { label, flex } (share of what is left), plus an optional
     * colour(text) for the cell's text.
     */
    const table = (columns, data, { emptyText = 'None recorded.', fontSize = 7, maxRow = 90 } = {}) => {
      const fixed = columns.reduce((sum, column) => sum + (column.width || 0), 0);
      const flexTotal = columns.reduce((sum, column) => sum + (column.flex || 0), 0) || 1;
      const widths = columns.map((column) => column.width || ((width - fixed) * (column.flex || 0)) / flexTotal);

      const drawHeader = () => {
        doc.font('Helvetica-Bold').fontSize(fontSize + 0.5);
        const height =
          Math.max(...columns.map((column, i) => doc.heightOfString(column.label, { width: widths[i] - 6 }))) + 7;
        ensureRoom(height + 20);
        const y = doc.y;
        doc.rect(left, y - 2, width, height).fill('#e8ecf7');
        doc.fillColor('#1f2a44');
        let x = left;
        columns.forEach((column, i) => {
          doc.text(column.label, x + 3, y + 1.5, { width: widths[i] - 6, align: column.align || 'left' });
          x += widths[i];
        });
        doc.y = y + height;
      };

      drawHeader();
      if (!data.length) {
        doc.font('Helvetica').fontSize(fontSize + 1).fillColor('#555555').text(emptyText, left + 3, doc.y + 2);
        doc.moveDown(0.6);
        return;
      }

      // A "who did what" cell: the person in bold, then an arrow and what they did, indented.
      // The built-in fonts have no arrow character, so the arrow is drawn.
      const ARROW_INDENT = 11;
      const isStory = (cell) => Boolean(cell) && typeof cell === 'object' && 'who' in cell;
      // "By: name (role)" in bold, then one arrowed line for what was done, one for "To: name
      // (role)" / "From: …" when another person is involved, and one for each note.
      const storyLines = (cell) =>
        [{ text: cell.did }, { text: cell.other, other: true }, ...(cell.notes || []).map((note) => ({ text: note }))].filter(
          (line) => line.text,
        );
      const storyHeight = (cell, cellWidth) => {
        doc.font('Helvetica-Bold').fontSize(fontSize);
        const whoHeight = doc.heightOfString(`By: ${cell.who}`, { width: cellWidth - 6 });
        doc.font('Helvetica').fontSize(fontSize);
        const lineHeights = storyLines(cell).map((line) => doc.heightOfString(line.text, { width: cellWidth - 6 - ARROW_INDENT }));
        return { whoHeight, lineHeights, total: whoHeight + lineHeights.reduce((sum, h) => sum + h + 1, 0) };
      };
      const drawArrow = (x, y) => {
        const mid = y + fontSize * 0.45;
        doc.save().lineWidth(0.8).strokeColor('#1f4e9c').moveTo(x, mid).lineTo(x + 6.5, mid).stroke();
        doc.moveTo(x + 8.5, mid).lineTo(x + 5.5, mid - 2.2).lineTo(x + 5.5, mid + 2.2).closePath().fill('#1f4e9c').restore();
      };

      data.forEach((cells, index) => {
        doc.font('Helvetica').fontSize(fontSize);
        const texts = cells.map((cell) =>
          isStory(cell)
            ? {
                who: clip(cell.who, 300),
                did: clip(cell.did, 900),
                other: clip(cell.other || '', 300),
                notes: (cell.notes || []).map((note) => clip(note, 600)),
              }
            : clip(cell ?? '', 900),
        );
        const heights = texts.map((text, i) =>
          isStory(text) ? storyHeight(text, widths[i]).total : doc.heightOfString(text, { width: widths[i] - 6 }),
        );
        const rowHeight = Math.min(Math.max(...heights, fontSize + 2), maxRow) + 5;

        if (doc.y + rowHeight > bottom()) {
          doc.addPage();
          doc.y = doc.page.margins.top + 8;
          drawHeader();
        }

        const y = doc.y;
        if (index % 2 === 1) doc.rect(left, y - 1, width, rowHeight).fill('#f6f7fb');
        doc.moveTo(left, y + rowHeight - 1).lineTo(left + width, y + rowHeight - 1).lineWidth(0.3).strokeColor('#e3e6ef').stroke();

        let x = left;
        texts.forEach((text, i) => {
          const column = columns[i];
          if (isStory(text)) {
            const { whoHeight, lineHeights } = storyHeight(text, widths[i]);
            doc.font('Helvetica-Bold').fontSize(fontSize).fillColor(ink).text(`By: ${text.who}`, x + 3, y + 2, { width: widths[i] - 6 });
            let lineY = y + 3 + whoHeight;
            storyLines(text).forEach((line, n) => {
              if (lineY + fontSize > y + rowHeight) return;
              drawArrow(x + 3, lineY);
              doc
                .font(line.other ? 'Helvetica-Bold' : 'Helvetica')
                .fontSize(fontSize)
                .fillColor(line.other ? '#1f4e9c' : ink)
                .text(line.text, x + 3 + ARROW_INDENT, lineY, {
                  width: widths[i] - 6 - ARROW_INDENT,
                  height: Math.max(y + rowHeight - lineY - 2, fontSize),
                  ellipsis: true,
                });
              lineY += lineHeights[n] + 1;
            });
            x += widths[i];
            return;
          }
          const colour = column.colour?.(text);
          doc
            .font(column.bold || colour ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(fontSize)
            .fillColor(colour || ink)
            .text(text, x + 3, y + 2, { width: widths[i] - 6, height: rowHeight - 3, ellipsis: true, align: column.align || 'left' });
          x += widths[i];
        });
        doc.y = y + rowHeight;
      });
      doc.font('Helvetica').fillColor(ink);
      doc.moveDown(0.5);
    };

    // Title and report particulars.
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#111111').text('AUDIT TRAIL REPORT', left, 30, { width, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1f2a44').text(APPLICATION_NAME, { width, align: 'center' });
    doc.moveDown(0.8);

    const particulars = [
      ['Department / Ministry', department],
      ['Application name', APPLICATION_NAME],
      ['Report period', period.label],
      ['Report generated on', generatedOn],
      ['Report generated by', generatedBy],
      ['Audit report reference', reference],
      ['Classification', CLASSIFICATION],
      ['Filters applied', describeFilters(filters)],
      ['Records in detailed trail', `${rows.length}${truncated ? ' (limit reached; narrow the filters for a complete trail)' : ''}`],
      // Records later found missing after this one were deleted after the report was made.
      ...(verification?.head ? [['Latest audit record', `${auditIdOf(verification.head)}, when this report was made`]] : []),
    ];
    table(
      [
        { label: 'Particular', width: 170, bold: true },
        { label: 'Detail', flex: 1 },
      ],
      particulars.map(([label, value]) => [label, value]),
      { fontSize: 8.5 },
    );

    heading('1. Purpose');
    paragraph(
      `This report is a chronological record of activities performed in ${APPLICATION_NAME}. It establishes ` +
        'accountability, traceability, integrity and security of the transactions processed through the application. ' +
        'The audit trail captures:',
    );
    bullets(ACTIVITIES_COVERED);

    heading('2. Audit Period Summary');
    table(
      [
        { label: 'Particular', flex: 3 },
        { label: 'Count', width: 90, align: 'right' },
      ],
      periodSummary(periodRows, verification).map(([label, value]) => [label, Number(value).toLocaleString('en-IN')]),
      { fontSize: 8 },
    );

    heading('3. Detailed Audit Trail');
    table(
      [
        { label: 'S.No.', width: 26 },
        { label: 'Audit ID', width: 50 },
        { label: `Date & time (${REPORT_TIME_ZONE_LABEL})`, width: 60 },
        { label: 'User', width: 86 },
        { label: 'Source IP / device', width: 90 },
        { label: 'Case No.', width: 62 },
        { label: 'Module', width: 58 },
        { label: 'Activity', flex: 1 },
        { label: 'Result', width: 40, colour: (text) => RESULT_COLOUR[text] },
      ],
      rows.map((row, index) => {
        const view = viewOf(row);
        return [
          String(index + 1),
          view.auditId === '-' ? 'Not issued' : view.auditId,
          view.dateTime,
          [view.userCard.name, view.userCard.role, view.userCard.id && `ID: ${view.userCard.id}`].filter(Boolean).join('\n'),
          [view.ipAddress || '-', view.deviceName, source(view)].filter(Boolean).join('\n'),
          view.caseNo || '-',
          view.module,
          { who: view.who, did: view.did, other: view.other, notes: trailNotes(row, view) },
          view.status,
        ];
      }),
      { emptyText: 'No audit records match these filters.' },
    );
    if (rows.some((row) => typeof row.seq !== 'number')) {
      paragraph(
        'Rows whose Audit ID reads "Not issued" were recorded before audit IDs were given out, or by a copy of the application that does not give audit IDs, so they are outside the integrity check.',
        { colour: '#555555' },
      );
    }

    heading('4. Mandatory Audit Information');
    table(
      [
        { label: 'Information', width: 170, bold: true },
        { label: 'Captured as', flex: 1 },
        { label: 'Status', width: 100 },
      ],
      MANDATORY_INFORMATION,
      { fontSize: 8 },
    );

    heading('5. Query Lifecycle Audit');
    if (filters.queryId) {
      paragraph(`Query: ${filters.queryId}`);
      const steps = lifecycle(rows, filters.queryId);
      table(
        [
          { label: `Date & time (${REPORT_TIME_ZONE_LABEL})`, width: 100 },
          { label: 'Activity', flex: 1 },
          { label: 'Query status after this step', width: 150 },
        ],
        steps.map((step) => [step.dateTime, { who: step.who, did: step.did, other: step.other }, step.status]),
      );
      paragraph(
        steps.length
          ? `Audit finding: ${steps.length} recorded step(s) for this query; the trace runs from ${steps[0].activity.toLowerCase()} to ${steps.at(-1).activity.toLowerCase()}.`
          : 'Audit finding: no recorded steps for this query in the period.',
      );
    } else {
      paragraph('Export the report filtered to one Case No. to include that query\'s complete lifecycle here.', { colour: '#555555' });
    }

    heading('6. Authentication Audit');
    const auth = authenticationByDay(periodRows);
    table(
      [
        { label: 'Date', flex: 2 },
        { label: 'Successful sign-ins', flex: 1, align: 'right' },
        { label: 'Failed sign-ins', flex: 1, align: 'right' },
        { label: 'Sign-outs', flex: 1, align: 'right' },
        { label: 'Rejected sessions', flex: 1, align: 'right' },
      ],
      [
        ...auth.days.map((day) => [day.date, day.success, day.failed, day.logouts, day.rejected].map(String)),
        ...(auth.days.length ? [['Total', auth.total.success, auth.total.failed, auth.total.logouts, auth.total.rejected].map(String)] : []),
      ],
      { fontSize: 8, emptyText: 'No sign-in activity in the period.' },
    );
    paragraph(
      `Observations: ${auth.total.failed} failed sign-in attempt(s) and ${auth.total.rejected} rejected session(s) were recorded ` +
        'and are listed for review in section 8 where repeated. The application does not lock accounts after failed attempts; ' +
        'locked accounts and password resets are therefore not applicable.',
    );

    heading('7. Privileged / Administrative Activity');
    const privileged = privilegedActivity(periodRows);
    table(
      [
        { label: `Date & time (${REPORT_TIME_ZONE_LABEL})`, width: 80 },
        { label: 'Administrator', width: 100 },
        { label: 'Activity', width: 120, bold: true },
        { label: 'Object', flex: 1 },
        { label: 'Old value', flex: 1 },
        { label: 'New value', flex: 1 },
        { label: 'Approval / reference', width: 100 },
      ],
      privileged.map((row) => [row.dateTime, row.administrator, row.activity, row.object, row.previous, row.next, row.reference]),
      { emptyText: 'No administrative activity in the period.' },
    );
    paragraph(
      'All privileged actions should be traceable to an authorised administrator and, where applicable, an approved change request. ' +
        'User and role administration and system settings are configured outside the application.',
      { colour: '#555555' },
    );

    heading('8. Exception / Security Event Report');
    const exceptions = securityExceptions(periodRows, verification);
    table(
      [
        { label: 'Event ID', width: 70 },
        { label: `Date & time (${REPORT_TIME_ZONE_LABEL})`, width: 80 },
        { label: 'User / IP', width: 140 },
        { label: 'Event', flex: 1, bold: true },
        { label: 'Severity', width: 55, colour: (text) => SEVERITY_COLOUR[text] },
        { label: 'Action taken', width: 150 },
        { label: 'Status', width: 85 },
      ],
      exceptions.map((event) => [event.id, event.dateTime, event.who, event.event, event.severity, event.actionTaken, event.status]),
      { emptyText: 'No security events in the period.' },
    );
    paragraph('Rejected and unauthorised access attempts remain part of the audit records for subsequent review.', { colour: '#555555' });

    heading('9. Audit Log Integrity Controls');
    const integrity = controls(verification);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(verification && !verification.ok ? '#b42318' : '#1f6f43');
    ensureRoom(16);
    doc.text(integrity.verdict, left, doc.y, { width });
    doc.moveDown(0.4);
    table(
      [
        { label: 'Sl. No.', width: 45 },
        { label: 'Control', flex: 3 },
        { label: 'Status', flex: 1, colour: (text) => STATUS_COLOUR[text] || (text.startsWith('Recommended') ? '#b54708' : null) },
      ],
      integrity.items.map(([control, status], index) => [String(index + 1), control, status]),
      { fontSize: 8 },
    );

    heading('10. Log Retention');
    const oldest = periodRows.map((row) => String(row.timestamp)).sort()[0];
    paragraph(
      'ICT system logs shall be retained securely for the period applicable under CERT-In directions and the Department\'s approved ' +
        'retention and security policy: for systems covered by the CERT-In Directions, a rolling period of at least 180 days within ' +
        'Indian jurisdiction. Where a longer period is required, the longer period applies.',
    );
    paragraph(
      `Audit records are never deleted by the application.${oldest ? ` The oldest record in this report is dated ${formatDateTime(oldest).split(',')[0]}.` : ''}`,
    );

    heading('11. Access Control Review');
    table(
      [
        { label: 'Control', flex: 2, bold: true },
        { label: 'Status', width: 120, colour: (text) => STATUS_COLOUR[text] },
        { label: 'Observation', flex: 3 },
      ],
      accessReview(periodRows),
      { fontSize: 8 },
    );

    heading('12. Audit Trail Verification Checklist');
    table(
      [
        { label: 'Sl. No.', width: 45 },
        { label: 'Audit requirement', flex: 2 },
        { label: 'Status', width: 120, colour: (text) => STATUS_COLOUR[text] },
        { label: 'Remarks', flex: 3 },
      ],
      checklist(periodRows).map(([requirement, status, remarks], index) => [String(index + 1), requirement, status, remarks]),
      { fontSize: 8 },
    );

    heading('13. Audit Findings');
    const found = findings(periodRows, verification);
    for (const [title, items] of [
      ['Critical findings', found.critical],
      ['Major findings', found.major],
      ['Minor findings', found.minor],
    ]) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(ink);
      ensureRoom(30);
      doc.text(title, left, doc.y, { width });
      doc.font('Helvetica');
      if (items.length) items.forEach((item, index) => paragraph(`${index + 1}. ${item}`));
      else paragraph('None.');
    }
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ink);
    ensureRoom(30);
    doc.text('Recommendations', left, doc.y, { width });
    RECOMMENDATIONS.forEach((item, index) => paragraph(`${index + 1}. ${item}`));

    heading('14. Compliance Statement');
    paragraph(
      `Based on the records for the stated period, ${APPLICATION_NAME} maintained audit records covering user, query, ` +
        'administrative and security-related transactions. These records are to be reviewed for completeness, access control, ' +
        'traceability and security in accordance with the organisation\'s approved Information Security Policy, Access Control ' +
        'Policy, Log Management Policy and applicable Government of India cyber security requirements. Observations are recorded ' +
        'in section 13; corrective action is to be recorded at sign-off.',
    );

    ensureRoom(190);
    heading('15. Sign-Off');
    const signers = [
      ['Prepared by', 'System Administrator / Security Officer'],
      ['Reviewed by', 'Information Security Officer / Application Owner'],
      ['Approved by', 'Competent Authority / Head of Department'],
    ];
    ensureRoom(130);
    const blockWidth = (width - 40) / 3;
    const top = doc.y + 4;
    signers.forEach(([role, designation], index) => {
      const x = left + index * (blockWidth + 20);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(ink).text(role, x, top, { width: blockWidth });
      doc.font('Helvetica').fontSize(8.5);
      ['Name', 'Designation', 'Date', 'Signature'].forEach((field, line) => {
        const y = top + 20 + line * 24;
        const value = field === 'Designation' ? designation : '';
        doc.text(`${field}: ${value}`, x, y, { width: blockWidth, lineBreak: false });
        if (!value) {
          const start = x + doc.widthOfString(`${field}: `);
          doc.moveTo(start, y + 9).lineTo(x + blockWidth, y + 9).lineWidth(0.5).strokeColor('#999999').stroke();
        }
      });
    });
    doc.y = top + 20 + 4 * 24 + 6;

    heading('Annexure A - Minimum audit record structure');
    paragraph(ANNEXURE_FIELDS);
    paragraph('Every field is available in the CSV export of this report; the detailed trail above shows the principal ones.', { colour: '#555555' });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      // Writing inside the margins would make pdfkit start a new page.
      const margins = { ...doc.page.margins };
      doc.page.margins.bottom = 0;
      doc.page.margins.top = 0;
      doc.font('Helvetica').fontSize(7).fillColor('#666666');
      if (i > range.start) {
        doc.text(`${APPLICATION_NAME} - Audit Trail Report  |  ${reference}`, left, 14, { width, lineBreak: false });
      }
      const footerY = doc.page.height - margins.bottom + 6;
      doc.text(`${reference}  |  ${CLASSIFICATION}  |  Generated on ${generatedOn}`, left, footerY, { width, lineBreak: false });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, left, footerY, { width, align: 'right', lineBreak: false });
      doc.page.margins.bottom = margins.bottom;
      doc.page.margins.top = margins.top;
    }

    doc.end();
  });
}
