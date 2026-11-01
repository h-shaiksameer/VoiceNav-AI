# VoiceNav AI

VoiceNav AI is a voice-first journey workspace built with Next.js App Router, TypeScript, React, Leaflet, and OpenStreetMap services. It combines natural-language intent classification with local, deterministic execution for geocoding, routes, places, confirmations, and navigation state.

It is designed as a calmer, more explainable alternative to command-heavy navigation: ask a question in ordinary language, inspect what the system found, and decide what should change. It is currently a route-preview MVP, not live turn-by-turn navigation.

## What It Does

- Resolves origins and destinations with Nominatim.
- Calculates driving routes and static durations through OSRM.
- Searches nearby and along-route places through Overpass.
- Answers route questions about ETA, distance, traffic availability, alternatives, place details, and comparisons.
- Handles natural-language requests such as:
  - `Where is Charminar?`
  - `Where is this?` or `Where is that?` when referring to a recent result.
  - `Where is Charminar, take me there?`
  - `How far is Charminar from Hyderabad?`
  - `How much time will it take me to go from Hyderabad to Charminar?`
  - `Find restaurants near me.`
  - `How much longer will it take?`
- Supports English text and browser speech, with experimental Hindi/Hinglish text handling.
- Reads assistant responses aloud and continues playback when the site is moved to a background tab, subject to browser audio policy.
- Provides a separate Map Voice mode for zoom, pan, center, and reset commands.

## Platform At A Glance

VoiceNav is organized around four connected experiences:

1. **Main journey** - plan an origin and destination, inspect the route, start or pause a journey preview, monitor progress, and ask Nova questions.
2. **Session workspaces** - create independent journey spaces for different trips or planning scenarios without overwriting the main journey.
3. **Parallel Assistant** - ask route questions such as time, distance, or traffic availability without changing the route or interrupting the main navigation context.
4. **Multi-stop Trip Optimizer** - provide two to twelve stops in any order and receive a road-network-based recommended start, stop order, total distance, duration, and route preview.

The result is a planning surface rather than a single linear navigation screen. A user can keep one journey ready, explore another workspace, compare stops, and return without losing the original route context.

## AI Architecture

The AI provider is an intent classifier. It does not receive navigation authority and never directly changes a route.

```text
User text or speech
        |
        v
Server-only Gemini or Muse intent classifier
        |
        v
Validated intent schema and local safety rules
        |
        v
ConversationEngine
        |
        +--> Nominatim geocoding
        +--> OSRM route calculation
        +--> Overpass place search
        +--> NavigationController state changes
```

Provider order:

1. The first-party Meta Model API is selected when `META_ENABLED=on` and a Meta API key is present.
2. Gemini is selected when it is enabled and configured.
3. Baseten-hosted Muse is selected when it is enabled and configured.
4. The deterministic local English/Hindi/Hinglish processor handles the request when optional providers fail or are not configured.

The server validates model JSON with Zod. The local processor applies additional rules for destination wording, references, categories, negation, ambiguity, and route safety. A destination change requires either confirmation or a valid pending result selection before the active journey changes.

## Model Provider Compatibility

VoiceNav supports provider credentials through server-side adapters rather than sending keys to the browser. The supported paths are:

| Credential type | Provider path | Model configuration | Status |
| --- | --- | --- | --- |
| First-party Meta API key | Meta Model API | `META_MODEL`, defaulting to `muse-spark-open` | Supported |
| Baseten API key | Baseten OpenAI-compatible Model API | `BASETEN_MODEL`, defaulting to `meta-models/muse-spark-open-1026` | Supported |
| Gemini API key | Google Gemini API | `GEMINI_MODEL` | Supported |

This means the repository is ready for a future Meta API key without a code rewrite. Enable the Meta provider, provide the credential through the server environment, restart the application, and the same intent schema, local safety checks, route execution, speech workflow, and fallback behavior remain in place. The key is never included in client requests or model prompts.

The phrase “any API key” is intentionally limited to a valid key for one of these supported provider contracts. A key from an unrelated service cannot work unless that service exposes a compatible adapter, endpoint, authentication method, and response format.

### Hackathon Readiness

