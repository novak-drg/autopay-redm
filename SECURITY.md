# Security practices

This public repository contains fictional environment templates. Real environment files, private keys, databases, build artifacts and dependency folders are excluded from Git. A local check scans tracked files before publication and in CI; pattern checks cannot guarantee that every possible secret has been detected.

Keep provider tokens, signing secrets and database passwords in a deployment secret store. Use independent random values for service authentication, request signing, administrator JWTs and game callbacks. A missing or placeholder secret fails startup. Never reuse the example strings in a deployed instance.

## Included controls

- Official SDK verification for Mercado Pago webhook signatures, with a timestamp tolerance.
- Resource identifier consistency and a server-side provider lookup before payment updates.
- Transactional payment state changes and a durable outbox with per-charge ordering.
- Parameterized database values, catalog price checks, bearer authentication and signed service requests.
- Persistent single-use nonces and rate limits.
- Administrator cookies with HttpOnly and SameSite; Secure is enabled in production.
- Atomic single-use refresh consumption and active-account checks.
- Same-origin/custom-header checks at the panel proxy; server-side authorization remains mandatory.
- Callback timeout, no redirects, and payloads outside URLs.
- No request that simulates a payment as paid and no automatic tunnel startup.

## Deployment responsibilities

Configure HTTPS, database isolation, backups, trusted proxies, secret rotation and alerting. Verify the actual delivered cookie/header behavior behind your proxy. Test the RedM inventory adapter and payment provider in an isolated sandbox before accepting payments.

Do not publish credentials or customer/payment records in an issue. Report suspected security problems privately to the repository owner. If a real credential has ever been committed elsewhere, revoke or rotate it; creating this repository does not invalidate it.
