# CV and LinkedIn wording

## CV

**API Sentinel — API Reliability & Contract Monitoring** | Node.js, TypeScript, SQL, SQLite, React

- Built configurable API checks for HTTP status, latency and JSON assertions, with preserved response evidence and response-shape baseline comparisons.
- Implemented threshold-driven incidents, acknowledgement and confirmed recovery; protected current state from obsolete in-flight results using configuration versions and control epochs.
- Added replay-safe execution, transactional incident updates, a bounded HTTPS probe transport and a durable SQLite job queue with fenced leases, crash recovery and persisted interval cursors; verified rollback, concurrent request reuse and the complete browser workflow.

## LinkedIn description

API Sentinel is a full-stack API monitoring workspace that connects response expectations, check evidence and incident decisions. Its Node.js/TypeScript backend evaluates HTTP status, latency and JSON Pointer assertions, while the React interface exposes response history, type drift, incident acknowledgement and recovery evidence.

The engineering focus is the state transition behind a monitoring result: repeated requests share one observation, database transactions keep evidence and incidents consistent, and outdated results cannot alter current monitor state after configuration or operational controls change. Private mode includes public-address HTTPS probing and optional interval execution; a separate disposable demonstration uses synthetic endpoints with controllable outage, slowdown and drift scenarios.

The repository includes automated domain/API tests, an end-to-end Chromium investigation workflow, Docker packaging and GitHub Actions. It is designed as a bounded single-process application; distributed scheduling, notifications, multi-region probes and multi-tenant authentication remain future extensions.

Suggested skills: TypeScript · Node.js · React · REST APIs · SQL · API Testing · Monitoring · Incident Management · Automated Testing · Docker · GitHub Actions.
