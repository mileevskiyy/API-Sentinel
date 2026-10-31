# Verification record

Local verification on 31 October 2026:

- Node.js 24.17.0; dependency versions captured in `package-lock.json`.
- Domain, transport-policy and HTTP tests: **48 passed**.
- TypeScript checking and production Vite build: passed.
- Chromium: create monitor, simulate outage, acknowledge incident, inspect opening evidence, restore service, inspect shape drift, suppress a maintenance check, pause/resume, download evidence and reload session: passed.
- Mobile viewport 390 × 844: no document-level horizontal overflow; wide tables and navigation scroll within their own containers.
- Real HTTPS transport check against the public GitHub `nodejs/node` repository API returned status 200 and the expected repository identity through the validated/pinned DNS path.
- Desktop and mobile screenshots were visually inspected and are included in `docs/`.

The rollback test forces incident insertion to fail and checks that the associated check, request key, streak and audit event roll back. Replay tests verify one probe and one state transition across concurrent identical requests. Address-policy tests include loopback, private, link-local, multicast, reserved, IPv6 and IPv4-mapped loopback addresses; mixed DNS answers are rejected.

These checks verify the documented bounded operating model. They are not a load test, penetration test, multi-region availability measurement or claim of production usage. The GitHub transport check is a recorded smoke check; automated CI does not depend on an external API being available.
