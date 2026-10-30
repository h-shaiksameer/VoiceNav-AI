# VoiceNav AI

A voice-first navigation dashboard built with Next.js App Router, TypeScript, React, Tailwind CSS, Leaflet, and OpenStreetMap services.

## No Model Accounts Or Keys Required

The application uses a **local, deterministic English, Hindi and Hinglish intent algorithm** by default, including common Deccani Hindi wording. It runs in the browser, needs no AI provider, and does not send conversation text to a model. There is no Meta integration, no required model account, and no model credential configuration. The generic adapter interface remains replaceable, but no external model is configured or called. If a future optional adapter fails or returns invalid data, the intent processor falls back to the local algorithm.

This is a working task-specific language processor, not a general-purpose language model. It understands supported navigation requests, common synonyms, polite commands, numbered results, and selected-place references. Unknown, contradictory, or ambiguous wording triggers clarification instead of guessing. It does not claim unrestricted natural-language understanding or fulfillment of any live-model hackathon requirement.

**Map tiles, geocoding, routes, and places still need internet access.** Browser speech recognition may also need the browser vendor's network service. Text input remains available without a microphone.

## Setup

Use Node.js 22 LTS or later and npm. From this workspace in PowerShell, run:

```powershell
npm install
npm run dev
```

Open http://localhost:3000 (or the alternate port printed by Next.js). No environment file is required for the default public services. Optionally copy the provided non-secret settings:

```powershell
Copy-Item .env.example .env.local
```

The environment file is ignored by Git. Never add secrets to browser-prefixed variables or source files. Installing dependencies generates the lockfile; retain it for repeatable installs.

Validation commands, to run after installing:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Production preview:

```powershell
npm run start
```

See [TESTING.md](TESTING.md) for running individual suites, enforced coverage gates, generated reports and manual device checks. The latest automated run passed all 296 tests, repository-wide lint, type checking and the production build. Critical-module coverage is 99.12% lines/statements, 96.75% functions and 90.06% branches. Coverage is aggregate across the configured core modules, not the entire UI or proof of live audio quality. No commits were made as part of this update.

## Feature And Service Status

| Capability | Current status |
| --- | --- |
| Address search and one-time current GPS location | Implemented; Nominatim/network and browser permissions apply |
| Driving route, distance, static ETA and map geometry | Implemented through OSRM; no live traffic |
| Nearby and along-route places | Implemented through Overpass; provider outages are shown as temporarily unavailable |
| Petrol, restaurants, hospitals, pharmacies, ATMs, parking, cafes, EV charging | Implemented categories sharing the same Overpass service |
| Place details and comparisons | OSM metadata, straight-line distances, and real driving detours for up to three returned places |
| Other driving routes | Read-only OSRM previews when returned; no switching |
| English, Hindi, Hinglish and common Deccani requests | Local bounded intent grammar; no external model account or API key |
| Text, voice, playback/replay and continuous opt-in listening | Implemented; recognition/voices depend on the browser and device |
| Destination safety and confirmation | Runtime schemas, original-source intent, allowed result IDs, revisions and atomic route commits |

The sidebar's **Service status** shows Address search, Driving routes and Places as **Not checked yet**, **Last request succeeded**, or **Temporarily unavailable**. This reflects actual request outcomes, not proactive health monitoring or guaranteed uptime. Network failures, invalid provider responses, HTTP 429 and server errors update availability for both voice and button requests. Input/policy errors such as a too-long corridor search do not declare a provider outage.

If Overpass returns HTTP 502, the Places panel explicitly says **Places temporarily unavailable**, disables its category/scope controls, retains and labels previous results, and provides **Retry place service**. A successful retry restores the controls. An outage does not mean restaurants or another category are permanently unsupported.

### Future Enhancements

These are not implemented and are listed separately in the UI:

