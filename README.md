# VoiceNav AI

VoiceNav AI is a voice-first driving route preview application built with Next.js App Router, TypeScript, React, Leaflet, and OpenStreetMap services. It combines natural-language intent classification with local, deterministic execution for geocoding, routes, places, confirmations, and navigation state.

It is a route-preview MVP, not live turn-by-turn navigation.

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

1. The primary optional model provider is selected when configured.
2. The alternate model provider is used when the primary provider is unavailable.
3. The deterministic local English/Hindi/Hinglish processor handles the request when optional providers fail or are not configured.

The server validates model JSON with Zod. The local processor applies additional rules for destination wording, references, categories, negation, ambiguity, and route safety. A destination change requires either confirmation or a valid pending result selection before the active journey changes.

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
- Optional Gemini/Muse classification with local fallback.

Not implemented:

- Live traffic or congestion-aware ETA.
- Turn-by-turn guidance.
- Continuous background GPS navigation.
- Walking or transit routing.
- Verified live opening hours, ratings, or business availability.
- Saved home/work addresses, accounts, or offline maps.
- Automatic support for every language or unrestricted general knowledge.

Clarification is a safety behavior when a request is ambiguous, unsupported, contradictory, or missing information.

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
