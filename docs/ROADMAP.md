# Development roadmap

## Implemented

HTTP/latency/JSON assertions; bounded response-shape comparison; immutable evidence; configurable incident/recovery streaks; acknowledgement; pause/maintenance; configuration revisions and control epochs; replay-safe check execution; private HTTPS transport; durable SQLite execution jobs, recorded attempts, fenced leases, crash recovery and interval cursors; history/export UI; disposable fixture-only public demo.

## Completed: durable scheduling

SQLite jobs, 15-second worker leases, three-attempt recovery, atomic evidence/incident/job commits and persistent interval cursors are implemented. A real child-process crash and stale-worker fencing are covered by automated tests. Missed intervals coalesce into one present observation. HTTP GET may repeat after interruption; multi-host scheduling and external notification delivery remain outside this milestone.

## Next: notification delivery

An outbox table, retry policy and a configurable webhook/email integration. Acceptance: incident state commits independently of provider availability and delivery attempts remain auditable. No external notifications are sent by the current implementation.

## Next: richer contracts

Versioned JSON Schema/OpenAPI definitions, required/optional property semantics and explicit compatibility rules. Acceptance: reports distinguish contract violations from informational shape drift and preserve the rule version applied.

## Next: authenticated targets and workspace isolation

Encrypted upstream secrets, redacted evidence previews, user/workspace roles and scoped exports. Acceptance: unrelated workspaces cannot retrieve another workspace's monitors, previews or integration settings. Current private mode has one operator; public visitors share synthetic data.

## Next: additional probes and storage

A PostgreSQL adapter with the same transactional invariant suite, then region-tagged external probe workers. Measure observed latency and reliability before publishing any availability or throughput claims.