- Live traffic, congestion-aware ETA and verified road closures.
- Live turn-by-turn guidance and continuous GPS tracking.
- Business ratings and verified live opening hours.
- Saved home/work, accounts and offline maps.
- Walking/transit routing and switching alternative routes.

## Using The MVP

1. Select **My location**, or enter an origin and explicitly submit its address search using the search icon or Enter.
2. Select an exact origin result. Do the same for the destination, then select **Search Route**.
3. Inspect the actual OSRM driving distance, duration, and route geometry on the map.
4. Choose a place category and **Nearby** or **Along route**, then submit the search. Nearby searches use the active route origin, or the manually selected origin when there is no route.
5. Select a result to inspect it. The comparison action calculates driving detours for up to the first three results when a route exists. Without a route, conversational comparison reports only the available straight-line distances.
6. Type a request, or start the microphone while safely stopped. End the spoken request with **Send** or **Submit** (Hindi: **सेंड** or **सबमिट**), for example **Hitech City Submit**. The terminal control must be finalized, not an interim guess. Legacy **Navigator Send**, **Nova Submit** and bounded Hindi/no-va variants also work. Controls are removed before processing; repeated controls do not submit twice. Silence, timeouts, an empty request, or bare no/or/va never submit. The Send button/Enter can also submit a draft. Final **Discard** / **डिस्कार्ड** clears only the unsent draft, not the active destination or an already submitted request. Stop retains the draft. In manual mode, Cancel restores the pre-recording draft. Manual recordings stop at 90 seconds; pending-choice follow-ups stop at 15 seconds. Neither limit submits a request or expires address choices.
7. Give an explicit navigation request. If several addresses are returned, click an option or say **option two, Submit** / **विकल्प दो सबमिट**. Selecting a valid option confirms that requested navigation change and calculates the route immediately, without a second confirmation prompt. Option buttons remain usable while the list is spoken and stop playback before routing. Single-result proposals still accept **confirm route, Submit**, **confirm destination, Submit**, **yes, Submit**, or **cancel, Submit**. The microphone may reopen for a bounded 15-second follow-up; this recording limit does not expire the request. Choices and proposals have no time-based expiry, including beyond five minutes. Informational questions preserve them. Cancellation, clearing the navigation session, successful routing, or an explicit replacement navigation/place-search request can invalidate them. Normal microphone startup waits 400 ms after playback; Stop/hide/collapse cancel capture, not the retained address request. Spoken replies have replay/stop controls.
8. Enable **Allow interruptions** to start listening immediately, including between replies and during request processing. Speak normally to stop playback; no wake phrase is required. Final **Send/Submit** submits the turn and resets its draft while the same listener stays active. Final **Discard** clears the draft and keeps listening. Explicit submitted turns wait in order during another request. Native recognizer endings are restarted; continuous mode has no 90-second turn limit. The microphone and playback Stop buttons end the current action and rearm listening without unchecking the checkbox. Uncheck it to stop automatic listening. Hidden tabs, collapse, unmount and capture errors end automatic capture; returning does not silently re-enable it.

Interruption checklist: grant microphone permission and wait for **Listening** or **Speaking · Interruptible**, rather than **Starting microphone**. Recognized speech stops playback; only a finalized submission control sends the request. An option number alone does not submit a voice turn. Questions, negation and ambiguity retain all navigation guards. Clicking a destination option remains available during speech. Disabling continuous listening during playback stops capture without restarting or cancelling that reply.

The preferred interruption path requests a microphone-only stream with echo cancellation, noise suppression, gain control and mono input, then passes that track to recognition. It tries stronger all-system echo cancellation only when the device advertises support; ordinary reported `true` remains supported. No screen, loopback or system-audio capture is requested. Playback waits for recognition readiness when needed. Outgoing speech/replay suppresses submission and Discard controls. Playback-matching result segments are filtered, and option-prefix salvage requires an exact known playback prefix. These are secondary transcript guards, not speaker identification. Stops release owned tracks, including streams arriving after cancellation.

