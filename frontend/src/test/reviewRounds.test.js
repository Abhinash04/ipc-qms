import { describe, it, expect } from 'vitest';
import { lineDiff } from '@/utils/lineDiff';
import { buildReviewRounds, currentResubmission } from '@/constants/reviewRounds';

describe('lineDiff', () => {
  it('marks kept, removed and added lines in order', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'removed', text: 'b' },
      { type: 'added', text: 'B' },
      { type: 'same', text: 'c' },
      { type: 'added', text: 'd' },
    ]);
  });

  it('reports no change for identical text', () => {
    expect(lineDiff('x\ny', 'x\ny').every((row) => row.type === 'same')).toBe(true);
  });
});

describe('review rounds', () => {
  const steps = [
    { stepId: 'S1', queryId: 'Q', stepType: 'REVIEW', sequence: 2 },
    { stepId: 'S2', queryId: 'Q', stepType: 'REVIEW', sequence: 3 },
  ];
  const versions = [
    { responseId: 'R1', version: 'v1' },
    { responseId: 'R2', version: 'v2', respondsToReviewId: 'REV1', changeSummary: 'Cited.' },
    { responseId: 'R3', version: 'v3', respondsToReviewId: 'REV2', changeSummary: 'Shortened.' },
  ];
  const reviews = [
    { reviewId: 'REV1', decision: 'CHANGES_REQUESTED', stepId: 'S2', responseId: 'R1', comment: 'Cite it', at: '1' },
    { reviewId: 'REVA', decision: 'APPROVED', stepId: 'S1', responseId: 'R2', at: '2' },
    { reviewId: 'REV2', decision: 'CHANGES_REQUESTED', stepId: null, responseId: 'R2', comment: 'Shorter', at: '3' },
  ];

  it('numbers each change request as a new round and links the version that answered it', () => {
    const rounds = buildReviewRounds({ reviews, versions, steps });
    expect(rounds.map((r) => [r.round, r.requesterRole, r.reviewedVersion.version, r.resubmittedVersion.version])).toEqual([
      [2, 'Reviewer II', 'v1', 'v2'],
      [3, 'Officer-in-Charge', 'v2', 'v3'],
    ]);
  });

  it('finds the round the latest version answers, with earlier rounds behind it', () => {
    const found = currentResubmission({ reviews, versions, steps, latestVersion: versions[2] });
    expect(found.current.round).toBe(3);
    expect(found.earlier.map((r) => r.round)).toEqual([2]);
    expect(currentResubmission({ reviews, versions, steps, latestVersion: versions[0] })).toBeNull();
  });
});
