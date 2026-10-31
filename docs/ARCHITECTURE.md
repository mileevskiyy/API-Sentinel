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

The optional scheduler checks eligibility every five seconds and dispatches sequentially through `Store.run`. Re-entrant ticks share the running tick. Stable revision/interval keys prevent duplicate dispatch in a polling window. On shutdown, the timer stops, an active tick drains, HTTP requests finish and SQLite closes. The scheduler is disabled and refused in public-demo mode.