If processed-track input fails, lacks reported echo cancellation, fails the 2.5-second readiness deadline, or produces no raw result event within six seconds, the app retries once using the browser's ordinary microphone recognition. A visible compatibility warning explains weaker echo isolation and recommends headphones. Ordinary silence can trigger the six-second heuristic; it is not proof of a defective track. Explicit denied capture permission is not bypassed. Native fallback failure stops automatic listening visibly. Echo cancellation and text filters cannot guarantee that Nova's own output or another speaker will never be recognized. Real Edge/device/speaker tests are still required; automated mocks do not prove acoustic isolation.

Route inputs are draft selections until Search Route succeeds. Editing them or receiving a service error does not replace the active route. A new successful route clears stale place results and confirmations.

While destination address choices are pending, consecutive explicit choices in one request use the last choice: **option one option one option two, Submit** selects option two. Repeating the same choice also works; English/Hindi words and digits are supported. The last choice is resolved before the 500-character display limit, including on voice submission. It must be in range: **option one option 99** does not fall back to option one. Questions, negation, unfinished choices and alternatives such as **option one or option two** remain non-selecting. This rule does not relax ambiguous multi-destination navigation commands or change a route without a pending explicit navigation request.

## Supported Language

Destination matches are restricted to the starting location's country, sorted nearest-first by straight-line distance and limited to **five** eligible addresses before numbering. Fewer may be returned by the provider. The reference is the newly requested origin, active origin or selected/GPS origin. Nominatim supplies structured country metadata; a GPS origin without it uses a cached reverse lookup. Unknown origin country and no eligible domestic matches produce an error, never a global fallback. Manual menus also show up to five results; destination search requires an origin. Full addresses remain visible and stored. **Address-choice audio and replay say only "Say the option."** Other replies shorten known names/addresses to five words for speech. One destination match needs confirmation; selecting a valid pending address choice confirms the original explicit request and routes without a second prompt.

For all examples below, append **Send**, **Submit**, **सेंड**, or **सबमिट** when speaking. Typed requests do not need a control word, but the engine strips one if included before classification, geocoding, confirmation and storage. **Hitech City Submit** therefore looks up **Hitech City**. With Allow interruptions enabled, speak directly during playback without a wake phrase. Controls require active recording. Final Send/Submit is reserved in conversation; use address-search fields for a literal name ending in a control word. Recognition can still make mistakes.

**Hitech City**, **Target HITECH City**, **Target location HITECH City**, and **Destination HITECH City** can all resolve a destination through the same bounded navigation grammar. A bare name never silently commits a single-result route: confirmation or a valid pending-address selection is still required. Questions, negations, saved home/work, generic categories, empty labels and ambiguous alternatives remain non-mutating. Street names such as **2nd Avenue** are not automatically treated as option numbers.

Voice cleanup normalizes whitespace/control characters, removes explicit `[noise]`, `[background noise]`, `[music]`, `[silence]` tags, and trims sentence-leading hesitation sounds such as um/uh/erm/hmm. It preserves destination spelling/case, numbers, repeated place-name words, questions, negation, and uncertain annotations such as `[inaudible]`. It does not discard unknown sentences, choose between conflicting destinations, or guess words the recognizer never captured. Informational/ambiguous requests retain the existing navigation guards, and route changes still require confirmation. Outgoing speech suppresses the bare Send control as well as longer control phrases to reduce feedback risk; browser audio limitations still apply.

Select **हिन्दी / Deccani** in the assistant's Language menu before starting the microphone. This explicitly requests Hindi recognition (`hi-IN`), including for hands-free address-choice and confirmation follow-ups. English requests use `en-IN`. Typed Devanagari and common Romanized Hindi/Deccani phrases are understood locally; detected Hindi also switches subsequent replies and recognition to Hindi. This is not automatic multilingual audio detection or a separately trained Deccani recognizer.

Common Hindi examples:

