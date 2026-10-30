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

No commands, installs, builds, tests, or commits were executed during implementation, per the workspace owner's instructions. Editor diagnostics are not a substitute for dependency installation, type checking, or browser verification.

## Using The MVP

1. Select **My location**, or enter an origin and explicitly submit its address search using the search icon or Enter.
2. Select an exact origin result. Do the same for the destination, then select **Search Route**.
3. Inspect the actual OSRM driving distance, duration, and route geometry on the map.
4. Choose a place category and **Nearby** or **Along route**, then submit the search. Nearby searches use the active route origin, or the manually selected origin when there is no route.
5. Select a result to inspect it. The comparison action calculates driving detours for up to the first three results when a route exists. Without a route, conversational comparison reports only the available straight-line distances.
6. Type a request, or start the microphone while safely stopped. End the spoken request with **Send** or **Submit** (Hindi: **सेंड** or **सबमिट**), for example **Destination HITECH City. Submit.** The final complete word, ignoring punctuation and known noise, is the submission control; it must be finalized, not an interim guess. **Navigator Send**, **नेविगेटर सेंड**, **Nova Submit**/**नोवा सबमिट**, and the bounded **no va submit**, **no or va submit**, **नो वा सबमिट** variants still work. Controls are removed before processing; repeated terminal controls do not submit twice. Bare **no**, **or**, or **va** does not send. A control word without a request does not submit an empty message. Silence/timeouts never send. Send/Enter remain optional. Stop retains the draft; reopening the microphone and saying Send or Submit submits it. Cancel restores the pre-recording draft. Hide, collapse and the 90-second limit stop recording without submitting.
7. Give an explicit navigation request. If several addresses are returned, click an option or say **option two, Submit** / **विकल्प दो सबमिट**. Selecting a valid option confirms that requested navigation change and calculates the route immediately, without a second confirmation prompt. Option buttons remain usable while the list is spoken and stop playback before routing. Single-result proposals still accept **confirm route, Submit**, **confirm destination, Submit**, **yes, Submit**, or **cancel, Submit**. The microphone may reopen for a bounded 15-second follow-up; this recording limit does not expire the request. Choices and proposals have no time-based expiry, including beyond five minutes. Informational questions preserve them. Cancellation, clearing the navigation session, successful routing, or an explicit replacement navigation/place-search request can invalidate them. Normal microphone startup waits 400 ms after playback; Stop/hide/collapse cancel capture, not the retained address request. Spoken replies have replay/stop controls.
8. Enable **Allow interruptions** before or during a reply. Speak normally to stop playback; no wake phrase is required. Finish the request with **Send/Submit**, for example **How far is my destination, Submit** or **Option two, Submit** / **विकल्प दो सबमिट**. Recognized interim speech can stop playback, but only finalized submission controls send the request. The browser requests a microphone-only stream with echo cancellation, noise suppression and automatic gain control; that microphone track is passed to speech recognition. No screen, loopback or system-audio stream is requested. When enabled before a reply, playback waits for microphone readiness, showing **Starting microphone** then **Speaking · Interruptible**. Enabling during a reply starts capture without restarting playback; disabling during playback stops capture without stopping the reply. A 2.5-second recognizer-start failure disables automatic interruption, plays any waiting reply and shows manual controls. Stop/hide/collapse/replacement/unmount cancel capture and pending playback.

Interruption checklist: enable at any time, grant microphone permission, and wait for **Speaking · Interruptible** rather than **Starting microphone**. Speak your request directly without saying a name. Speech stops playback; Send/Submit sends the completed request. Saying only an option number does not submit or select a destination. Questions and negated or ambiguous requests keep the normal navigation safety checks. A valid option command joined to a known playback-only prefix can retain just the selection; unrelated/negative prefixes are preserved rather than silently discarded. Clicking an option or the microphone button also stops playback directly. If capture fails, the visible error explains the manual fallback; the toggle can be enabled again at any time.

Automatic interruption needs microphone permission, reported active echo cancellation, and a browser that supports speech recognition from a supplied audio track (`SpeechRecognition.start(audioTrack)`). It keeps recognition active during playback for a bounded 90-second session; audio may reach the browser vendor's speech service. This app does not store audio. Outgoing speech removes submission-control phrases, including on replay. Matching playback fragments are excluded throughout the recording, including after interruption, so a separate echoed fragment cannot be appended to the user's retained request. This is a secondary echo guard, not proof of who spoke. A mixed playback-prefix/selection result is stripped only when its prefix exactly matches a known playback word sequence, not merely similar vocabulary. Once interrupted, the same recorder retains the request across bounded native restarts until Send/Submit. Capture stops on reply completion before an interruption, opt-out during playback, Stop, hide, collapse, unmount, error or timeout; pending permission grants are cancelled logically and late streams are released. Once already listening to an interrupted request, disabling automatic interruption affects future playback rather than discarding that active request.

Echo cancellation reduces speaker feedback; it cannot guarantee that only the user's voice is recognized. Other speakers, recognition mistakes and residual playback can still trigger interruption. Some older browsers ignore an audio-track argument; others reject it. This app cannot reliably detect silent argument ignoring, so a ready recognizer is not proof it consumed the processed track. Missing reported echo cancellation or an explicit capture/recognition error produces a manual fallback rather than silently retrying an unprocessed microphone. Headphones are recommended. Recognition latency and browser/device full-duplex audio restrictions still apply. No external voice provider, API key or new audio dependency is introduced, and live microphone/device verification remains necessary.

Route inputs are draft selections until Search Route succeeds. Editing them or receiving a service error does not replace the active route. A new successful route clears stale place results and confirmations.

While destination address choices are pending, consecutive explicit choices in one request use the last choice: **option one option one option two, Submit** selects option two. Repeating the same choice also works; English/Hindi words and digits are supported. The last choice is resolved before the 500-character display limit, including on voice submission. It must be in range: **option one option 99** does not fall back to option one. Questions, negation, unfinished choices and alternatives such as **option one or option two** remain non-selecting. This rule does not relax ambiguous multi-destination navigation commands or change a route without a pending explicit navigation request.

## Supported Language

Destination matches are restricted to the starting location's country, then sorted nearest-first by straight-line distance and limited to **three** before numbering. The reference is the newly requested route origin, active route origin, or selected starting/current location. Nominatim provides structured country codes; a GPS origin without one uses a cached reverse lookup. Searches use the country filter, and returned foreign/unverified-country matches are excluded. If the origin country cannot be verified or no domestic matches exist, the app reports the problem rather than falling back to global choices. Manual address menus also show at most three results; destination search requires an origin. This ranks returned candidates, not all possible destinations or driving times. Full addresses stay displayed/stored; audio still uses only the first five words per known name/address, including replay. One match uses the existing single-result proposal; multiple-match selection confirms the route without an extra prompt.

For all examples below, append **Send**, **Submit**, **सेंड**, or **सबमिट** when speaking. Typed requests do not need a control word, but the engine strips one if included before classification, geocoding, confirmation and storage. **Destination HITECH City. Submit.** therefore looks up **HITECH City**. Existing longer phrases remain supported. With Allow interruptions enabled, speak the request directly during playback; no wake phrase is required. Controls require an enabled, bounded recording session. Final Send/Submit is reserved in conversation; use the separate address-search fields for a literal name ending in a control word. No control word is guaranteed never to occur naturally or be misrecognized.

**Target HITECH City**, **Target location HITECH City**, and **Destination HITECH City** are explicit destination requests. A bare **HITECH City** is not automatically interpreted as permission to navigate; clarification explains the supported Destination/Target wording. Questions, negations, empty labels and ambiguous alternatives remain non-mutating. Full address text in the conversation is intentional; audio uses the concise labels described above.

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
| Option two | Select an address from a pending ambiguity prompt, without committing the route |
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
src/services/client.ts    Typed client API calls and response validation
src/services/geocoding/   Nominatim adapter
src/services/routing/     OSRM adapter
src/services/places/      Overpass adapter and Turf corridor filtering
src/services/server/      Caching, service limits, bounded JSON, errors, timeouts
src/services/voice/       Browser recognition and synthesis wrappers
src/ai/                   Local language algorithm, adapter contract, intent validation
src/conversation/         Context, reference resolution, response/action orchestration
src/navigation/           Sole navigation-state owner and command safety guards
src/types/                Domain types and Zod runtime schemas
tests/safety.test.ts      Isolated language and navigation regression fixtures
```

### Destination Safety

- The intent processor returns validated structured data, never executable code.
- Navigation target text and references are derived from the original user request, not trusted from adapter-generated fields.
- Searching, reading details, comparing results, and route questions have no destination mutation path.
- The `NavigationController` alone owns the active session. It validates action shape, coordinates, allowed IDs, explicit wording, confirmation, and route revision.
- Asynchronous routes commit atomically only on success. Superseded requests cannot overwrite newer navigation, and clearing a route invalidates pending routing.
- Search results and pending confirmations expire when the active route changes. Ambiguous or missing results ask for clarification.
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
- Speech recognition is browser-dependent and generally needs HTTPS or localhost. Audio may reach the browser's recognition provider; offline/on-device processing is not guaranteed. This app stores no audio. Start recording explicitly while safely stopped. Fragments accumulate; finalized text submits only with a supported terminal send phrase. Silence/timeouts never send. Native restarts stay inside the bounded visible turn; unfinished interim speech remains a draft. Recognition is off during processing and, by default, playback. Opt-in interruptions use an echo-cancelled microphone track without a wake phrase; browser support and echo cancellation do not guarantee speaker separation. Otherwise recognition may reopen for a 15-second address/confirmation follow-up after the playback settling delay. Stop, Cancel, hide, collapse, errors and limits end capture. There is no always-on background listening.
- Initial microphone and geolocation permissions are browser-controlled and may require screen interaction. Grant them while safely stopped. Background-tab restrictions and browser speech/audio policies can interrupt hands-free operation. This route-preview MVP is not a certified driving assistant or live turn-by-turn navigation system.
- Text-only operation does not require microphone permission. Speech synthesis selects a matching English or Hindi voice, full volume, a slower rate, and bounded chunks to avoid long-utterance truncation. Hindi replies request `hi-IN`; if the available voice list has no Hindi voice, the assistant shows an installation/settings message instead of using an English voice for Hindi text. Enable a Hindi speech voice in your device/browser speech settings when needed. Actual audio quality, speaker volume, voice availability, and autoplay permission depend on the browser and device. Replay is a direct user action when automatic playback is blocked.
- Place coverage is incomplete. Searches inspect at most 150 Overpass elements and display up to 12 results sorted by straight-line/corridor distance. "Nearest" means the closest returned result, not a guarantee of the nearest business in existence or by driving time.
- Along-route sampling can miss places on curved route segments. Corridor proximity is not a drivable detour; only a successful OSRM comparison supplies detour data.
- Opening hours are raw OpenStreetMap data, not verified live. Ratings are unavailable. Missing details show **Not available**.
- OSRM may snap locations to its road network. Alternative routes are read-only previews and are not guaranteed to be returned. No walking, transit, alternative-route switching, saved addresses, or account system is included.
- Local understanding targets supported English, Hindi and Hinglish navigation vocabulary with common Deccani phrases, not arbitrary languages, general knowledge, or every possible phrasing. Clarification is a safety feature, not a model response.
- Dependency installation, executable validation, browser rendering, microphone permissions, and live service behaviour still need verification on your machine.

## Manual Acceptance Checks

1. At desktop and mobile widths, calculate a real route using exact address selections; check marker placement, route fitting, visible attribution, and readable non-overlapping panels.
2. Deny geolocation and microphone permissions; verify manual address and text input still work. Try a browser without speech recognition.
3. Search nearby and along-route places. Select a result, inspect missing fields, and compare detours. The original destination must remain unchanged.
4. Ask route questions and hypothetical/negative navigation questions. Check that the active destination does not change.
5. Request a numbered destination change. Verify it stays unchanged until confirmation, then updates only after successful routing.
6. Try an ambiguous address, multiple result numbers, an invalid number, or a stale confirmation after a new route. No guessed destination should be committed.
7. Go offline or block a service in developer tools. Check useful errors, retained routes, and no fabricated results.
8. Say **Destination HITECH City. Submit.** and repeat with **Send**; verify one submission with the exact destination and a pending confirmation, not an immediate route change. Repeat with noise tags, hesitation prefixes, punctuation/case changes, Hindi सेंड/सबमिट, repeated controls, legacy phrases, long pauses, interim/partial and middle-word controls, recognizer restarts and retained drafts. Verify no/or/va alone do not send, critical words such as negation and address numbers survive cleanup, and a control without a request never sends an empty message. Check **option one, Submit**, **confirm route, Submit**, Stop/Cancel/hide/collapse, 90/15-second limits and cancellation during the 400 ms startup delay.
9. Select Hindi/Deccani and dictate the Hindi examples above, ending each utterance with **नोवा सबमिट**. Verify `hi-IN` recognition, Hindi playback with an installed voice, spoken `विकल्प दो नोवा सबमिट`, `हाँ नोवा सबमिट`/`Hau Nova Submit` and `नक्को नोवा सबमिट`, and that negated or informational requests preserve the active destination. Repeat with no Hindi voice installed and verify the actionable text fallback. Browser speech and dialect accuracy require manual device testing.
9. Ask "Check other routes" with and without an active journey. Verify an actionable response without a journey, real alternative previews when returned, an honest no-alternatives message otherwise, and no change to the active route or destination.
10. Request a name appearing in multiple countries. Verify only the nearest three returned in-country matches, using the explicit new origin, active origin or selected/GPS origin, with matching speech/display/selection numbers. Repeat for GPS without country metadata, an unresolvable country and no domestic matches; no global fallback or foreign single-result proposal is allowed. Check manual address menus too. Wait six minutes and ask questions: choices remain usable. Click during readout or say **Option two, Submit**; routing completes once without another confirmation. Cancel/clear/change the route to invalidate old choices.
11. Enable interruptions and test English/Hindi replies on speakers/headphones. Speak normally during playback, including **How far is my destination, Submit**, **Please stop talking**, **Option two, Submit** or **विकल्प दो सबमिट**, without a wake phrase. Playback should stop on recognized non-echo speech; an unfinished request must not submit. Toggle on halfway through a reply and off while it is still speaking: capture should start/stop without restarting or cancelling the reply. Disable while permission is pending and verify a late grant leaves no recording active; enable again during another reply. Check microphone-track echo-cancellation settings and browser support for recognition from that track. Repeat with speaker playback only: it must not submit or select. Questions, negation and out-of-range options must not select a destination. Test split commands/native restarts, clickable options, manual mic, denied permission, missing echo cancellation, startup timeout and lifecycle cleanup. Audio behavior still requires device testing; editor diagnostics do not validate it.