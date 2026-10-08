import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { EmailThread } from '@/components/email/EmailThread';
import { AiSummaryCard } from '@/components/ai/AiSummaryCard';
import { AttachmentList } from '@/components/attachments/AttachmentList';
import { AttachmentsPanel } from '@/components/attachments/AttachmentsPanel';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { fileTypeOf } from '@/components/attachments/fileType';
import { CaseSectionBar } from '@/components/workflow/CaseSectionBar';
import { CaseOfficialsCard } from '@/components/workflow/CaseOfficialsCard';
import { CaseCard } from '@/components/common/CaseCard';
import { Inbox, Mail, Send } from 'lucide-react';
import { EMAIL_DIRECTION, EMAIL_TYPE } from '@/constants/emailModel';

const message = (overrides) => ({
  messageId: 'MSG-1',
  threadId: 'THR-1',
  direction: EMAIL_DIRECTION.INBOUND,
  emailType: EMAIL_TYPE.INCOMING_QUERY,
  from: 'Abhinash Pritiraj <abhinash@example.com>',
  to: ['ipc@example.com'],
  subject: 'Clarification on assay validation',
  body: 'Please clarify the limits.',
  timestamp: '2026-10-05T05:00:00.000Z',
  attachments: [],
  ...overrides,
});

