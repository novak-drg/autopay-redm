import crypto from 'node:crypto';
import { config } from './config.js';
export type CatalogPushType = 'product' | 'box' | 'coupon';
export type CatalogPushAction = 'created' | 'updated' | 'deleted';
/** Optional cache invalidation hint; authoritative catalog remains available through the API. */
export const pushCatalogToFivem = (type: CatalogPushType, action: CatalogPushAction, id: string): void => {
  if (!config.fivemCatalogCallbackUrl) return;
  const eventKey = `catalog:${crypto.randomUUID()}`;
  void fetch(config.fivemCatalogCallbackUrl, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.fivemCallbackToken}`, 'Idempotency-Key': eventKey },
    body: JSON.stringify({ eventKey, type, action, id }),
  }).then(async response => {
    await response.body?.cancel();
    if (!response.ok) console.warn('[catalog-push] Cache refresh hint was not accepted.');
  }).catch(() => console.warn('[catalog-push] Cache refresh hint unavailable; use catalog polling.'));
};
