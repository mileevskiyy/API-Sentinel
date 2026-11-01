# Architecture and API

## Execution path

```text
Manual request or due scheduler interval
                  |
                  v
Request identity + per-monitor execution gate
                  |
                  v
Built-in fixture OR public-address HTTPS GET
                  |
                  v
Status / latency / JSON assertions + response-shape comparison
                  |
                  v
Configuration version + control-epoch freshness check
                  |
                  v
One SQL transaction
  - check evidence
  - request-key identity
  - streak update
  - incident transition
  - event
```

`contracts.ts` defines bounded configuration and result contracts. `probe.ts` owns JSON Pointer traversal, response-shape extraction, fixture responses and the HTTPS boundary. `evaluate.ts` produces assertion decisions. `store.ts` owns persistence and the incident state machine. `scheduler.ts` dispatches through the same execution gate as manual requests. `app.ts` adds sessions, request validation and exports.

## Tables

- `monitors`: current configuration, version, control epoch, pause/maintenance flags, baseline, streaks and timestamps.
- `checks`: immutable result payload and original configuration snapshot, unique monitor/request identity and observation timestamp.
- `request_keys`: lightweight identities retained after check payload expiry to prevent replay from becoming a new observation.
- `incidents`: lifecycle payload with opening and optional recovery check references.
- `events`: configuration, baseline, control and incident decisions.

The schema initializes as version 1 with `PRAGMA user_version`; there is no general migration framework. Parameterized SQL is used for data values.

## Atomic transitions

The probe runs outside the SQL transaction. On completion, a synchronous `BEGIN IMMEDIATE` transaction checks current configuration/control state and records the result. Outdated results remain inspectable but cannot affect streaks or incidents. Failed SQL writes roll back both evidence and state changes.

One JavaScript process serializes synchronous SQL state transitions. The in-flight map limits overlap, not database locking across multiple workers. Running several application processes against the same SQLite file is outside the supported model.

## HTTP endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness and public/private mode |
| GET | `/api/session` | Session state, demo flag and CSRF token |
| POST | `/api/demo-login` | Enter shared fixture-only demo |
| POST | `/api/login` | Private operator login |
| POST | `/api/logout` | Invalidate current session |
| GET | `/api/workspace` | Monitor summaries, metrics, incidents and events |
| POST | `/api/monitors` | Create validated configuration |
| GET | `/api/monitors/{id}` | Monitor, checks, incidents and events |
| PUT | `/api/monitors/{id}` | Edit `{version,config}` with optimistic revision check |
| PATCH | `/api/monitors/{id}/control` | Set pause, maintenance or fixture scenario |
| POST | `/api/monitors/{id}/checks` | Execute `{key}` or replay a retained result |
| GET | `/api/checks/{id}` | Retrieve original check evidence |
| POST | `/api/monitors/{id}/baseline` | Accept a passing current-revision `{checkId}` |
| POST | `/api/incidents/{id}/acknowledge` | Acknowledge with optional `{note}` |
| GET | `/api/monitors/{id}/export` | Download retained monitor evidence as JSON |

Authenticated writes require `X-CSRF-Token`; the token is returned by `/api/session`. Login creates a random HTTP-only, SameSite session cookie and invalidates the previous session when rotating. Secure cookies are enabled for hosted HTTPS. Sessions expire after two hours; entry attempts are bounded.

## Network constraints

Public mode cannot configure external targets or attach a persistent database. Private probes accept HTTPS GET on 443, validate all resolved IP addresses and pin one approved address into the connection. Redirects are rejected. TLS verification remains enabled. The transport accepts JSON only and uses a bounded body/deadline.

The response preview stores up to 4 KB of JSON text. It may contain endpoint data; choose endpoints whose output is appropriate for the private workspace. The public demo uses only synthetic in-process response objects.

## Scheduler and shutdown

The worker polls durable jobs every second; optional private interval scheduling also advances persisted cursors. Re-entrant ticks share the running tick. On shutdown the timer stops, active work drains, HTTP requests finish and SQLite closes. Public mode permits explicit fixture jobs but refuses recurring interval scheduling. See the durable execution protocol below.

## Durable execution protocol

`execution_jobs` captures monitor revision, control epoch, request identity and source; `execution_attempts` records each claim. A partial unique index permits one queued/running job per monitor. Claims use an immediate SQLite transaction and admit four unexpired leases across connections. Lease tokens stay server-side. Expired claims mark the previous attempt abandoned before another attempt begins.

Result recording fences the token inside the transaction that writes checks, request identities, incidents, streaks, audit events and job completion. Storage failure rolls back that transaction and schedules a bounded retry. An HTTP error is evidence, not an infrastructure retry. A queued snapshot invalidated by pause/configuration changes is cancelled without probing.

`schedule_cursors` advances atomically with scheduled job creation. Downtime coalesces missed slots; no result is assigned a fictional historical timestamp. Persistent private SQLite provides restart recovery. The shared public in-memory fixture demo only demonstrates queue execution within its current lifetime.

API additions: `GET /api/jobs?monitor_id=<uuid>`, `GET /api/jobs/:id`, `POST /api/monitors/:id/jobs` with `{key}`, `POST /api/jobs/:id/cancel`, and `POST /api/jobs/:id/retry` with a fresh `{key}`. Retry links a new execution to its failed predecessor. Existing authentication, Origin and CSRF checks protect mutations. Raw lease tokens and snapshots are excluded from job responses.
