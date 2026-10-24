# RedM integration contract

## Service requests

Only the server-side RedM resource calls the API. Never place service credentials in a NUI bundle or client Lua script. The player submits a product identifier; the resource derives the player's identity and the API verifies the catalog price.

All `/v1/*` service routes, except the dedicated admin and provider-webhook routes, require a bearer token plus these headers:

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer <SERVICE_TOKEN>` |
| `X-Request-Nonce` | 32 cryptographically random bytes encoded as 64 lowercase hexadecimal characters |
| `X-Request-Time` | Unix timestamp in seconds |
| `X-Request-Sig` | Lowercase hex HMAC-SHA256 of the manifest below, keyed by `SERVICE_HMAC_SECRET` |

Join these five fields with a newline, without a trailing newline:

1. Nonce.
2. Timestamp header, unchanged.
3. Uppercase HTTP method.
4. Complete request path and query string, exactly as transmitted.
5. Lowercase hexadecimal SHA-256 of the exact body bytes; use an empty body for GET.

The API permits a 30-second clock difference and persists nonce consumption with a unique database key. Retrying requires a fresh nonce/signature and the same business idempotency key. The manifest is implemented in `external-api/src/requestSignature.ts`.

## Payment creation

`POST /v1/payments/pix/charges` receives a unique `internalChargeId`, an `idempotencyKey`, the authoritative `playerIdentifier`, `productId`, `amountCents`, `currency: "BRL"` and `expiresInSeconds`. Optional coupon and metadata fields are validated by the API. Reusing a key for a different player/product/charge is rejected.

Catalog rewards are retrieved server-side from `/v1/service/products/:id/rewards`. Do not let a browser or game client supply arbitrary inventory commands or reward amounts.

## Receiving payment events

Set `REDM_CALLBACK_URL` to the server-controlled receiver. HTTPS is required except for loopback HTTP. Callback redirects are rejected so authentication cannot be forwarded to an unexpected host.

```http
POST /autopay/payment-events
Authorization: Bearer <REDM_CALLBACK_TOKEN>
Idempotency-Key: payment:example-charge:PAID
Content-Type: application/json
```

```json
{
  "eventKey": "payment:example-charge:PAID",
  "chargeId": "example-charge",
  "playerIdentifier": "license:synthetic-player",
  "productId": "starter-kit",
  "status": "PAID",
  "amountCents": 2500,
  "transactionId": "synthetic-transaction",
  "endToEndId": null
}
```

These identifiers are fictional. The backend sends the payload in the request body, not in the URL.

The receiver must:

1. Authenticate the callback and validate its complete schema.
2. Persist/deduplicate `eventKey` before any non-idempotent action. Use a transactional inbox or equivalent design compatible with the inventory framework.
3. Resolve the configured product rewards on the server. Grant items only for `PAID`; process `REFUNDED`/`CHARGEDBACK` through a separate policy.
4. If the player is offline, persist the pending delivery and fulfill it when the player reconnects.
5. Respond with 2xx only after accepting the event durably. Repeated accepted events return 2xx without granting rewards twice.
6. Call `POST /v1/payments/pix/charges/:internalChargeId/deliver` only after the inventory grant succeeds. The API will only mark paid, previously undelivered charges.

The worker retries failed callbacks with exponential backoff, capped at one hour. A 60-second database lease recovers work after a process restart. Unfinished events block later events for the same charge, preserving payment/refund ordering. Monitor the outbox for persistent failures; events are not silently discarded after a fixed attempt limit.

## Offline recovery

`GET /v1/players/:identifier/pending-deliveries` lists paid charges not yet confirmed as delivered. Use the same persistent grant ledger for callback and recovery flows. The API cannot make an external inventory operation exactly-once by itself.