| Request | Behaviour |
| --- | --- |
| मेरेको पास में पेट्रोल पंप दिखाओ / Mereko paas mein petrol pump dikhao | Search nearby; preserve destination |
| रास्ते में रेस्टोरेंट दिखाओ | Search along the active route |
| कितना टाइम लगेगा / Kitna waqt lagega | Read the estimated route time |
| दूरी कितनी है | Read the active route distance |
| दूसरा रास्ता दिखाओ / Aur raste dikhao | Preview other routes without switching |
| मेरेको चारमीनार लेके चलो / Mereku Charminar leke chalo | Resolve destination and request confirmation |
| अभी की लोकेशन से चारमीनार तक रास्ता दिखाओ | Request current GPS location and propose the route |
| विकल्प दो / Option do / दूसरे वाले | Select and confirm a pending address choice without a second prompt |
| हाँ, कन्फर्म करो / Hau / Theek hai | Confirm only a pending explicit request from the current route revision |
| नक्को / Nakko / Nahi | Cancel a pending proposal, without clearing the active route |
| मुझे चारमीनार मत ले जाओ | Do not navigate or change the destination |
| नेविगेशन बंद करो / Route band karo | Explicitly clear the route preview |

Core responses, choices and confirmations are available in Hindi. Real place names and addresses are retained for geocoding; they are not arbitrarily translated. Some service errors, address data and interface controls remain English. Deccani support is a bounded set of common expressions such as `mereko`, `mereku`, `kidhar`, `hau` and `nakko`, not unrestricted dialect understanding. Recognition of accents, code-switching and place names depends on the browser speech service; uncertain wording asks for clarification.

English examples:

| Request | Behaviour |
| --- | --- |
| Find petrol stations nearby | Search places; preserve destination |
| Could you show me gas stations near me? | Search fuel; preserve destination |
| Are there restaurants along my route? | Search the route corridor; preserve destination |
| What about along the route? | Reuse the most recent search category when unambiguous |
| How much longer will it take to reach home? | Read the active route estimate; do not infer a home address |
| How far is my destination? | Read the active route distance |
| Is there traffic? | Explain that live traffic is unavailable |
| Check other routes / Are there alternative routes? | Request actual OSRM alternatives; preview them without replacing the active route |
| Can you check are there any? | Ask what kind of place to check for instead of guessing |
| Target Charminar / Target location Charminar / Target location as Charminar / Destination Charminar | Resolve the destination and request confirmation; use the selected starting location or request current GPS origin if none is set |
| Select starting location, location as current location and target location as Charminar | Resolve current GPS origin and geocode the destination, then request spoken confirmation |
| Plan a route from current location to Charminar | Plan the same journey; no manually selected origin is required |
| Option two | Select and confirm a pending address choice, calculating the route without another prompt |
| Confirm route / Confirm destination / Yes | Approve only a pending explicit navigation request from the current route revision |
| Compare the options / Which one is fastest? | Calculate available driving detours; preserve destination |
| Tell me about the second one | Show details for the latest search result number 2 |
| Could you please take me to the second restaurant? | Resolve result 2; request confirmation |
| Navigate to result two / the 2nd restaurant | Resolve a numbered result; request confirmation |
| Take me there | Use the selected result or a single unambiguous recent result; otherwise clarify |
| Take me to the nearest petrol station | Search fuel; propose the closest returned result by straight-line distance; request confirmation |
| Change my destination to a specific address | Geocode; propose only a single unambiguous address match |
| Stop navigation / Clear my route | Clear the route preview |

Negated instructions, multiple result references, conditional instructions, unknown result numbers, mismatched categories, and ambiguous pronouns cannot initiate a destination change. Saved home/work addresses are not implemented. A place name containing a street ordinal, such as `2nd Avenue`, is not automatically a numbered search result.

## Architecture

