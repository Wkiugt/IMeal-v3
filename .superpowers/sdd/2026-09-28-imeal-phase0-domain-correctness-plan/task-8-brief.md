## Task 8: PostgreSQL cross-transaction concurrency and all-or-nothing proof

### Scope
- Extend migration-backed domain concurrency and persistence tests with real separate Prisma clients/transactions, row locks, unique constraints, deterministic fixtures, and schema-isolated cleanup.
- Extend API e2e scenarios for registration batch authority/failures, pickup exact-input/idempotency/aliases/auth, and dashboard state/error envelopes/aliases.
- Do not modify production behavior unless a focused test exposes a real defect. Do not add realtime/client/infrastructure/P1 work. Do not modify progress.md.

### Scenarios
- Derived serving projection and multi-item all-or-nothing behavior.
- Concurrent registration create and cancel/reactivate lifecycle serialization.
- Menu/roster changes preserve existing active snapshots while reactivation resolves new values.
- Serving/no-show/cancel races have exactly one winner and no losing side effects.
- Concurrent no-show worker transactions produce one unique penalty and preserve PAID/WAIVED retry state.
- API route aliases, authentication, request authority, idempotency, stable envelopes, dashboard state, and generic INTERNAL_SERVER_ERROR mismatch handling.

### Verification
- Run focused domain migration-backed commands and API e2e commands when DATABASE_URL is available.
- If DATABASE_URL is missing, skip/report the database suites honestly and still run non-DB static/type checks available for changed files.
- Create task-8-report.md with exact commands/results/blockers. Commit brief, tests/source (if any), and report; return exact commit hash.