describe('the email thread reads like an email client', () => {
  it('names the sender and their address, the recipient, the direction and the type', () => {
    render(<EmailThread messages={[message()]} />);

    const email = screen.getByRole('article');
    expect(within(email).getByText('Abhinash Pritiraj')).toBeInTheDocument();
    expect(within(email).getByText('<abhinash@example.com>')).toBeInTheDocument();
    expect(within(email).getByText('ipc@example.com')).toBeInTheDocument();
    expect(within(email).getByText('Received by IPC')).toBeInTheDocument();
    expect(within(email).getByText('Original enquiry')).toBeInTheDocument();
  });

  it('folds the quoted earlier message until asked', () => {
    const reply = message({
      direction: EMAIL_DIRECTION.OUTBOUND,
      emailType: EMAIL_TYPE.OUTGOING_RESPONSE,
      from: 'Front Office <fo@ipc.example>',
      body: 'Dear Sir/Madam,\n\nThe limits are 98–102%.\n\nOn 5 Oct, Abhinash wrote:\n> Please clarify the limits.',
    });
    render(<EmailThread messages={[reply]} />);

    const email = screen.getByRole('article');
    expect(within(email).getByText(/The limits are 98–102%/)).toBeInTheDocument();
    expect(within(email).queryByText(/> Please clarify the limits\./)).toBeNull();

    fireEvent.click(within(email).getByRole('button', { name: 'Show quoted text' }));
    expect(within(email).getByText(/> Please clarify the limits\./)).toBeInTheDocument();
  });

  it('shows an email’s files as an attachment strip', () => {
    render(
      <EmailThread
        messages={[message({ attachments: [{ attachmentId: 'ATT-1', filename: 'spec.pdf', mimeType: 'application/pdf', size: 2048 }] })]}
      />,
    );

    const strip = screen.getByRole('list', { name: 'Attachments' });
    expect(within(strip).getByRole('link', { name: 'Download spec.pdf' })).toHaveAttribute('href', expect.stringContaining('ATT-1'));
  });

  it('filters by direction with a segmented control', () => {
    render(
      <EmailThread
        messages={[
          message(),
          message({ messageId: 'MSG-2', direction: EMAIL_DIRECTION.OUTBOUND, emailType: EMAIL_TYPE.ACKNOWLEDGEMENT, timestamp: '2026-10-05T06:00:00.000Z' }),
        ]}
      />,
    );

    expect(screen.getByText('2 messages exchanged with the inquirer')).toBeInTheDocument();

    // The filter sits in a toolbar under the heading, not inside the banner.
    const filter = screen.getByRole('group', { name: 'Show emails' });
    expect(filter.closest('header')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Email thread' }).closest('header').nextElementSibling).toContainElement(filter);
    expect(screen.getByText('1 received · 1 sent')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sent' }));
    expect(screen.getByRole('button', { name: 'Sent' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1 message exchanged with the inquirer')).toBeInTheDocument();
  });
});

describe('"View full summary" appears only when something is hidden', () => {
  const longText = 'The enquiry asks about HPLC robustness and revalidation. '.repeat(8);
  const fakeLayout = (scrollHeight, clientHeight) => {
    const spies = [
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight),
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight),
    ];
    return () => spies.forEach((spy) => spy.mockRestore());
  };

  it('stays hidden when a long summary still fits its lines and no key point is held back', () => {
    const restore = fakeLayout(96, 96);
    render(<AiSummaryCard readOnly summary={{ text: longText, keyPoints: ['a', 'b', 'c'], topics: [] }} />);
    expect(screen.queryByRole('button', { name: 'View full summary' })).toBeNull();
    restore();
  });

  it('appears when the clamp actually cuts the summary off', () => {
    const restore = fakeLayout(160, 96);
    render(<AiSummaryCard readOnly summary={{ text: longText, keyPoints: [], topics: [] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'View full summary' }));
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    restore();
  });

  it('appears when there are key points beyond the first three', () => {
    const restore = fakeLayout(40, 40);
    render(<AiSummaryCard readOnly summary={{ text: 'Short.', keyPoints: ['a', 'b', 'c', 'd'], topics: [] }} />);
    expect(screen.getByRole('button', { name: 'View full summary' })).toBeInTheDocument();
    restore();
  });
});

describe('the AI summary is an insight card', () => {
  it('marks itself AI generated, lists key points and topics, and asks for verification', () => {
    render(
      <AiSummaryCard
        readOnly
        summary={{ text: 'The enquiry asks about HPLC.', keyPoints: ['Mobile phase changes'], topics: ['HPLC'] }}
      />,
    );

    expect(screen.getByText('AI generated')).toBeInTheDocument();
    expect(screen.getByText('Mobile phase changes')).toBeInTheDocument();
    expect(screen.getByText('HPLC')).toBeInTheDocument();
    expect(screen.getByText(/verify before taking official action/)).toBeInTheDocument();
  });
});

describe('card banners follow the theme colour', () => {
  it('gives every banner the same primary colour, whatever the card’s tone', () => {
    render(
      <>
        {['ai', 'team', 'email', 'document', 'history', 'action', 'context', 'progress'].map((tone) => (
          <CaseCard key={tone} tone={tone} banner title={`Card ${tone}`}>
            body
          </CaseCard>
        ))}
      </>,
    );

    const banners = screen.getAllByRole('heading').map((heading) => heading.closest('header').className);
    expect(new Set(banners).size).toBe(1);
    expect(banners[0]).toMatch(/from-primary-700/);
    expect(banners[0]).toMatch(/to-primary-600/);
  });

  it('draws a banner’s illustration as decoration, hidden from assistive tech', () => {
    render(
      <CaseCard banner art={[Mail, Send, Inbox]} title="Email thread">
        body
      </CaseCard>,
    );

    const header = screen.getByRole('heading', { name: 'Email thread' }).closest('header');
    const layers = [...header.querySelectorAll(':scope > [aria-hidden="true"].pointer-events-none')];
    const art = layers.find((layer) => layer.querySelector('svg'));
    expect(art.querySelectorAll('svg')).toHaveLength(3);

    // It moves: the icon floats, its companions drift, and a sheen crosses the banner.
    expect(art.querySelector('.art-float')).not.toBeNull();
    expect(art.querySelectorAll('.art-drift-a, .art-drift-b')).toHaveLength(2);
    expect(header.querySelector('.art-shine')).not.toBeNull();
    expect(art.style.getPropertyValue('--art-delay')).toMatch(/^-\d+(\.\d)?s$/);
  });
});

describe('the section bar', () => {
  it('links to every section of the case, with the email and event counts', () => {
    render(<CaseSectionBar emails={4} events={15} />);

    const nav = screen.getByRole('navigation', { name: 'Case sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#case-summary',
      '#case-email-thread',
      '#case-response',
      '#case-audit-history',
    ]);
    expect(within(nav).getByRole('link', { name: /Emails\s*4/ })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /History\s*15/ })).toBeInTheDocument();
    expect(links[0]).toHaveAttribute('aria-current', 'location');
  });

  it('sticks under the app header on the page, and flush with the top inside a panel', () => {
    const { unmount } = render(<CaseSectionBar />);
    expect(screen.getByRole('navigation', { name: 'Case sections' }).className).toMatch(/\btop-20\b/);
    unmount();

    render(<CaseSectionBar stickyClassName="top-0" />);
    const bar = screen.getByRole('navigation', { name: 'Case sections' });
    expect(bar.className).toMatch(/\btop-0\b/);
    expect(bar.className).not.toMatch(/\btop-20\b/);
  });
});

describe('the officials roster', () => {
  it('shows each role as a card, in hand-off order, with its holder and status', () => {
    render(
      <CaseOfficialsCard
        query={{ queryId: 'QRY-1', workflowState: 'RECEIVED', inquirer: { name: 'Abhinash Pritiraj' } }}
        steps={[]}
        audit={[]}
      />,
    );

    const roster = screen.getByRole('list');
    const [first] = within(roster).getAllByRole('listitem');
    expect(first).toHaveTextContent(/Inquirer.*Abhinash Pritiraj/);
    expect(first).toHaveTextContent('#1');
    expect(screen.getByText(/hand-offs complete/)).toBeInTheDocument();
  });

  it('shows hand-off progress as a bar under the heading', () => {
    render(
      <CaseOfficialsCard
        query={{ queryId: 'QRY-1', workflowState: 'RECEIVED', inquirer: { name: 'Abhinash Pritiraj' } }}
        steps={[]}
        audit={[]}
      />,
    );

    const bar = screen.getByRole('progressbar', { name: 'Hand-offs complete' });
    expect(bar.closest('header')).toBeNull();
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(Number(bar.getAttribute('aria-valuemax')));
  });
});

describe('the attachments panel', () => {
  const files = [
    { attachmentId: 'A1', filename: 'spec.pdf', mimeType: 'application/pdf', size: 2048 },
    { attachmentId: 'A2', filename: 'photo.png', mimeType: 'image/png', size: 1024 },
    { attachmentId: 'A3', filename: 'annex.pdf', mimeType: 'application/pdf', size: 1024 },
  ];

  it('sums up the files, by count, size and type', () => {
    render(<AttachmentsPanel attachments={files} />);

    expect(screen.getByText('3 files')).toBeInTheDocument();
    expect(screen.getByText('4.0 KB in total')).toBeInTheDocument();
    const types = screen.getByRole('list', { name: 'File types' });
    expect(within(types).getByText('PDF ×2')).toBeInTheDocument();
    expect(within(types).getByText('IMG ×1')).toBeInTheDocument();
  });

  it('shows tiles by default and rows on request, keeping Preview and Download on each file', () => {
    render(<AttachmentsPanel attachments={files} />);

    const tile = screen.getByText('spec.pdf').closest('li');
    expect(tile.className).toMatch(/rounded-xl/);
    expect(within(tile).getByRole('button', { name: /Preview/ })).toBeInTheDocument();
    expect(within(tile).getByRole('link', { name: /Download/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    const row = screen.getByText('spec.pdf').closest('li');
    expect(row.closest('ul').className).toMatch(/divide-y/);
    expect(within(row).getByRole('button', { name: /Preview/ })).toBeInTheDocument();
  });

  it('falls back to the empty state with no files', () => {
    render(<AttachmentsPanel attachments={[]} emptyDescription="No attachments available for this query." />);
    expect(screen.getByText('No attachments')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grid' })).toBeNull();
  });
});

describe('attachments read like a file manager', () => {
  it('labels each file by type and size', () => {
    render(<AttachmentList attachments={[{ attachmentId: 'A', filename: 'report.docx', size: 1024 }]} />);

    expect(screen.getByText('report.docx')).toBeInTheDocument();
    expect(screen.getByText('1.0 KB')).toBeInTheDocument();
    expect(screen.getByText('DOC')).toBeInTheDocument();
  });

  it('recognises the common file types', () => {
    expect(fileTypeOf({ filename: 'a.pdf' }).label).toBe('PDF');
    expect(fileTypeOf({ filename: 'a.xlsx' }).label).toBe('XLS');
    expect(fileTypeOf({ filename: 'scan', mimeType: 'image/png' }).label).toBe('IMG');
    expect(fileTypeOf({ filename: 'notes.txt' }).label).toBe('TXT');
  });
});

describe('the case header shows each status once', () => {
  const badges = () => screen.getAllByText(/^(OPEN|IN PROGRESS|CLOSED|UNDER REVIEW|NORMAL)$/).map((el) => el.textContent);

  it('shows the case status and the workflow step while they differ', () => {
    render(
      <CaseSummaryBar
        query={{ queryId: 'QRY-1', subject: 'S', businessStatus: 'IN_PROGRESS', workflowState: 'UNDER_REVIEW', priority: 'NORMAL' }}
      />,
    );
    expect(badges()).toEqual(['IN PROGRESS', 'UNDER REVIEW', 'NORMAL']);
  });

  it('shows CLOSED once on a closed case', () => {
    render(
      <CaseSummaryBar query={{ queryId: 'QRY-1', subject: 'S', businessStatus: 'CLOSED', workflowState: 'CLOSED', priority: 'NORMAL' }} />,
    );
    expect(badges()).toEqual(['CLOSED', 'NORMAL']);
  });

  it('labels what each badge means', () => {
    render(
      <CaseSummaryBar
        query={{ queryId: 'QRY-1', subject: 'S', businessStatus: 'IN_PROGRESS', workflowState: 'UNDER_REVIEW', priority: 'NORMAL' }}
      />,
    );
    const labelOf = (text) => screen.getByText(text).closest('div').querySelector('dt').textContent;
    expect(labelOf('IN PROGRESS')).toBe('Status');
    expect(labelOf('UNDER REVIEW')).toBe('Stage');
    expect(labelOf('NORMAL')).toBe('Priority');
  });
});