```text
src/app/                  App Router pages, styles, and server API routes
src/components/           Dashboard, map, address fields, route/place panels, voice UI
src/components/useNavigationApp.ts
                          UI orchestration; no direct destination mutation
src/components/navigationRuntime.ts
                          Runtime construction and selected-origin reference ownership
src/components/ServiceStatus.tsx
                          Read-only availability and future-capability presentation
src/services/client.ts    Typed client API calls and response validation
src/services/availability.ts
                          Shared last-request availability state for UI and voice
src/services/geocoding/   Nominatim adapter
src/services/routing/     OSRM adapter
src/services/places/      Overpass adapter and Turf corridor filtering
src/services/server/      Caching, service limits, bounded JSON, errors, timeouts
src/services/voice/       Browser recognition and synthesis wrappers
src/ai/                   Local language algorithm, adapter contract, intent validation
src/conversation/         Context, reference resolution, response/action orchestration
src/conversation/ConversationServices.ts
                          Injectable service contract and default HTTP/GPS adapters
src/navigation/           Sole navigation-state owner and command safety guards
src/types/                Domain types and Zod runtime schemas
tests/safety.test.ts      Language, navigation, conversation, schema and voice fixtures
tests/services.test.ts    Client failure classification and availability/recovery
tests/server/            API security, cache/queue limits and public-service adapters
tests/ui.test.ts          Runtime identity, reference selection, route preservation and UI
```

### Design Boundaries

- The runtime factory constructs one controller/engine pair and owns the mutable selected-origin reference. The React hook handles UI state and events without reading refs during runtime construction.
- `ConversationEngine` accepts a `ConversationServices` implementation as an optional third constructor argument. Existing two-argument callers retain the same HTTP and geolocation defaults. Tests can substitute services without patching global fetch. This does not bypass the controller's mutation guards.
- The conversation context module owns the immutable pending-navigation reset. Callers still decide when to reset; cancellation, search replacement and session-change timing are unchanged.
- `ServiceStatus` renders a supplied snapshot without fetching or mutating state. The dashboard composes panels; the availability store still observes real client requests.
- Voice handler registration follows handler declarations, and ordinary browser-capture helpers are not named as React hooks. Capture timing, cleanup, submission and interruption rules are unchanged.

### Destination Safety

- The intent processor returns validated structured data, never executable code.
- Navigation target text and references are derived from the original user request, not trusted from adapter-generated fields.
- Searching, reading details, comparing results, and route questions have no destination mutation path.
- The `NavigationController` alone owns the active session. It validates action shape, coordinates, allowed IDs, explicit wording, confirmation, and route revision.
- Asynchronous routes commit atomically only on success. Superseded requests cannot overwrite newer navigation, and clearing a route invalidates pending routing.
- Search results and pending confirmations are invalidated when the active route changes, not by elapsed time. Ambiguous or missing results ask for clarification.
- Confirmation may be a button, matching affirmative, or explicit selection from the pending address list. Address selection confirms the original explicit navigation request without another prompt. Choices/proposals do not expire on a timer; microphone timeouts do not clear them. Informational questions preserve them. Cancellation, session clearing, successful routing, explicit replacement navigation/place searches, and route revision changes invalidate them. A standalone affirmative without a pending request cannot create a route.

### Server APIs

All endpoints accept same-origin JSON POST requests and validate their inputs and upstream responses.

| Endpoint | Body | Service |
| --- | --- | --- |
| `/api/geocode` | `{ "query": "specific address", "reference": { "lat": 0, "lon": 0 }, "countryCode": "in" }` | Nominatim country-scoped search; reference/countryCode optional for initial origin searches, missing country resolved from reference coordinates |
| `/api/route` | `{ "waypoints": [{ "lat": 0, "lon": 0 }, ...] }` | OSRM driving route; 2 or 3 points |
| `/api/route` | Same body with `"alternatives": true` and exactly 2 points | Up to 3 OSRM routes, including the primary route where returned |
| `/api/places` | `{ "category": "fuel", "center": { "lat": 0, "lon": 0 }, "scope": "nearby" }` | Overpass |
| `/api/places` | Same body with `"scope": "route"` and GeoJSON `geometry` | Overpass route corridor |

