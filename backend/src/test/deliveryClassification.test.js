import { describe, it, expect } from 'vitest';
import {
  classifyDelivery,
  isTransientNetworkFailure,
  isUnreachable,
  isAuthFailure,
  DELIVERY,
} from '../services/email/delivery.js';

const providerError = (message, properties = {}) => Object.assign(new Error(message), properties);

describe('classifying a failed send', () => {
  it('counts a DNS failure as never sent', () => {
    const error = providerError('request to the mail provider failed, reason: getaddrinfo ENOTFOUND', {
      code: 'ENOTFOUND',
    });

    expect(classifyDelivery(error)).toBe(DELIVERY.NOT_SENT);
    expect(isTransientNetworkFailure(error)).toBe(true);
  });

  it('counts a refusal by the provider as never sent', () => {
    expect(classifyDelivery(providerError('Invalid to header', { status: 400 }))).toBe(DELIVERY.NOT_SENT);
    expect(classifyDelivery(providerError('invalid_grant', { status: 400 }))).toBe(DELIVERY.NOT_SENT);
    expect(isTransientNetworkFailure(providerError('Invalid to header', { status: 400 }))).toBe(false);
  });

  it('counts a connection lost mid-request as uncertain', () => {
    expect(classifyDelivery(providerError('socket hang up', { code: 'ECONNRESET' }))).toBe(DELIVERY.UNCERTAIN);
    expect(classifyDelivery(providerError('timeout', { code: 'TimeoutError' }))).toBe(DELIVERY.UNCERTAIN);
    expect(classifyDelivery(providerError('Backend error', { status: 500 }))).toBe(DELIVERY.UNCERTAIN);
  });

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
