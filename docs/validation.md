# Validation record

## Local checks

- API TypeScript compilation: passed.
- Next.js production compilation and type checks: passed.
- Six offline/loopback tests: passed for payment state transitions, signed webhook acceptance/rejection, retryable persistence failures, request tampering/replay, outbox retry/acknowledgment and POST callback construction.
- Dependency audits: no known vulnerabilities reported for the installed API and panel lockfiles at preparation time.
- Tracked-file secret scan: passed. Real environment files and the original Git history are excluded.
- An additional local comparison against private configuration values found no matches in the proposed tracked files. No private values are included in this report or the CI configuration.

## Database integration

The repository includes a MariaDB integration test for concurrent duplicate webhooks, mismatched payment rollback, a single durable event per payment state and ordered callback retries. It requires the isolated `autopay_ci` database. All seven tests passed locally against a disposable MariaDB 11.4 container, including twelve concurrent duplicate payment updates and ordered retry/refund delivery. The database test is skipped in a default run without explicit database configuration.

The local container used synthetic credentials and a loopback-only port. Test signing secrets were generated for that process. No real payment-provider credentials were used. An optional pipeline example is provided in `docs/ci-workflow.example.yml`; it is not installed as an active GitHub workflow because the publishing connection lacks the workflow scope.

## Boundaries

No live charge was created, no real token was validated, and no game inventory was modified. Deployment-level TLS/proxy behavior, a real Mercado Pago sandbox and the private RedM inventory receiver still require integration validation by the server operator. Successful unit/CI checks are not a production certification.
