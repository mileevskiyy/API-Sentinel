# Development roadmap

## Implemented

HTTP/latency/JSON assertions; bounded response-shape comparison; immutable evidence; configurable incident/recovery streaks; acknowledgement; pause/maintenance; configuration revisions and control epochs; replay-safe check execution; private HTTPS transport; optional single-process scheduler; history/export UI; disposable fixture-only public demo.

## Next: durable scheduling

Persist due-job claims and execution attempts; introduce worker leases and crash recovery. Acceptance: a worker interrupted after probing can resume without duplicate incidents or lost result evidence. The current in-process timer does not claim this behavior.

## Next: notification delivery

An outbox table, retry policy and a configurable webhook/email integration. Acceptance: incident state commits independently of provider availability and delivery attempts remain auditable. No external notifications are sent by the current implementation.

## Next: richer contracts

Versioned JSON Schema/OpenAPI definitions, required/optional property semantics and explicit compatibility rules. Acceptance: reports distinguish contract violations from informational shape drift and preserve the rule version applied.

## Next: authenticated targets and workspace isolation

Encrypted upstream secrets, redacted evidence previews, user/workspace roles and scoped exports. Acceptance: unrelated workspaces cannot retrieve another workspace's monitors, previews or integration settings. Current private mode has one operator; public visitors share synthetic data.

## Next: additional probes and storage

A PostgreSQL adapter with the same transactional invariant suite, then region-tagged external probe workers. Measure observed latency and reliability before publishing any availability or throughput claims.
