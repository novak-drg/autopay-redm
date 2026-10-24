import type { ChargeStatus } from './types.js';

const transitions: Record<ChargeStatus, readonly ChargeStatus[]> = {
  CREATED: ['PENDING', 'PAID', 'FAILED', 'CANCELED', 'EXPIRED', 'REFUNDED', 'CHARGEDBACK'],
  PENDING: ['PAID', 'FAILED', 'CANCELED', 'EXPIRED', 'REFUNDED', 'CHARGEDBACK'],
  PAID: ['REFUNDED', 'CHARGEDBACK'],
  // A verified provider approval can arrive after the local expiration sweep.
  EXPIRED: ['PAID', 'REFUNDED', 'CHARGEDBACK'],
  FAILED: [],
  CANCELED: [],
  REFUNDED: ['CHARGEDBACK'],
  CHARGEDBACK: [],
};

export const canTransition = (from: ChargeStatus, to: ChargeStatus): boolean =>
  transitions[from]?.includes(to) ?? false;

export const needsGameNotification = (status: ChargeStatus): boolean =>
  ['PAID', 'REFUNDED', 'CHARGEDBACK'].includes(status);
