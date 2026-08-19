import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import gemmaService, { generateSummary } from '../services/ai/gemmaService.js';
import env from '../config/env.js';

describe('Gemma AI Service Unit Tests', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should return a valid AI summary when Gemma API returns a valid JSON string', async () => {
    const mockGemmaAnswer = JSON.stringify({
      text: 'The inquirer asks about monograph dissolution specifications for Paracetamol.',
      keyPoints: ['Dissolution testing methodology', 'Acceptance criteria verification'],
      topics: ['monograph', 'dissolution'],
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: mockGemmaAnswer }),
    });

    const result = await generateSummary({
      subject: 'Query regarding Paracetamol Monograph',
      body: 'Dear Sir, We request clarification on the dissolution acceptance criteria for Paracetamol tablets IP.',
      inquirerName: 'Abhinash Pritiraj',
    });

    expect(result).toBeDefined();
    expect(result.text).toBe('The inquirer asks about monograph dissolution specifications for Paracetamol.');
    expect(result.keyPoints).toContain('Dissolution testing methodology');
    expect(result.topics).toContain('dissolution');
    expect(result.aiGenerated).toBe(true);
    expect(result.fallback).toBe(false);
  });

  it('should handle markdown code-block wrapped JSON from Gemma API response', async () => {
    const mockGemmaAnswer = `\`\`\`json
{
  "text": "Clarification requested on analytical testing of impurities.",
  "keyPoints": ["Impurity limits"],
  "topics": ["impurity"]
}
\`\`\``;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: mockGemmaAnswer }),
    });

    const result = await generateSummary({
      subject: 'Impurity limits enquiry',
      body: 'Please clarify the impurity limits for analytical testing.',
    });

    expect(result).toBeDefined();
    expect(result.text).toBe('Clarification requested on analytical testing of impurities.');
    expect(result.topics).toContain('impurity');
    expect(result.fallback).toBe(false);
  });

  it('should fallback gracefully when Gemma API call fails or times out', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error or timeout'));

    const result = await generateSummary({
      subject: 'Urgent query on Certificate of Analysis',
      body: 'We need urgent verification of the Coa for batch 12345.',
      inquirerName: 'Abhinash Pritiraj',
    });

    expect(result).toBeDefined();
    expect(result.text).toContain('Abhinash Pritiraj submitted an enquiry regarding');
    expect(result.topics).toContain('certificate');
    expect(result.aiGenerated).toBe(false);
    expect(result.fallback).toBe(true);
  });
});