For a Meta-focused submission, configure the first-party Meta provider and use a supported Meta model such as Muse through the Meta Model API. The application records the provider path in its server response and keeps the model's role auditable: Meta interprets the user's language, while local code validates the intent and performs navigation actions.

This architecture is designed to satisfy common hackathon expectations around meaningful use of the sponsor model, demonstrable product behavior, and safe integration. Final eligibility still depends on the named event's current rules, required model versions, judging rubric, attribution requirements, and submission evidence. The README does not include credentials or credential values.

## Local Setup

Requirements:

- Node.js 22 LTS or later.
- npm.
- A browser with speech recognition support for voice input.
- HTTPS or localhost for microphone and geolocation permissions.

Install and start development:

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`. If the port is occupied, use the alternate port printed by Next.js.

Production build and preview:

```powershell
npm run build
npm run start
```

## Voice Interaction

Normal Nova voice and Map Voice are separate modes and share a microphone ownership lock.

Normal Nova:

- Type a request or use the Nova microphone.
- For speech submission, finish with `Send` or `Submit` when using normal recognition.
- A valid destination selection can be spoken as `option one` or selected with a button.
- Assistant speech can be stopped or replayed from the conversation controls.
- Background-tab playback is retained when the page becomes hidden. Browser autoplay, device volume, installed voices, and operating-system audio policy still apply.

Map Voice:

- Enable Map Voice from the application header.
- Use commands such as `zoom in`, `zoom out three levels`, `center map on Hyderabad`, `move map left`, or `reset map`.
- Map Voice is silent and resumes after a command.
- Map Voice never changes the origin, destination, route, GPS state, or navigation confirmations.
- Map commands must remain in Map Voice; normal Nova does not route them through destination processing.

If speech recognition is unavailable, text input remains usable. Hindi speech and playback are experimental and depend on browser/device support.

## Session Workspaces

The workspace system keeps journeys independent:

- **Main journey** is the default planning space.
- **New** creates an independent session for another trip, destination, or planning scenario.
- Switching sessions changes the active origin, destination, route, place results, pending choices, map state, and assistant context together.
- Deleting a session removes its saved trip-planner data without changing other sessions.
- Session metadata and optimizer drafts are retained in browser storage so a refresh does not immediately erase planning work.
- A session cannot silently copy route or destination state into another session.
- Only one voice flow owns the microphone at a time, even when multiple workspaces are open.

This makes sessions useful for comparing journeys, planning work and personal trips separately, or keeping a current route available while exploring a future destination.

## Route Planning And Journey Lifecycle

The route planner separates planning from execution:

1. Select an origin manually or request the device's current location once.
2. Search and select an exact destination result.
3. Calculate a driving route and inspect its geometry, distance, and static duration.
4. Start the journey preview only after a route exists and a current location is available.
5. Pause, resume, end, or recalculate the journey when tracking is active.

During an active or paused journey, the application can show location progress, movement state, arrival detection, and repeated off-route readings. Location tracking is opt-in and browser-controlled; it is not a background navigation service. Failed or stale route requests preserve the last valid route.

## Parallel Assistant

The Parallel Assistant is deliberately separate from Nova's destination-changing conversation. It is designed for quick context questions while preserving the active journey:

- `How long will it take?`
- `How far is the destination?`
- `Is there traffic?`
- `How much longer?`

It reads the current route snapshot, reports static route facts, explains when live traffic is unavailable, and never changes the origin, destination, route, place results, or pending navigation choices. A request can be cancelled while it is checking the current route context.

This separation prevents a question about a journey from accidentally becoming a new navigation instruction.

## Multi-Stop Trip Optimizer

The Multi-Stop Trip Optimizer is an independent planning workspace:

- Add between two and twelve distinct locations.
- Choose stops in any order; the optimizer evaluates the road-network durations.
- Recommend a starting point and visiting order based on the available route matrix.
- Generate one route through the ordered stops.
- Show total distance, estimated duration, ordered stops, and the recommended start.
- Display the optimized route and stop markers on a dedicated map.
- Save the draft and latest result per workspace in browser storage.
- Clear optimizer data without deleting the surrounding journey workspace.

The optimizer uses static driving estimates. It does not account for live traffic, road closures, driver preferences, time windows, vehicle constraints, or business opening hours. It does not mutate the main journey's origin, destination, route, or navigation state.

## Places, Alternatives, And Service Status

The platform includes a place-discovery layer for practical stops during planning:

- Fuel and petrol stations.
- Restaurants and cafes.
- Hospitals and pharmacies.
- ATMs and parking.
- Electric-vehicle charging locations.

Searches can be **Nearby** or **Along route**. Results can be selected, inspected, used as a destination proposal, or compared as driving detours. Place details show available map metadata such as address, website, and opening-hours text; missing data is reported rather than invented.

The service-status panel reflects recent request outcomes. It distinguishes not-yet-checked services, successful requests, and temporary outages. A failed place search keeps previous valid results where possible and provides a retry path instead of presenting an empty result as proof that no places exist.

Alternative routes are read-only previews. They can be inspected and compared without automatically replacing the current route.

## Destination Safety

Navigation state is controlled locally by `NavigationController` and `ConversationEngine`.

- The model returns structured intent, never executable navigation actions.
- Search results are resolved locally and validated before use.
- A destination request creates a pending proposal when confirmation is required.
- Multiple matches become numbered choices, limited to five destination candidates.
- Confirmation and choices are tied to the current route revision.
- Invalid, ambiguous, negated, stale, or out-of-range requests leave the active journey unchanged.
- Informational questions, place searches, distance checks, travel-time checks, and route alternatives do not mutate the destination.
- Map viewport commands are isolated from navigation state.

This boundary is intentional: the model can understand varied language, while local code remains responsible for real-world actions.

## Services

| Service | Purpose |
| --- | --- |
| Nominatim | Address and place geocoding |
| OSRM | Driving routes, distance, duration, and alternatives |
| Overpass | Nearby and along-route OpenStreetMap place search |
| Gemini | Optional server-side intent classification |
| Meta Model API | Optional first-party Meta intent classification, including configurable Muse models |
| Baseten Muse Spark Open | Optional alternate intent classification |

These are public or third-party services with rate limits and no guaranteed uptime. The application uses bounded requests, caching, validation, and error handling, but it does not provide production-scale global rate limiting across serverless instances.

## Feature Boundaries

Implemented:

- Origin and destination search.
- One-time current-location lookup.
- Driving route preview.
- Static ETA and route distance.
- Distance and travel-time questions between named places.
- Natural-language place lookup and destination requests.
- Nearby and along-route categories: fuel, restaurants, hospitals, pharmacies, ATMs, parking, cafes, and charging stations.
- Place details and driving detour comparisons.
- Read-only alternative route previews.
- Multi-stop route optimization.
- English text and browser voice workflows.
- Optional Meta, Gemini, and Baseten Muse classification with local fallback.

Not implemented:

- Live traffic or congestion-aware ETA.
- Turn-by-turn guidance.
- Continuous background GPS navigation.
- Walking or transit routing.
- Verified live opening hours, ratings, or business availability.
- Saved home/work addresses, accounts, or offline maps.
- Automatic support for every language or unrestricted general knowledge.

Clarification is a safety behavior when a request is ambiguous, unsupported, contradictory, or missing information.

## VoiceNav AI Compared With Google Maps

VoiceNav is not trying to reproduce every part of Google Maps today. Google Maps is a mature navigation product with global map coverage, deep place data, live traffic, turn-by-turn guidance, transit and walking modes, business information, and years of production-scale optimization. VoiceNav currently focuses on a smaller but more controllable experience: conversational planning, explainable intent handling, independent workspaces, and local protection around route changes.

| Area | VoiceNav AI today | Google Maps today |
| --- | --- | --- |
| Primary experience | Conversational route planning and journey workspaces | Full consumer mapping and navigation product |
| Natural language | Intent classification for navigation, place, distance, time, and route questions | Broad voice and search understanding integrated with a mature map ecosystem |
| Route changes | Explicit destination proposals, confirmation, revision checks, and safe commits | Fast direct navigation workflow with mature rerouting |
| Live traffic | Not available; durations are static estimates | Mature traffic and congestion data in supported regions |
| Guidance | Route preview only; no turn-by-turn voice guidance | Turn-by-turn navigation and rerouting |
| Workspaces | Independent sessions for parallel trip planning | Saved places, lists, and account-centered history rather than this session model |
| Parallel questions | Dedicated assistant that answers without changing the route | Questions are integrated into the broader Maps navigation experience |
| Multi-stop planning | Two to twelve stops with an explicit optimization result | Mature multi-destination planning with broader map and traffic context |
| Place discovery | Open map data with bounded categories and transparent missing fields | Large commercial place database, reviews, hours, photos, and richer business context |
| Control and transparency | Local execution boundary, visible safety rules, and open service composition | Powerful integrated platform with less application-level control for this specific workflow |

The comparison is a product-positioning decision, not a claim that one system is universally better. VoiceNav's distinctive value is the combination of natural conversation, inspectable intermediate results, separate planning contexts, and a conservative state-change boundary.

## Future Enhancement Roadmap

The current public-data foundation is intentionally modular. With stronger commercial map capabilities, including Google Maps Platform services where licensing and product requirements permit, VoiceNav could be enhanced in stages:

1. **Richer route intelligence** - live traffic-aware duration, congestion-aware rerouting, road closures, incidents, tolls, restrictions, and arrival-time confidence.
2. **Navigation-grade guidance** - turn-by-turn voice instructions, lane guidance, departure timing, background navigation, and reliable arrival detection.
3. **Richer places** - place IDs, opening status, reviews, photos, phone numbers, accessibility attributes, price information, and verified business details.
4. **Smarter multi-stop planning** - traffic-aware stop ordering, time windows, vehicle constraints, charging requirements, fuel planning, and return-to-origin trips.
5. **Broader mobility** - walking, cycling, public transit, ride options, and mixed-mode journeys.
6. **More capable conversational planning** - user preferences such as avoid tolls, prefer highways, minimize stops, arrive by a deadline, or choose accessible locations, all validated locally before execution.
7. **Production scale** - stronger global rate limits, shared caching, observability, authentication, privacy controls, and region-aware service policies.

These enhancements would improve the data and execution layer without removing VoiceNav's core design principle: AI may interpret the request, but trusted local application code decides what state can change.

## Validation

Run the focused checks:

```powershell
npm run test:unit
npm run test:server
npm run typecheck
npm run lint
```

Run the complete test command:

```powershell
npm test
```

See [TESTING.md](TESTING.md) for individual suites, coverage, service mocks, UI checks, and manual browser/device acceptance checks.

## Project Structure

```text
src/app/                  App Router pages and server routes
src/ai/                   AI provider contract, intent validation, and local fallback
src/components/           Dashboard, map, panels, and voice UI
src/conversation/         Context and conversation execution
src/navigation/           Navigation state and map command safety
src/services/              Geocoding, routing, places, voice, and server adapters
src/types/                Domain types and Zod schemas
tests/                    Unit, server, UI, safety, and service tests
```

Important boundaries:

- `src/services/ai/baseten.ts` is server-only and owns external model calls.
- `src/ai/IntentProcessor.ts` validates model output and applies local safety rules.
- `src/conversation/ConversationEngine.ts` executes intents and owns conversation actions.
- `src/navigation/NavigationController.ts` is the authoritative navigation-state owner.
- `src/components/VoiceAssistant/VoiceAssistant.tsx` manages speech, playback, interruption, and microphone lifecycle.
- `src/components/MapView/MapView.tsx` applies isolated Leaflet map commands.

## Privacy And Responsible Use

Search text and coordinates required for geocoding, routing, and places are sent to the configured public services. Optional AI providers receive normalized intent-classification context, not route geometry or coordinates. The application does not store microphone audio, but browser speech recognition may send audio to the browser vendor's recognition service.

Use the application while safely stopped. It is not a certified driving assistant. Review public-service policies before high-volume or public deployment, and provide appropriate attribution and contact information for any hosted instance.

OpenStreetMap data and tiles require attribution. The application displays the required OpenStreetMap attribution in the map.
