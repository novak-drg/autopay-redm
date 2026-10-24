import crypto from 'node:crypto';
import type { ChargeRecord } from './types.js';

export interface OutboxEvent {
  id: number;
  eventKey: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface OutboxStore {
  claim: () => Promise<OutboxEvent | null>;
  acknowledge: (id: number) => Promise<void>;
  retry: (id: number, attempts: number) => Promise<void>;
}

export function gamePayload(charge: ChargeRecord): Record<string, unknown> {
  return {
    chargeId: charge.internalChargeId, playerIdentifier: charge.playerIdentifier,
    productId: charge.productId, status: charge.status,
    amountCents: charge.amountCents, transactionId: charge.transactionId,
    endToEndId: charge.endToEndId,
  };
}

/** The consumer must persist eventKey and grant items idempotently. */
export async function sendGameEvent(
  event: OutboxEvent, url: string, token: string, fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(url, {
    method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
      'Idempotency-Key': event.eventKey },
    body: JSON.stringify({ eventKey: event.eventKey, ...event.payload }),
    signal: AbortSignal.timeout(10_000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error('game_callback_rejected');
}

export async function processDelivery(store: OutboxStore, send: (event: OutboxEvent) => Promise<void>): Promise<boolean> {
  const event = await store.claim();
  if (!event) return false;
  try {
    await send(event);
    await store.acknowledge(event.id);
  } catch {
    await store.retry(event.id, event.attempts + 1);
  }
  return true;
}

export const workerId = (): string => crypto.randomUUID();
