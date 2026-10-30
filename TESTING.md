# Testing VoiceNav AI

## Prerequisites

Use a current Node.js 22 LTS (or newer supported LTS) and npm. Install the locked dependencies from the repository root:

```powershell
npm ci
```

Automated tests use local fixtures, mocked fetch responses, fake speech recognition/synthesis, fake timers and a jsdom DOM. They do not call Nominatim, OSRM, Overpass, a speech provider or a model, and do not require microphone permission or API keys. Public-service uptime is deliberately not a test dependency.

## Commands

```powershell
npm test
npm run test:unit
npm run test:server
npm run test:coverage
npm run typecheck
npm run lint
npm run build
```

- `npm test` runs both client/unit/UI tests and server tests, failing if either fails.
- `test:unit` runs the top-level test files through `tsx` and Node's test runner.
- `test:server` runs server-only modules in a separate process with Node's `react-server` export condition. This correctly loads the `server-only` package without weakening production module boundaries.
- `test:coverage` runs the complete test command under c8 and fails if configured coverage thresholds are missed.
- Type checking includes the tests. Lint and production build are independent checks; a passing build does not mean lint passed.

Run one file or matching test names while developing:

```powershell
npx tsx --test tests/ui.test.ts
npx tsx --test --test-name-pattern="silent processed|persistent recognition" tests/safety.test.ts
npm run test:server
```

## Coverage Contract

[.c8rc.json](.c8rc.json) enforces aggregate critical-module coverage:

| Metric | Minimum | Latest measured |
| --- | --- | --- |
| Lines | 95% | 99.12% |
| Statements | 95% | 99.12% |
| Functions | 95% | 96.75% |
| Branches | 90% | 90.06% |

The measured set is all TypeScript in `src/ai`, `src/conversation`, `src/navigation`, `src/services`, `src/utils`, plus runtime schemas and API routes. `all: true` includes unexecuted files in that set, preventing a new untested critical module from disappearing from the denominator. The interface-only AI provider contract is excluded.

These are global gates across that set, not a 95% promise for every individual file. React TSX components, the UI orchestration hook, CSS, map rendering and framework configuration are outside the coverage gate. UI interaction tests still run, including Places outage/recovery and the interruptions checkbox workflow. Real speech, acoustic echo rejection, external-provider availability and hardware permissions cannot be established by this percentage.

c8 writes ignored reports under `coverage/`: `index.html` (HTML report), `lcov.info`, `coverage-summary.json` and `coverage-final.json`. Open the HTML report after running coverage to inspect individual files and uncovered branches. Do not commit generated reports or reduce thresholds to make a failure pass.

## Automated Areas

| Suite | Important cases |
| --- | --- |
| [tests/safety.test.ts](tests/safety.test.ts) | English/Hindi/Hinglish intent, negation/questions/ambiguity, original-source validation, confirmation, allowed IDs, invalid coordinates, atomic commits, superseded routes, five country-filtered nearest-first choices, last-choice-wins, long-lived choices, concurrent locks, stale search/alternative/detour results, metadata, geolocation failures |
| Same safety suite: voice | Final Send/Submit vs interim/silence, Discard, noise cleanup, retained drafts, playback filtering, same-recognizer continuous turns, native restarts, zero-argument native input, processed-track startup/fallback, six-second no-result heuristic, raw echo events, AEC upgrade failures, late cancellation, permissions and track cleanup |
| [tests/services.test.ts](tests/services.test.ts) | Availability notifications, unknown/outage/recovery, 429/5xx/network/JSON/schema failures, non-outage 4xx input errors, client request contracts |
| [tests/server/services.test.ts](tests/server/services.test.ts) | Same-origin/JSON/body-size/schema boundary, sanitized errors, cache TTL/capacity/in-flight deduplication, queue limits/recovery, throttling, upstream failures/timeouts, country lookup/filtering, OSRM coordinate order/alternatives, Overpass corridor limits/partial timeouts, all POST endpoints |
| [tests/ui.test.ts](tests/ui.test.ts) | Stable runtime identity, latest selected-origin reference, route preservation on failure, stale-result cleanup, service-status states/recovery, unavailable Places controls/retry; continuous listening displays words, discards drafts, submits turns and keeps its checkbox enabled after Stop |

Server fixtures advance mocked time and use unique cache keys. Do not introduce live API calls or real delay loops into these tests.

