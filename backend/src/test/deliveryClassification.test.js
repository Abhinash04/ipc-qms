import { describe, it, expect } from 'vitest';
import {
  classifyDelivery,
  isTransientNetworkFailure,
  isUnreachable,
  isAuthFailure,
  DELIVERY,
} from '../services/email/delivery.js';

/**
 * Telling a send that never left from one that might have.
 *
 * Everything downstream rests on this single judgement: a NOT_SENT failure may
 * be retried, and an UNCERTAIN one may not be. The live failure that prompted
 * it — a DNS failure reaching the mail provider — is the clearest case of
 * "nothing left this machine", and it was being treated exactly like a timeout
 * mid-request, which is the opposite.
 */

/** A failure as a mail provider's HTTP client raises it. */
const providerError = (message, properties = {}) => Object.assign(new Error(message), properties);

describe('classifying a failed send', () => {
  it('counts a DNS failure as never sent', () => {
    const error = providerError('request to the mail provider failed, reason: getaddrinfo ENOTFOUND', {
      code: 'ENOTFOUND',
    });

    expect(classifyDelivery(error)).toBe(DELIVERY.NOT_SENT);
    // And worth one immediate retry: the name may resolve a second later.
    expect(isTransientNetworkFailure(error)).toBe(true);
  });

  it('counts a refusal by the provider as never sent', () => {
    expect(classifyDelivery(providerError('Invalid to header', { status: 400 }))).toBe(DELIVERY.NOT_SENT);
    expect(classifyDelivery(providerError('invalid_grant', { status: 400 }))).toBe(DELIVERY.NOT_SENT);
    // But a 4xx will not fix itself, so it is not retried automatically.
    expect(isTransientNetworkFailure(providerError('Invalid to header', { status: 400 }))).toBe(false);
  });

  it('counts a connection lost mid-request as uncertain', () => {
    expect(classifyDelivery(providerError('socket hang up', { code: 'ECONNRESET' }))).toBe(DELIVERY.UNCERTAIN);
    expect(classifyDelivery(providerError('timeout', { code: 'TimeoutError' }))).toBe(DELIVERY.UNCERTAIN);
    expect(classifyDelivery(providerError('Backend error', { status: 500 }))).toBe(DELIVERY.UNCERTAIN);
  });

  /**
   * A local error — a missing credential, a bad template, a refused attachment —
   * is raised before anything is sent. Treating those as uncertain would strand
   * every configuration mistake behind a manual check.
   */
  it('counts a local error as never sent', () => {
    expect(classifyDelivery(new Error('NICeMail UI element "sendButton" was not found.'))).toBe(
      DELIVERY.NOT_SENT,
    );
  });

  it('lets a transport overrule it', () => {
    const pressedSend = Object.assign(new Error('no confirmation seen'), { unconfirmed: true });
    expect(classifyDelivery(pressedSend)).toBe(DELIVERY.UNCERTAIN);

    const neverSent = Object.assign(new Error('mock could not deposit'), { delivery: DELIVERY.NOT_SENT });
    expect(classifyDelivery(neverSent)).toBe(DELIVERY.NOT_SENT);
  });

  it('separates "cannot be reached" from "credential refused", for the inbox poll', () => {
    expect(isUnreachable(providerError('getaddrinfo ENOTFOUND', { code: 'ENOTFOUND' }))).toBe(true);
    expect(isUnreachable(providerError('Too many requests', { status: 429 }))).toBe(true);
    expect(isUnreachable(providerError('Backend error', { status: 500 }))).toBe(true);

    expect(isAuthFailure(providerError('Invalid Credentials', { status: 401 }))).toBe(true);
    expect(isAuthFailure(providerError('invalid_grant: Token has been expired or revoked.', { status: 400 }))).toBe(true);
    expect(isAuthFailure(providerError('getaddrinfo ENOTFOUND', { code: 'ENOTFOUND' }))).toBe(false);
  });
});
