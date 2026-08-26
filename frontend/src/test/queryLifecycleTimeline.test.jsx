import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { QueryLifecycleTimeline } from '@/components/workflow/QueryLifecycleTimeline';
import { STAGE_STATUS } from '@/constants/queryLifecycle';

/**
 * Structural rather than pixel-based: jsdom does not evaluate container queries,
 * so these assert the markup that lets the layout adapt, not the layout itself.
 *
 * Both layouts (horizontal track + vertical stepper) are always in the DOM, with
 * CSS hiding one. That is pre-existing, so every text query matches twice.
 */

const stage = (key, label, overrides = {}) => ({
  key,
  label,
  actor: 'Amit Mehta',
  status: STAGE_STATUS.COMPLETE,
  ...overrides,
});

const SHORT = [
  stage('submitted', 'Enquiry submitted'),
  stage('review', 'Review', { status: STAGE_STATUS.CURRENT, note: 'Awaiting you' }),
  stage('delivered', 'Inquirer received response', { status: STAGE_STATUS.PENDING }),
];

/** A realistic worst case: the 9 fixed stages plus several review levels. */
const LONG = Array.from({ length: 12 }, (_, i) =>
  stage(`s-${i}`, `Stage number ${i + 1}`, { actor: `Official ${i + 1}` }),
);

const track = (container) => container.querySelector('ol');
const scroller = () => screen.getByRole('group', { name: 'Workflow progress' });

describe('the timeline renders its stages', () => {
  it('shows every label and actor', () => {
    render(<QueryLifecycleTimeline stages={SHORT} />);

    for (const s of SHORT) {
      expect(screen.getAllByText(s.label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('Amit Mehta').length).toBeGreaterThan(0);
  });

  it('marks the current stage for assistive tech and shows its note', () => {
    render(<QueryLifecycleTimeline stages={SHORT} />);

    expect(screen.getAllByText('Awaiting you').length).toBeGreaterThan(0);
    const current = document.querySelectorAll('li[aria-current="step"]');
    expect(current.length).toBeGreaterThan(0);
  });

  it('renders nothing at all for an empty lifecycle', () => {
    const { container } = render(<QueryLifecycleTimeline stages={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('handles a 12-stage lifecycle', () => {
    render(<QueryLifecycleTimeline stages={LONG} />);
    expect(screen.getAllByText('Stage number 12').length).toBeGreaterThan(0);
  });
});

describe('the track adapts to its container instead of forcing a width', () => {
  it('is not pinned to its content width', () => {
    // The regression: `min-w-max` made the per-stage `flex-1` inert, so the
    // track demanded its full max-content width and overflowed the card.
    const { container } = render(<QueryLifecycleTimeline stages={LONG} />);
    expect(track(container).className).not.toMatch(/min-w-max/);
    expect(track(container).className).toMatch(/flex/);
  });

  it('lets each stage shrink to share the available width', () => {
    const { container } = render(<QueryLifecycleTimeline stages={LONG} />);
    const first = track(container).querySelector('li');
    expect(first.className).toMatch(/flex-1/);
  });

  it('keys its layout off the container, not the viewport', () => {
    const { container } = render(<QueryLifecycleTimeline stages={SHORT} />);
    // The root opens a container-query context…
    expect(container.firstChild.className).toMatch(/@container/);
    // …and both layouts switch on container width (`@2xl:`), not `lg:`.
    expect(container.innerHTML).toMatch(/@2xl:/);
    expect(scroller().className).not.toMatch(/(^|\s|:)lg:/);
  });

  it('can shrink inside a flex or grid parent rather than widening it', () => {
    const { container } = render(<QueryLifecycleTimeline stages={SHORT} />);
    expect(container.firstChild.className).toMatch(/min-w-0/);
  });
});

describe('overflow is contained and reachable', () => {
  it('scrolls within its own container without dragging the page sideways', () => {
    render(<QueryLifecycleTimeline stages={LONG} />);
    expect(scroller().className).toMatch(/overflow-x-auto/);
    expect(scroller().className).toMatch(/overscroll-x-contain/);
  });

  it('exposes the scroll region to the keyboard', () => {
    render(<QueryLifecycleTimeline stages={LONG} />);
    expect(scroller()).toHaveAttribute('tabindex', '0');
  });
});

describe('long content wraps instead of widening a column', () => {
  const WORDY = [
    stage('a', 'Forwarded to the Officer-in-Charge for departmental assignment', {
      actor: 'Dr. Venkataraman Subrahmanyan Krishnamurthy',
    }),
    stage('b', 'Supercalifragilisticexpialidocious', { actor: 'Aaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
  ];

  it('renders long labels and names in full', () => {
    render(<QueryLifecycleTimeline stages={WORDY} />);

    for (const s of WORDY) {
      expect(screen.getAllByText(s.label).length).toBeGreaterThan(0);
      expect(screen.getAllByText(s.actor).length).toBeGreaterThan(0);
    }
  });

  it('allows an unbroken token to break mid-word', () => {
    const { container } = render(<QueryLifecycleTimeline stages={WORDY} />);
    const label = track(container).querySelector('p');
    expect(label.className).toMatch(/wrap-break-word/);
  });
});