## Latest Validation

All 296 tests passed: 286 client/unit/UI tests and 10 server tests. The complete coverage command, repository-wide lint, TypeScript check and Next.js production build passed. npm reported zero dependency audit vulnerabilities at installation. The DOM/audio tests simulate browser events; they are not live microphone verification.

Playwright checks against the running Next.js app passed at 1440 x 1000 and 390 x 844: simulated 502 availability, disabled controls with enabled retry, recovery after a valid response, shared status updates from a conversational search, labeled retained results and no horizontal/control overflow. Map tiles rendered. API responses were intercepted locally for these checks and removed afterward; this does not assert live Nominatim/OSRM/Overpass uptime.

Before the behavior-preserving refactor, the complete 291-test baseline and all coverage gates passed. Five additional checks cover runtime/reference ownership, failed-route preservation, service presentation, immutable pending resets and substitutable service adapters. Existing regression expectations and coverage thresholds were not weakened. Every production refactor was followed by a focused test run before proceeding.

Repository-wide lint now passes without rule suppressions: voice handlers are declared before callback registration, runtime construction owns its reference outside React render, the ordinary capture helper is named `startNativeMicrophone`, and the PostCSS config has a named export object. Generated coverage files remain excluded from lint. See the design boundaries in [README.md](README.md).

## Browser And Device Acceptance

Start the app with `npm run dev` and use the localhost URL printed by Next.js. Test desktop and mobile widths, plus your actual Edge version, microphone and speakers/headphones while safely stopped.

1. Select exact origin/destination results and calculate a real driving route. Check geometry, markers, fit, attribution, readable panels and no horizontal overflow. Deny GPS permission and verify manual origin input remains usable.
2. Before any service request, status is **Not checked yet**. Simulate `/api/places` returning 502: it must say **Places temporarily unavailable**, not pretend that restaurants were searched successfully. Categories/scope disable, previous results remain labeled, and retry stays available. Let retry return valid data: controls recover. Repeat through a voice request. Verify a 422 input/policy error does not declare a provider outage.
3. Simulate address and routing outages: errors/status remain visible and the active route is preserved. No fake destination, distance, time, business or rating should appear. Verify the separate Future Enhancements section lists genuinely missing capabilities.
4. Ask ETA, distance, traffic, details, comparisons, alternatives, hypothetical/negative instructions and ambiguous references. The active destination must not change. Confirmed explicit navigation alone may change it. Fail or delay routing, then replace/clear the journey: stale results cannot overwrite the newer session.
5. Request an ambiguous destination: up to five eligible domestic addresses, nearest-first, full text visible, but audio/replay only **Say the option.** Informational questions and waiting six minutes retain choices. **option one option one option two Submit** commits option two once. **option one option 99 Submit**, questions and alternatives must not pick a valid earlier result. A single match still requires confirmation.
6. In manual mode, say **Hitech City Submit**, repeat with Send and Hindi controls. Check one submission, no control in the geocoding query, no submission on interim speech/silence, retained drafts after Stop and 90/15-second recording limits. Discard must not clear an active route or cancel an already submitted turn.
7. Enable **Allow interruptions** before speaking: words appear immediately. Submit several independent turns and discard an unsent one. Check listening between replies and during processing, FIFO explicit submissions, and no duplicated earlier text. Stop microphone/playback must leave the checkbox on and rearm capture. Opt-out, hide, collapse and unmount must release capture. Turning it back on requires an explicit action.
8. Test unsupported processed-track recognition, missing reported AEC, readiness timeout, six seconds with no raw result, denied permission and late grants. Compatibility fallback must warn, start ordinary native input once, and clean up its original stream. Native fallback failure must stop visibly. A raw result filtered as echo still proves activity for the watchdog; silence may trigger fallback even when a track is healthy.
9. Test English and Hindi synthesis/replay, installed/missing Hindi voices and long replies. Speak over playback without a wake phrase. With Nova speaking alone, observe whether any transcript/submission occurs; repeat on headphones. **No automated test or AEC setting proves complete speaker isolation.** Record actual browser/device failures before claiming the original self-audio issue is resolved.

Use browser request interception or local fixtures for repeated outage tests, rather than deliberately loading public providers. Live external requests should be limited and respect the service policies in [README.md](README.md).