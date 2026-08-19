import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { forwardToOfficerInCharge } from '../services/email/emailService.js';

describe('Gemma AI Integration & REST API Tests', () => {
  it('POST /api/v1/ai/summary should return a 200 OK with AI summary', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: JSON.stringify({
          text: 'Abhinash asks about monograph dissolution test standards.',
          keyPoints: ['Dissolution testing protocol'],
          topics: ['monograph', 'dissolution'],
        }),
      }),
    });

    const response = await request(app)
      .post('/api/v1/ai/summary')
      .send({
        subject: 'Enquiry on Monograph Dissolution',
        body: 'We are seeking guidance regarding the dissolution test procedure for Paracetamol IP tablets.',
        inquirerName: 'Abhinash Pritiraj',
      });

    global.fetch = originalFetch;

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.summary).toBeDefined();
    expect(response.body.summary.text).toBeTypeOf('string');
  });

  it('forwardToOfficerInCharge should inject Gemma AI Summary into email body sent to OIC', async () => {
    const mockSummary = {
      text: 'Abhinash asks about monograph dissolution test standards.',
      keyPoints: ['Dissolution testing protocol'],
      topics: ['monograph', 'dissolution'],
      aiGenerated: true,
      fallback: false,
    };

    const forwardResult = await forwardToOfficerInCharge({
      queryId: 'QRY-2026-00999',
      subject: 'Monograph Procedure Clarification',
      body: 'Dear Front Office, Please assist us with the dissolution procedure.',
      aiSummary: mockSummary,
    });

    expect(forwardResult).toBeDefined();
    expect(forwardResult.aiSummary).toEqual(mockSummary);
    expect(forwardResult.body).toContain('🤖 GEMMA AI QUERY SUMMARY');
    expect(forwardResult.body).toContain('Abhinash asks about monograph dissolution test standards.');
  });
});