Coordinates above show request shape, not application seed data. No locations, distances, businesses, ratings, or route times are fabricated in the running application.

## Public Service Policies

- **OpenStreetMap tiles:** visible attribution is always supplied by Leaflet. Tiles load only for the current viewport, using Leaflet/browser caching. No offline download or prefetch is implemented. A normal browser referrer is retained. Respect [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
- **Nominatim:** only explicit submitted searches, never keystroke autocomplete. Destination lookup may first reverse-geocode origin coordinates to determine its country; those coordinates are sent to Nominatim. Search and reverse misses share the serialized 1.1-second minimum interval and six-request queue. Country lookups and successful searches are cached for 24 hours; search cache keys include the country, including for empty results. Search results retain structured country metadata. Initial origin searches may be global; destination searches use the origin country. Requests identify the app and instance origin in User-Agent. See [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/).
- **Overpass:** no polling. Identical searches are cached for three minutes; new upstream searches are limited to one every five seconds per process. Query timeout is 20 seconds; partial timeout results are rejected. Nearby radius is 5 km. Corridor searches use sampled route geometry and a 1.5 km radius, then filter against the full geometry with Turf. Routes longer than 150 km are rejected for corridor search to bound public-service load. See [Overpass guidance](https://wiki.openstreetmap.org/wiki/Overpass_API).
- **OSRM:** actual driving routes and GeoJSON geometry, five-minute cache, and upstream requests serialized at least 1.1 seconds apart per process with a bounded queue. Detours route origin -> candidate -> original destination and subtract the original route estimate. No fabricated fallback. Public demo hosting has no availability guarantee; see [OSRM](https://project-osrm.org/).
- Upstream HTTP errors, rate limits, timeouts, empty results, and malformed data are surfaced to the user. Cached data may be stale within its stated TTL.

These are free community services, not unrestricted production infrastructure. Caches, in-flight deduplication, and rate limits are **in memory and per process**, not coordinated across serverless instances or replicas. Before public/multi-instance deployment, add shared persistent caching, global rate limiting, appropriate public instance/contact identification, access controls, and a deployment that satisfies each service's current usage policies. Service URLs are configurable without changing UI code. Do not deploy high-volume traffic against the defaults.

## Limitations And Privacy

- This is a driving **route preview**, not live turn-by-turn navigation. There is no simulated movement, continuous GPS tracking, live remaining-time calculation, or live traffic.
- Current location is a one-time permission-gated fix, not a location watch. Route and conversation state are in memory and disappear on reload.
- Upstream map/location services receive the search queries or coordinates required for their operation. Avoid sending sensitive addresses to public services.
- Speech recognition is browser-dependent and generally needs HTTPS or localhost. Audio may reach the browser's recognition provider; offline/on-device processing is not guaranteed. The app stores no audio. Manual recording is bounded and normally off during processing/playback, with a possible 15-second pending-choice follow-up. Opt-in continuous listening stays active while the visible, expanded panel is enabled, including processing and replies. Stop does not uncheck that setting. Opt-out, hidden tab, collapse, unmount and errors terminate automatic capture. Echo suppression and compatibility fallback cannot guarantee speaker separation. Do not use the assistant to operate a device while driving.
- Initial microphone and geolocation permissions are browser-controlled and may require screen interaction. Grant them while safely stopped. Background-tab restrictions and browser speech/audio policies can interrupt hands-free operation. This route-preview MVP is not a certified driving assistant or live turn-by-turn navigation system.
- Text-only operation does not require microphone permission. Speech synthesis selects a matching English or Hindi voice, full volume, a slower rate, and bounded chunks to avoid long-utterance truncation. Hindi replies request `hi-IN`; if the available voice list has no Hindi voice, the assistant shows an installation/settings message instead of using an English voice for Hindi text. Enable a Hindi speech voice in your device/browser speech settings when needed. Actual audio quality, speaker volume, voice availability, and autoplay permission depend on the browser and device. Replay is a direct user action when automatic playback is blocked.
- Place coverage is incomplete. Searches inspect at most 150 Overpass elements and display up to 12 results sorted by straight-line/corridor distance. "Nearest" means the closest returned result, not a guarantee of the nearest business in existence or by driving time.
- Along-route sampling can miss places on curved route segments. Corridor proximity is not a drivable detour; only a successful OSRM comparison supplies detour data.
- Opening hours are raw OpenStreetMap data, not verified live. Ratings are unavailable. Missing details show **Not available**.
- OSRM may snap locations to its road network. Alternative routes are read-only previews and are not guaranteed to be returned. No walking, transit, alternative-route switching, saved addresses, or account system is included.
- Local understanding targets supported English, Hindi and Hinglish navigation vocabulary with common Deccani phrases, not arbitrary languages, general knowledge, or every possible phrasing. Clarification is a safety feature, not a model response.
- Automated validation uses deterministic mocked external services and browser audio. Live provider uptime, browser microphone permissions, recognition accuracy and speaker feedback still require device verification. See [TESTING.md](TESTING.md).

## Manual Acceptance Checks

1. At desktop and mobile widths, calculate a real route using exact address selections; check marker placement, route fitting, visible attribution, and readable non-overlapping panels.
2. Deny geolocation and microphone permissions; verify manual address and text input still work. Try a browser without speech recognition.
3. Search nearby and along-route places. Select a result, inspect missing fields, and compare detours. The original destination must remain unchanged.
4. Ask route questions and hypothetical/negative navigation questions. Check that the active destination does not change.
5. Request a numbered destination change. Verify it stays unchanged until confirmation, then updates only after successful routing.
6. Try an ambiguous address, multiple result numbers, an invalid number, or a stale confirmation after a new route. No guessed destination should be committed.
7. Go offline or block a service in developer tools. Check useful errors, retained routes, and no fabricated results.
8. Say **Destination HITECH City. Submit.** and repeat with **Send**; verify one submission with the exact destination and a pending confirmation, not an immediate route change. Repeat with noise tags, hesitation prefixes, punctuation/case changes, Hindi सेंड/सबमिट, repeated controls, legacy phrases, long pauses, interim/partial and middle-word controls, recognizer restarts and retained drafts. Verify no/or/va alone do not send, critical words such as negation and address numbers survive cleanup, and a control without a request never sends an empty message. Check **option one, Submit**, **confirm route, Submit**, Stop/Cancel/hide/collapse, 90/15-second limits and cancellation during the 400 ms startup delay.
9. Select Hindi/Deccani and dictate the Hindi examples above with finalized submission controls. Check Hindi playback with an installed voice and the actionable fallback without one. Browser speech/dialect accuracy requires real-device testing.
10. Ask "Check other routes" with and without an active journey. Verify real read-only previews or honest missing-route/no-alternatives messages, never a destination change.
11. Request a name appearing in multiple countries. Verify up to five eligible domestic matches, full addresses on screen, and only "Say the option." on audio/replay. Wait six minutes and ask an informational question: choices remain usable. Final "option one option one option two Submit" chooses option two once; invalid final choices must not fall back. Cancel/session changes invalidate old choices.
12. Enable interruptions and test on speakers and headphones: immediate visible transcription, multiple submitted turns, Discard, listening between replies and during processing, Stop preserving the checkbox, opt-out, collapse, hidden tab, pending permissions and late-stream cleanup. Exercise the visible native compatibility fallback. Check for Nova-only recognition and unintended submissions. A passing mock test is not evidence that the actual microphone excludes speaker audio.

Detailed executable commands, coverage scope and manual acceptance criteria are in [TESTING.md](TESTING.md).