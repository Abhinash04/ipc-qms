import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { recommendOfficial } from '../services/ai/gemmaService.js';

describe('Gemma AI Recommendation System Tests', () => {
  it('recommendOfficial should return Top 3 ranked officials based on domain keywords', async () => {
    const recommendations = await recommendOfficial({
      subject: 'Enquiry regarding Dissolution & Assay testing for Paracetamol IP',
      body: 'We request clarification on the dissolution acceptance criteria and chromatographic assay method for Paracetamol tablets.',
      summaryText: 'Technical enquiry regarding dissolution testing and assay methodology.',
    });

    expect(recommendations).toBeDefined();
    expect(Array.isArray(recommendations)).toBe(true);
    expect(recommendations.length).toBeLessThanOrEqual(3);

    const top1 = recommendations[0];
    expect(top1).toBeDefined();
    expect(top1.rank).toBe(1);
    expect(top1.userId).toBe('USR-0004'); // Neha Singh (Dissolution & Assay expert)
    expect(top1.name).toBe('Neha Singh');
    expect(top1.matchPercent).toBeGreaterThanOrEqual(70);
  });

  it('POST /api/v1/ai/recommend endpoint should return Top 3 recommendations', async () => {
    const response = await request(app)
      .post('/api/v1/ai/recommend')
      .send({
        subject: 'Microbiology Sterility Test Query',
        body: 'Please provide guidelines for bacterial endotoxin and sterility limits.',
        summaryText: 'Inquirer asks about sterility test procedures and endotoxin limits.',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.recommendations)).toBe(true);
    expect(response.body.recommendations.length).toBeGreaterThan(0);

    const top1 = response.body.recommendations[0];
    expect(top1.userId).toBe('USR-0011'); // Arjun Nair (Microbiology & Sterility expert)
  });
});
