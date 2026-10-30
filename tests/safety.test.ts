import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { AIProvider } from "@/ai/AIProvider";
import { IntentProcessor } from "@/ai/IntentProcessor";
import { ConversationEngine } from "@/conversation/ConversationEngine";
import type { ConversationServices } from "@/conversation/ConversationServices";
import { clearPendingNavigation, emptyContext } from "@/conversation/ConversationContext";
import { NavigationController } from "@/navigation/NavigationController";
import { ambiguousReference, destinationInstruction, lastOptionIndex, referenceIndex, routeInstruction } from "@/navigation/commands";
import { emptySession } from "@/navigation/NavigationSession";
import type { IntentType, Location, NavigationAction, PlaceResult, RouteResult } from "@/types/domain";
import { prepareSpokenText, sanitizeVoiceRequest, speakResponse, startMicrophoneInterruption, startRecognition, startVoiceInterruption, voiceInterruptionRequest, voiceRequest } from "@/services/voice/browserVoice";
import { hindiConfirmation } from "@/ai/language";
import { locationSchema } from "@/types/schemas";
import { coordinatesSchema, geometrySchema, intentSchema, navigationActionSchema, placesRequestSchema, routeSchema } from "@/types/schemas";
import { requestCurrentLocation } from "@/services/geolocation";
import { categoryLabel, matchingCategories } from "@/utils/categories";
import { distanceBetween, formatDistance, formatDuration, validCoordinates } from "@/utils/geo";

const origin: Location = { id: "test:origin", name: "Test origin", lat: 51.5, lon: -0.1 };
const destination: Location = { id: "test:destination", name: "Test destination", lat: 51.51, lon: -0.12 };
const fixtureRoute: RouteResult = { distanceMeters: 2400, durationSeconds: 600, geometry: { type: "LineString", coordinates: [[-0.1, 51.5], [-0.12, 51.51]] } };
const places: PlaceResult[] = [
  { id: "osm:node:1", name: "Test restaurant A", lat: 51.501, lon: -0.101, category: "restaurant", distanceMeters: 150 },
  { id: "osm:node:2", name: "Test restaurant B", lat: 51.502, lon: -0.102, category: "restaurant", distanceMeters: 300 },
];

test("clearing pending navigation is immutable and preserves unrelated conversation state", () => {
  const context = Object.freeze({ ...emptyContext(), language: "hi" as const, recentPlaces: places, selectedPlaceId: places[0].id, lastSearchScope: "route" as const, pendingDestination: destination, pendingOrigin: origin, pendingLocationChoices: [destination], pendingSourceText: "Navigate to Oxford", pendingRevision: 7 });
  const cleared = clearPendingNavigation(context);
  assert.notStrictEqual(cleared, context);
  assert.equal(context.pendingDestination, destination);
  assert.equal(cleared.pendingDestination, null);
  assert.equal(cleared.pendingOrigin, null);
  assert.equal(cleared.pendingRevision, null);
  assert.equal(cleared.pendingSourceText, null);
  assert.deepEqual(cleared.pendingLocationChoices, []);
  assert.strictEqual(cleared.messages, context.messages);
  assert.strictEqual(cleared.recentPlaces, places);
  assert.equal(cleared.selectedPlaceId, places[0].id);
  assert.equal(cleared.language, "hi");
  assert.equal(cleared.lastSearchScope, "route");
});

test("schema boundaries reject invalid coordinates, routes, actions and unexpected intent fields", () => {
  for (const point of [{ lat: Infinity, lon: 0 }, { lat: 91, lon: 0 }, { lat: 0, lon: -181 }, { lat: NaN, lon: 1 }]) {
    assert.equal(validCoordinates(point), false);
    assert.equal(coordinatesSchema.safeParse(point).success, false);
  }
  assert.equal(geometrySchema.safeParse({ type: "LineString", coordinates: [[0, 0]] }).success, false);
  assert.equal(routeSchema.safeParse({ ...fixtureRoute, durationSeconds: -1 }).success, false);
  assert.equal(intentSchema.safeParse({ type: "GET_ETA", execute: "unsafe" }).success, false);
  for (const scope of ["nearby", "route"] as const) {
    assert.equal(placesRequestSchema.safeParse({ category: "fuel", center: origin, scope, ...(scope === "route" ? { geometry: fixtureRoute.geometry } : {}) }).success, true);
  }
  assert.equal(placesRequestSchema.safeParse({ category: "fuel", center: origin, scope: "route" }).success, false);
  for (const action of [
    { type: "SET_ROUTE", origin, destination },
    { type: "PLAN_ROUTE", origin, destination, sourceText: "Plan a route from London to Oxford", confirmed: true, allowedIds: [destination.id], expectedRevision: 0 },
    { type: "CHANGE_DESTINATION", destination, sourceText: "Navigate to Oxford", confirmed: true, allowedIds: [destination.id], expectedRevision: 0 },
    { type: "STOP_NAVIGATION", sourceText: "Stop navigation" },
  ]) assert.equal(navigationActionSchema.safeParse(action).success, true);
  assert.equal(navigationActionSchema.safeParse({ type: "STOP_NAVIGATION", sourceText: "Stop navigation", code: "unsafe" }).success, false);
  assert.equal(formatDistance(99.5), "100 m");
  assert.equal(formatDistance(1500), "1.5 km");
  assert.equal(formatDuration(0), "1 min");
  assert.equal(formatDuration(3660), "1 hr 1 min");
  assert.equal(distanceBetween(origin, origin), 0);
  assert.equal(categoryLabel("cafe"), "Cafes");
  assert.equal(categoryLabel("unknown" as PlaceResult["category"]), "unknown");
  assert.equal(matchingCategories("coffee and pharmacy").length, 2);
});

test("geolocation covers success, unsupported, denied, timeout, unavailable and invalid device coordinates", async (context) => {
  mockBrowser(context, { navigator: {} });
  await assert.rejects(requestCurrentLocation(), /not supported/);
  Reflect.deleteProperty(globalThis, "navigator");
  await assert.rejects(requestCurrentLocation(), /not supported/);
  for (const code of [1, 2, 3]) {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation: { getCurrentPosition: (_success: unknown, failure: (error: { code: number }) => void) => failure({ code }) } } });
    await assert.rejects(requestCurrentLocation(), code === 1 ? /denied/ : code === 3 ? /timed out/ : /unavailable/);
  }
  for (const latitude of [17, 1000]) {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation: { getCurrentPosition: (success: (position: { coords: { latitude: number; longitude: number } }) => void, _failure: unknown, options: PositionOptions) => {
      assert.equal(options.enableHighAccuracy, true);
      assert.equal(options.timeout, 12000);
      success({ coords: { latitude, longitude: 78 } });
    } } } });
    if (latitude === 17) assert.equal((await requestCurrentLocation()).id, "device:current");
    else await assert.rejects(requestCurrentLocation(), /invalid location/);
  }
});

for (const [text, expected] of [
  ["option one option one option two", 1],
  ["option 2, option 2, option 1", 0],
  ["Choose option one. Select option two.", 1],
  ["first option, second option, third option", 2],
  ["विकल्प एक विकल्प एक विकल्प दो", 1],
  ["option one option 99", 98],
  ["option two option 0", -1],
  [Array(80).fill("option one").join(" ") + " option two", 1],
] as const) {
  test(`consecutive option choices use the final explicit selection: ${text.slice(0, 70)}`, () => {
    assert.equal(lastOptionIndex(text), expected);
  });
}

for (const text of ["option one or option two", "option one and option two", "Don't choose option one option two", "Tell me about option one option two", "option one option two?", "2?", "दो?", "option one option", "option one maybe option two"]) {
  test(`last-choice parsing does not turn ambiguity or questions into selection: ${text}`, () => {
    assert.equal(lastOptionIndex(text), undefined);
  });
}

const phrases: [string, IntentType][] = [
  ["मेरेको पास में पेट्रोल पंप दिखाओ", "SEARCH_NEARBY"],
  ["Mereko paas mein petrol pump dikhao", "SEARCH_NEARBY"],
  ["रास्ते में रेस्टोरेंट दिखाओ", "SEARCH_ALONG_ROUTE"],
  ["Raaste mein khana kidhar hai", "SEARCH_ALONG_ROUTE"],
  ["पास में दवाखाना किधर है", "SEARCH_NEARBY"],
  ["नज़दीक दवाई की दुकान दिखाओ", "SEARCH_NEARBY"],
  ["कितना टाइम लगेगा", "GET_ETA"],
  ["Kitna waqt lagega", "GET_ETA"],
  ["Kab pahunchenge", "GET_ETA"],
  ["कितनी दूरी है", "GET_ROUTE_DISTANCE"],
  ["दूरी कितनी है", "GET_ROUTE_DISTANCE"],
  ["ट्रैफिक है क्या", "GET_TRAFFIC"],
  ["दूसरा रास्ता दिखाओ", "GET_ROUTE_ALTERNATIVES"],
  ["Aur raste dikhao", "GET_ROUTE_ALTERNATIVES"],
  ["दूसरे वाले की जानकारी बताओ", "GET_PLACE_DETAILS"],
  ["मुझे चारमीनार ले चलो", "CHANGE_DESTINATION"],
  ["Mereku Charminar leke chalo", "CHANGE_DESTINATION"],
  ["मेरेको दूसरे वाले को ले चलो", "CHANGE_DESTINATION"],
  ["मुझे सबसे पास पेट्रोल पंप ले चलो", "CHANGE_DESTINATION"],
  ["अभी की लोकेशन से चारमीनार तक रास्ता दिखाओ", "PLAN_ROUTE"],
  ["Current location se Charminar tak route dikhao", "PLAN_ROUTE"],
  ["नेविगेशन बंद करो", "STOP_NAVIGATION"],
  ["Route band karo", "STOP_NAVIGATION"],
  ["मुझे चारमीनार मत ले जाओ", "CLARIFY"],
  ["Mereko Charminar leke chalo nakko", "CLARIFY"],
  ["मुझे घर ले चलो", "CLARIFY"],
  ["मेरेको पहले और दूसरे वाले को ले चलो", "CLARIFY"],
  ["Find petrol stations nearby", "SEARCH_NEARBY"],
  ["Could you show me gas stations near me?", "SEARCH_NEARBY"],
  ["Any drugstores nearby?", "SEARCH_NEARBY"],
  ["Where can I get coffee?", "SEARCH_NEARBY"],
  ["Are there any restaurants along my route?", "SEARCH_ALONG_ROUTE"],
  ["Show EV charging on the way", "SEARCH_ALONG_ROUTE"],
  ["How much longer will it take to reach home?", "GET_ETA"],
  ["When will we arrive?", "GET_ETA"],
  ["What's the remaining distance?", "GET_ROUTE_DISTANCE"],
  ["How far is my destination?", "GET_ROUTE_DISTANCE"],
  ["Is there traffic on the route?", "GET_TRAFFIC"],
  ["Check other routes.", "GET_ROUTE_ALTERNATIVES"],
  ["Are there any alternative routes?", "GET_ROUTE_ALTERNATIVES"],
  ["Is there another way?", "GET_ROUTE_ALTERNATIVES"],
  ["Show route options", "GET_ROUTE_ALTERNATIVES"],
  ["Can you check are there any?", "CLARIFY"],
  ["Target HITECH City.", "CHANGE_DESTINATION"],
  ["Target: HITECH City.", "CHANGE_DESTINATION"],
  ["Target location Charminar.", "CHANGE_DESTINATION"],
  ["Target location as Charminar.", "CHANGE_DESTINATION"],
  ["Target location is Charminar.", "CHANGE_DESTINATION"],
  ["Target location: Charminar.", "CHANGE_DESTINATION"],
  ["Select target location as Charminar.", "CHANGE_DESTINATION"],
  ["Destination Charminar.", "CHANGE_DESTINATION"],
  ["Target location as", "CLARIFY"],
  ["Target location", "CLARIFY"],
  ["Target", "CLARIFY"],
  ["Target as", "CLARIFY"],
  ["Destination location.", "CLARIFY"],
  ["Is my target location Charminar?", "CLARIFY"],
  ["Don't set target location as Charminar.", "CLARIFY"],
  ["Select Starting location, location as current location and Target location as Charminar.", "PLAN_ROUTE"],
  ["Set origin to current location and destination to Charminar", "PLAN_ROUTE"],
  ["Plan a route from current location to Charminar", "PLAN_ROUTE"],
  ["Navigate to Charminar from my current location", "PLAN_ROUTE"],
  ["Don't set origin to current location and destination to Charminar", "CLARIFY"],
  ["Compare the options", "COMPARE_OPTIONS"],
  ["Which one is fastest?", "COMPARE_OPTIONS"],
  ["Tell me more about the second one", "GET_PLACE_DETAILS"],
  ["What are the opening hours for result 2?", "GET_PLACE_DETAILS"],
  ["Take me to the nearest petrol station", "CHANGE_DESTINATION"],
  ["Get me to the nearest gas station", "CHANGE_DESTINATION"],
  ["Could you please take me to the second restaurant?", "CHANGE_DESTINATION"],
  ["I'd like to go to the second restaurant", "CHANGE_DESTINATION"],
  ["Please change my destination to result two", "CHANGE_DESTINATION"],
  ["Navigate to 2nd Avenue", "CHANGE_DESTINATION"],
  ["Please stop navigation", "STOP_NAVIGATION"],
  ["Could you clear my route?", "STOP_NAVIGATION"],
  ["Don't navigate to the second restaurant", "CLARIFY"],
  ["Navigate to the first restaurant but don't change my destination", "CLARIFY"],
  ["Navigate to the first and second restaurant", "CLARIFY"],
  ["Navigate to result one and two", "CLARIFY"],
  ["Find restaurants or petrol stations", "CLARIFY"],
  ["Take me there", "CLARIFY"],
  ["Find something nearby", "CLARIFY"],
  ["", "CLARIFY"],
];

for (const [text, expected] of phrases) {
  test(`local language: ${text || "empty input"}`, async () => {
    const intent = await new IntentProcessor().process({ text, context: emptyContext(), session: emptySession() });
    assert.equal(intent.type, expected);
  });
}

test("place references accept ordinal digits and number words without confusing street names", () => {
  assert.equal(referenceIndex("विकल्प दो"), 1);
  assert.equal(referenceIndex("दो"), 1);
  assert.equal(referenceIndex("२"), 1);
  assert.equal(referenceIndex("चौथा वाला"), 3);
  assert.equal(referenceIndex("ऑप्शन २"), 1);
  assert.equal(referenceIndex("दूसरे वाले को ले चलो"), 1);
  assert.equal(referenceIndex("option teen"), 2);
  assert.equal(ambiguousReference("पहले और दूसरे वाले"), true);
  assert.equal(referenceIndex("Navigate to the 2nd restaurant"), 1);
  assert.equal(referenceIndex("Navigate to result two"), 1);
  assert.equal(referenceIndex("Navigate to 2nd Avenue"), undefined);
  assert.equal(referenceIndex("Navigate to First Avenue"), undefined);
  assert.equal(ambiguousReference("Navigate to result 1 and 2"), true);
  assert.equal(ambiguousReference("Navigate to the first and second restaurant"), true);
});

test("informational, hypothetical, and negative phrases are not navigation instructions", () => {
  for (const text of ["Target location Charminar?", "Is my target location Charminar?", "What is the target location Charminar?", "Don't set target location as Charminar.", "If target location is Charminar, how long?", "Target location as", "Target location is", "Target location"]) {
    assert.equal(destinationInstruction(text), null, text);
  }
  for (const text of ["क्या चारमीनार ले चलो", "चारमीनार मत ले चलो", "Mereko Charminar nakko leke chalo", "Agar Charminar leke chalo", "Navigate to Charminar मत", "Take me to Charminar nahi", "मेरेको चारमीनार और गोलकोंडा ले चलो"]) {
    assert.equal(destinationInstruction(text), null, text);
  }
  for (const text of ["How do I navigate to the second restaurant?", "Would going to the second restaurant be faster?", "If I go to the second restaurant, how long is the detour?", "Don't take me to the first place", "Are there any restaurants along my route?"]) {
    assert.equal(destinationInstruction(text), null, text);
  }
});

test("a selected current result resolves 'there', but an unselected list is ambiguous", async () => {
  const processor = new IntentProcessor();
  const context = { ...emptyContext(), recentPlaces: places };
  const ambiguous = await processor.process({ text: "Take me there", context, session: emptySession() });
  assert.equal(ambiguous.type, "CLARIFY");
  const resolved = await processor.process({ text: "Take me there", context: { ...context, selectedPlaceId: places[1].id }, session: emptySession() });
  assert.equal(resolved.type, "CHANGE_DESTINATION");
  assert.equal(resolved.reference, 1);
});

test("contextual follow-up retains the most recent place category", async () => {
  const intent = await new IntentProcessor().process({ text: "What about along the route?", context: { ...emptyContext(), recentPlaces: places }, session: emptySession() });
  assert.equal(intent.type, "SEARCH_ALONG_ROUTE");
  assert.equal(intent.category, "restaurant");
});

test("an unavailable optional adapter falls back to local processing", async () => {
  const unavailable: AIProvider = { label: "Unavailable test adapter", mode: "model", process: async () => { throw new Error("Unavailable"); } };
  const intent = await new IntentProcessor(unavailable).process({ text: "How long will it take?", context: emptyContext(), session: emptySession() });
  assert.equal(intent.type, "GET_ETA");
});

test("malformed adapter output falls back without executing arbitrary data", async () => {
  const malformed: AIProvider = { label: "Malformed test adapter", mode: "model", process: async () => ({ execute: "changeDestination", code: "untrusted" }) };
  const intent = await new IntentProcessor(malformed).process({ text: "How far is my destination?", context: emptyContext(), session: emptySession() });
  assert.equal(intent.type, "GET_ROUTE_DISTANCE");
});

test("adapter output cannot turn a search into a destination change", async () => {
  const unsafe: AIProvider = { label: "Unsafe test adapter", mode: "model", process: async () => ({ type: "CHANGE_DESTINATION", query: "Wrong destination", reference: 0 }) };
  const intent = await new IntentProcessor(unsafe).process({ text: "Find restaurants nearby", context: emptyContext(), session: emptySession() });
  assert.notEqual(intent.type, "CHANGE_DESTINATION");
});

test("navigation references and target text come from the user, not an adapter", async () => {
  const unsafe: AIProvider = { label: "Unsafe test adapter", mode: "model", process: async () => ({ type: "CHANGE_DESTINATION", query: "Wrong destination", reference: 0 }) };
  const intent = await new IntentProcessor(unsafe).process({ text: "Navigate to the second restaurant", context: { ...emptyContext(), recentPlaces: places }, session: emptySession() });
  assert.equal(intent.reference, 1);
  assert.equal(intent.query, "the second restaurant");
});

async function controllerFixture() {
  const navigation = new NavigationController(async () => structuredClone(fixtureRoute));
  await navigation.execute({ type: "SET_ROUTE", origin, destination });
  return navigation;
}

test("standalone destination declarations extract the address without their labels", () => {
  for (const text of ["Target Charminar.", "Target: Charminar.", "Target as Charminar.", "Target location Charminar.", "Target location as Charminar.", "Target location is Charminar.", "Target location: Charminar.", "Target location=Charminar.", "Select target location as Charminar.", "Destination Charminar.", "Please set destination location to Charminar."]) {
    assert.equal(destinationInstruction(text), "Charminar", text);
  }
});

test("short Target labels still reject empty values, questions, negation and alternatives", () => {
  for (const text of ["Target", "Target as", "Target location.", "Destination location.", "Target HITECH City?", "Is my target HITECH City?", "Don't set target HITECH City.", "Target HITECH City or Charminar."]) {
    assert.equal(destinationInstruction(text), null, text);
  }
});

test("a standalone target location requests the current origin and waits for spoken confirmation", async (context) => {
  mockServices(context, undefined, [destination]);
  const navigation = new NavigationController(async () => structuredClone(fixtureRoute));
  let locationRequests = 0;
  const engine = new ConversationEngine(navigation, {
    onPlaces: () => {}, onSelectPlace: () => {}, onDetours: () => {}, getReferenceLocation: () => null,
    getCurrentLocation: async () => { locationRequests += 1; return origin; },
  });
  const reply = await engine.send("Target location Charminar.");
  assert.equal(locationRequests, 1);
  assert.equal(engine.getSnapshot().pendingOrigin?.id, origin.id);
  assert.equal(engine.getSnapshot().pendingDestination?.id, destination.id);
  assert.equal(navigation.getSnapshot().route, null);
  assert.match(reply, /say confirm route/i);
  await engine.send("Confirm route.");
  assert.equal(navigation.getSnapshot().destination?.id, destination.id);
});

test("a standalone target location preserves an active route until confirmation", async (context) => {
  const nextDestination = { ...destination, id: "test:charminar", name: "Charminar" };
  mockServices(context, undefined, [nextDestination]);
  const navigation = await controllerFixture();
  const previous = navigation.getSnapshot();
  const engine = engineFixture(navigation);
  await engine.send("Target location Charminar.");
  assert.strictEqual(navigation.getSnapshot(), previous);
  assert.equal(engine.getSnapshot().pendingDestination?.id, nextDestination.id);
  await engine.send("Confirm destination.");
  assert.equal(navigation.getSnapshot().destination?.id, nextDestination.id);
});

function changeAction(navigation: NavigationController): Extract<NavigationAction, { type: "CHANGE_DESTINATION" }> {
  return { type: "CHANGE_DESTINATION", destination: places[1], sourceText: "Navigate to the second restaurant", confirmed: true, allowedIds: places.map((place) => place.id), expectedRevision: navigation.getSnapshot().revision };
}

test("the controller requires an explicit command, confirmation, valid ID, coordinates, and current revision", async () => {
  const navigation = await controllerFixture();
  const previous = navigation.getSnapshot();
  const action = changeAction(navigation);
  for (const invalid of [
    { ...action, sourceText: "Find restaurants nearby" },
    { ...action, sourceText: "Navigate to the first and second restaurant" },
    { ...action, confirmed: false },
    { ...action, allowedIds: ["not-a-current-result"] },
    { ...action, destination: { ...places[1], lat: 91 } },
    { ...action, expectedRevision: 0 },
  ]) {
    await assert.rejects(() => navigation.execute(invalid));
    assert.strictEqual(navigation.getSnapshot(), previous);
  }
});

test("a failed route calculation preserves the complete active session", async () => {
  let fail = false;
  const navigation = new NavigationController(async () => { if (fail) throw new Error("Routing unavailable"); return structuredClone(fixtureRoute); });
  await navigation.execute({ type: "SET_ROUTE", origin, destination });
  const previous = navigation.getSnapshot();
  fail = true;
  await assert.rejects(() => navigation.execute(changeAction(navigation)), /Routing unavailable/);
  assert.strictEqual(navigation.getSnapshot(), previous);
});

test("stopping navigation invalidates a pending route calculation", async () => {
  let resolve!: (value: RouteResult) => void;
  const pending = new Promise<RouteResult>((finish) => { resolve = finish; });
  const navigation = new NavigationController(() => pending);
  const calculation = navigation.execute({ type: "SET_ROUTE", origin, destination });
  await navigation.execute({ type: "STOP_NAVIGATION", sourceText: "Stop navigation" });
  resolve(structuredClone(fixtureRoute));
  await assert.rejects(() => calculation, /superseded/);
  assert.equal(navigation.getSnapshot().destination, null);
});

function mockServices(context: TestContext, alternatives: RouteResult[] = [fixtureRoute], locations: Location[] = [], geocodeQueries?: string[], geocodeRequests?: unknown[]) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/places") return Response.json(places);
    if (path === "/api/route") {
      const body: unknown = JSON.parse(String(init?.body));
      const requestedAlternatives = typeof body === "object" && body !== null && "alternatives" in body && body.alternatives === true;
      return Response.json(requestedAlternatives ? alternatives : fixtureRoute);
    }
    if (path === "/api/geocode") {
      if (geocodeQueries || geocodeRequests) {
        const body: unknown = JSON.parse(String(init?.body));
        assert.ok(typeof body === "object" && body !== null && "query" in body && typeof body.query === "string");
        geocodeQueries?.push(body.query);
        geocodeRequests?.push(body);
      }
      return Response.json(locations);
    }
    throw new Error(`Unexpected test request: ${path}`);
  };
  context.after(() => { globalThis.fetch = original; });
}

function engineFixture(navigation: NavigationController) {
  return new ConversationEngine(navigation, { onPlaces: () => {}, onSelectPlace: () => {}, onDetours: () => {}, getReferenceLocation: () => origin });
}

test("conversation service adapters are substitutable without changing confirmation or controller ownership", async (context) => {
  context.mock.method(globalThis, "fetch", async () => assert.fail("Injected services must not call fetch"));
  const calls: { method: string; args: unknown[] }[] = [];
  const gps = { ...origin, id: "device:current" };
  const services: ConversationServices = {
    searchLocations: async (query, reference) => { calls.push({ method: "locations", args: [query, reference] }); return [query === "Starttown" ? origin : destination]; },
    searchPlaces: async (...args) => { calls.push({ method: "places", args }); return places; },
    requestRoute: async (...args) => { calls.push({ method: "detour", args }); return fixtureRoute; },
    requestRouteAlternatives: async (...args) => { calls.push({ method: "alternatives", args }); return [fixtureRoute]; },
    requestCurrentLocation: async () => { calls.push({ method: "gps", args: [] }); return gps; },
  };
  let commits = 0;
  const navigation = new NavigationController(async () => { commits += 1; return fixtureRoute; });
  const engine = new ConversationEngine(navigation, { onPlaces: () => {}, onSelectPlace: () => {}, onDetours: () => {}, getReferenceLocation: () => null }, services);
  await engine.send("Plan a route from current location to Oxford");
  assert.equal(commits, 0);
  assert.equal(navigation.getSnapshot().route, null);
  assert.deepEqual(calls.slice(0, 2), [{ method: "gps", args: [] }, { method: "locations", args: ["Oxford", gps] }]);
  await engine.confirm();
  assert.equal(commits, 1);
  const session = navigation.getSnapshot();
  await engine.find("restaurant", "route");
  await engine.compare();
  await engine.send("Check other routes");
  assert.deepEqual(calls.find((call) => call.method === "places")?.args, ["restaurant", gps, "route", fixtureRoute.geometry]);
  assert.deepEqual(calls.find((call) => call.method === "detour")?.args, [[gps, places[0], destination]]);
  assert.deepEqual(calls.find((call) => call.method === "alternatives")?.args, [[gps, destination]]);
  assert.strictEqual(navigation.getSnapshot(), session);
  assert.equal(commits, 1);
  await engine.send("Plan a route from Starttown to Oxford");
  assert.deepEqual(calls.at(-2), { method: "locations", args: ["Starttown", undefined] });
  assert.deepEqual(calls.at(-1), { method: "locations", args: ["Oxford", origin] });
  assert.strictEqual(navigation.getSnapshot(), session);
});

function mockResponses(context: TestContext, handler: (path: string, body: Record<string, unknown>) => unknown | Promise<unknown>) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const result = await handler(String(input), JSON.parse(String(init?.body)) as Record<string, unknown>);
    return result instanceof Response ? result : Response.json(result);
  };
  context.after(() => { globalThis.fetch = previous; });
}

test("conversation rejects missing prerequisites, unknown places, empty confirmations and invalid choices", async () => {
  const navigation = new NavigationController(async () => fixtureRoute);
  const engine = new ConversationEngine(navigation, { onPlaces: () => {}, onSelectPlace: () => {}, onDetours: () => {}, getReferenceLocation: () => null });
  await assert.rejects(engine.find("fuel", "nearby"), /Set an origin/);
  await assert.rejects(engineFixture(navigation).find("fuel", "route"), /Calculate a route/);
  await assert.rejects(engine.compare(), /Search for places first/);
  await assert.rejects(engine.confirm(), /no destination change/);
  await assert.rejects(engine.chooseLocation(9), /not in the current/);
  assert.throws(() => engine.selectPlace(places[0]), /not in the latest/);
  engine.selectPlace(null);
  assert.equal(await engine.send("   "), "");
  assert.match(await engine.send("How long will it take?"), /Calculate a route/);
  assert.match(await engine.send("How far is my destination?"), /Calculate a route/);
  assert.match(await engine.send("हाँ"), /पहले/);
  assert.match(await engine.send("कितना टाइम लगेगा"), /पहले/);
  assert.match(await engine.send("कितनी दूरी है"), /पहले/);
});

for (const origins of [[], [origin, destination], [origin]]) {
  test(`named-origin route planning handles ${origins.length} origin matches`, async (context) => {
    mockResponses(context, (_path, body) => body.query === "London" ? origins : [destination]);
    const navigation = new NavigationController(async () => fixtureRoute);
    const engine = engineFixture(navigation);
    const reply = await engine.send("Plan a route from London to Oxford");
    if (origins.length === 1) {
      assert.match(reply, /Plan a driving route from Test origin/);
      await engine.send("confirm route");
      assert.equal(navigation.getSnapshot().origin?.id, origin.id);
      assert.equal(navigation.getSnapshot().destination?.id, destination.id);
    } else {
      assert.match(reply, origins.length ? /multiple matches/ : /could not find/);
      assert.equal(engine.getSnapshot().pendingDestination, null);
    }
  });
}

test("a first destination can use the available reference location without requesting GPS", async (context) => {
  mockServices(context, undefined, [destination]);
  const navigation = new NavigationController(async () => fixtureRoute);
  const engine = engineFixture(navigation);
  await engine.send("Navigate to Oxford");
  assert.equal(engine.getSnapshot().pendingOrigin?.id, origin.id);
  await engine.send("हाँ");
  assert.equal(navigation.getSnapshot().destination?.id, destination.id);
  assert.match(engine.getSnapshot().messages.at(-1)?.text ?? "", /मिनट/);
});

test("affirmative answers clarify multiple address choices and cancellation leaves the journey unchanged", async (context) => {
  mockServices(context, undefined, [origin, destination]);
  const navigation = await controllerFixture();
  const previous = navigation.getSnapshot();
  const engine = engineFixture(navigation);
  await engine.send("Navigate to Oxford");
  assert.match(await engine.send("yes please"), /Which destination match/);
  await engine.send("No thanks");
  assert.equal(engine.getSnapshot().pendingLocationChoices.length, 0);
  assert.strictEqual(navigation.getSnapshot(), previous);
});

for (const operation of ["search", "alternatives", "addresses"] as const) {
  test(`late ${operation} results cannot survive a journey revision`, async (context) => {
    let release!: () => void;
    let began!: () => void;
    const started = new Promise<void>((resolve) => { began = resolve; });
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    mockResponses(context, async (path) => { began(); await waiting; return path === "/api/places" ? places : path === "/api/route" ? [fixtureRoute] : [destination]; });
    const navigation = await controllerFixture();
    const engine = engineFixture(navigation);
    const request = operation === "search" ? engine.find("restaurant", "route") : engine.send(operation === "alternatives" ? "Check other routes" : "Navigate to Oxford");
    await started;
    await navigation.execute({ type: "SET_ROUTE", origin, destination: { ...destination, id: "test:replacement" } });
    release();
    await assert.rejects(request, /changed/);
    assert.equal(navigation.getSnapshot().destination?.id, "test:replacement");
    assert.equal(engine.getSnapshot().recentPlaces.length, 0);
  });
}

test("in-flight conversation requests reject concurrent send, confirm and address selection", async (context) => {
  let release!: () => void;
  let began!: () => void;
  const started = new Promise<void>((resolve) => { began = resolve; });
  mockResponses(context, async () => { began(); await new Promise<void>((resolve) => { release = resolve; }); return [destination]; });
  const engine = engineFixture(await controllerFixture());
  const request = engine.send("Navigate to Oxford");
  await started;
  await assert.rejects(engine.send("How far is it?"), /Please wait/);
  await assert.rejects(engine.confirm(), /Please wait/);
  await assert.rejects(engine.chooseLocation(0), /Please wait/);
  release();
  await request;
  assert.equal(engine.getSnapshot().pendingDestination?.id, destination.id);
});

test("without a route comparison reports straight-line distances and preserves place selection", async (context) => {
  mockServices(context);
  const navigation = new NavigationController(async () => fixtureRoute);
  const engine = engineFixture(navigation);
  await engine.find("restaurant", "nearby");
  engine.selectPlace(places[0]);
  assert.equal(engine.getSnapshot().selectedPlaceId, places[0].id);
  assert.match(await engine.compare(), /Driving detours are not available/);
  engine.setLanguage("hi");
  assert.match(await engine.compare(), /सीधी दूरी/);
  engine.selectPlace(null);
  assert.equal(engine.getSnapshot().selectedPlaceId, null);
  assert.equal(navigation.getSnapshot().route, null);
});

test("detour comparisons report shorter drives, partial outages and complete failure without changing the route", async (context) => {
  let requests = 0;
  mockResponses(context, (path) => path === "/api/places" ? places : ++requests === 1 ? { ...fixtureRoute, durationSeconds: 300 } : new Response("{}", { status: 502 }));
  const navigation = await controllerFixture();
  const previous = navigation.getSnapshot();
  const engine = engineFixture(navigation);
  await engine.find("restaurant", "route");
  engine.setLanguage("hi");
  const reply = await engine.compare();
  assert.match(reply, /कम/);
  assert.match(reply, /उपलब्ध नहीं/);
  await assert.rejects(engine.compare(), /Detours could not be calculated/);
  assert.strictEqual(navigation.getSnapshot(), previous);
});

test("a route changed during comparison discards every delayed detour", async (context) => {
  let release!: () => void;
  let began!: () => void;
  const started = new Promise<void>((resolve) => { began = resolve; });
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  mockResponses(context, async (path) => { if (path === "/api/places") return places; began(); await waiting; return fixtureRoute; });
  const navigation = await controllerFixture();
  const engine = engineFixture(navigation);
  await engine.find("restaurant", "nearby");
  const request = engine.compare();
  await started;
  await navigation.execute({ type: "SET_ROUTE", origin, destination });
  release();
  await assert.rejects(request, /route changed during comparison/);
});

test("place details handle implicit single results, route distances, metadata and missing references", async (context) => {
  let results = [{ ...places[0], address: "123 Example Street", openingHours: "24/7" }];
  mockResponses(context, () => results);
  const navigation = await controllerFixture();
  const engine = engineFixture(navigation);
  await engine.find("restaurant", "route");
  assert.match(await engine.send("Show details"), /from the route corridor/);
  assert.match(await engine.send("पहले वाले की जानकारी बताओ"), /123 Example Street/);
  results = [];
  await engine.find("restaurant", "nearby");
  engine.setLanguage("en");
  assert.match(await engine.send("Show details"), /Which result/);
  assert.match(await engine.send("जानकारी बताओ"), /कौन सा नतीजा/);
});

test("nearest searches with no matches and named results with duplicate names do not propose a destination", async (context) => {
  let results: PlaceResult[] = [];
  mockResponses(context, () => results);
  const navigation = await controllerFixture();
  const engine = engineFixture(navigation);
  assert.match(await engine.send("Navigate to the nearest restaurant"), /No matching places/);
  assert.match(await engine.send("Find restaurants nearby"), /No matching OpenStreetMap/);
  assert.match(await engine.send("पास में रेस्टोरेंट दिखाओ"), /कोई जगह नहीं/);
  results = places.map((place) => ({ ...place, name: "Cedar Bistro" }));
  await engine.find("restaurant", "nearby");
  assert.match(await engine.send("Navigate to Cedar Bistro"), /Several results/);
  assert.equal(engine.getSnapshot().pendingDestination, null);
  results = results.slice(0, 1);
  await engine.find("restaurant", "nearby");
  await engine.send("Navigate to Cedar Bistro");
  assert.equal(engine.getSnapshot().pendingDestination?.id, places[0].id);
});

test("Hindi place search and explicit Stop preserve the same mutation boundaries as English", async (context) => {
  mockServices(context);
  const navigation = await controllerFixture();
  const engine = engineFixture(navigation);
  assert.match(await engine.send("पास में रेस्टोरेंट दिखाओ"), /पाँच किलोमीटर/);
  assert.match(await engine.send("रास्ते में रेस्टोरेंट दिखाओ"), /डेढ़ किलोमीटर/);
  const previous = navigation.getSnapshot();
  await engine.send("कितना टाइम लगेगा");
  await engine.send("कितनी दूरी है");
  await engine.send("ट्रैफिक है क्या");
  assert.strictEqual(navigation.getSnapshot(), previous);
  await engine.send("नेविगेशन बंद करो");
  assert.equal(navigation.getSnapshot().route, null);
  assert.equal(engine.getSnapshot().recentPlaces.length, 0);
});

test("route questions, place searches, details, and comparisons never mutate navigation", async (context) => {
  mockServices(context);
  const navigation = await controllerFixture();
  const engine = engineFixture(navigation);
  const previous = navigation.getSnapshot();
  for (const phrase of ["How much longer to reach home?", "How far is my destination?", "Is there traffic?", "Check other routes", "Find restaurants nearby", "Are there restaurants along my route?", "Tell me about the second restaurant", "Compare the options"]) {
    await engine.send(phrase);
    assert.strictEqual(navigation.getSnapshot(), previous, phrase);
  }
});

test("a resolved explicit instruction waits for confirmation before changing destination", async (context) => {
  mockServices(context);
  const navigation = await controllerFixture();
  const engine = engineFixture(navigation);
  await engine.send("Find restaurants nearby");
  await engine.send("Could you please take me to the second restaurant?");
  assert.equal(navigation.getSnapshot().destination?.id, destination.id);
  assert.equal(engine.getSnapshot().pendingDestination?.id, places[1].id);
  await engine.confirm();
  assert.equal(navigation.getSnapshot().destination?.id, places[1].id);
  assert.equal(engine.getSnapshot().pendingDestination, null);
});

test("a selected place resolves a natural-language follow-up end to end", async (context) => {
  mockServices(context);
  const navigation = await controllerFixture();
  const engine = engineFixture(navigation);
  await engine.send("Find restaurants nearby");
  engine.selectPlace(places[1]);
  await engine.send("Take me there");
  assert.equal(engine.getSnapshot().pendingDestination?.id, places[1].id);
  assert.equal(navigation.getSnapshot().destination?.id, destination.id);
});

test("invalid references and categories do not produce a destination proposal", async (context) => {
  mockServices(context);
  const navigation = await controllerFixture();
  const engine = engineFixture(navigation);
  await engine.send("Find restaurants nearby");
  for (const phrase of ["Navigate to result 9", "Navigate to result 0", "Navigate to the second hospital", "Navigate to the first and second restaurant"]) {
    await engine.send(phrase);
    assert.equal(engine.getSnapshot().pendingDestination, null, phrase);
    assert.equal(navigation.getSnapshot().destination?.id, destination.id, phrase);
  }
});

test("new navigation invalidates previous references and pending confirmation", async (context) => {
  mockServices(context);
  const navigation = await controllerFixture();
  const engine = engineFixture(navigation);
  await engine.send("Find restaurants nearby");
  await engine.send("Navigate to the second restaurant");
  await navigation.execute({ type: "SET_ROUTE", origin, destination: { ...destination, id: "test:new" } });
  assert.equal(engine.getSnapshot().recentPlaces.length, 0);
  assert.equal(engine.getSnapshot().pendingDestination, null);
  await assert.rejects(() => engine.confirm(), /no destination change/);
  assert.equal(navigation.getSnapshot().destination?.id, "test:new");
});

test("an unfinished question receives a focused follow-up without calling a service", async () => {
  const navigation = await controllerFixture();
  const engine = engineFixture(navigation);
  const previous = navigation.getSnapshot();
  const reply = await engine.send("Can you check are there any?");
  assert.match(reply, /what would you like me to check for/i);
  assert.match(reply, /petrol stations/i);
  assert.strictEqual(navigation.getSnapshot(), previous);
});

test("other routes require an active journey rather than guessing locations", async () => {
  const navigation = new NavigationController(async () => structuredClone(fixtureRoute));
  const reply = await engineFixture(navigation).send("Check other routes.");
  assert.match(reply, /origin and destination/i);
  assert.equal(navigation.getSnapshot().destination, null);
});

test("real alternative previews are deduplicated and never replace the active route", async (context) => {
  const alternative: RouteResult = { distanceMeters: 3100, durationSeconds: 780, geometry: { type: "LineString", coordinates: [[-0.1, 51.5], [-0.11, 51.52], [-0.12, 51.51]] } };
  mockServices(context, [fixtureRoute, alternative, alternative]);
  const navigation = await controllerFixture();
  let previews: RouteResult[] = [];
  const engine = new ConversationEngine(navigation, { onPlaces: () => {}, onSelectPlace: () => {}, onDetours: () => {}, onAlternatives: (routes) => { previews = routes; }, getReferenceLocation: () => origin });
  const previous = navigation.getSnapshot();
  const reply = await engine.send("Check other routes.");
  assert.equal(previews.length, 1);
  assert.match(reply, /13 min, 3.1 km/);
  assert.match(reply, /current route and destination are unchanged/i);
  assert.strictEqual(navigation.getSnapshot(), previous);
});

test("a service returning only the active route does not fabricate alternatives", async (context) => {
  mockServices(context);
  const navigation = await controllerFixture();
  const previous = navigation.getSnapshot();
  const reply = await engineFixture(navigation).send("Check other routes.");
  assert.match(reply, /did not return another driving route/i);
  assert.strictEqual(navigation.getSnapshot(), previous);
});

function mockBrowser(context: TestContext, values: Record<string, unknown>) {
  const descriptors = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  context.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
}

type StubResultEvent = { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] };
class RecognitionStub {
  static latest: RecognitionStub;
  lang = "";
  continuous = false;
  interimResults = false;
  aborted = false;
  audioTrack?: MediaStreamTrack;
  startArgumentCounts: number[] = [];
  onstart: (() => void) | null = null;
  onresult: ((event: StubResultEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  constructor() { RecognitionStub.latest = this; }
  start(audioTrack?: MediaStreamTrack) {
    this.startArgumentCounts.push(arguments.length);
    if (arguments.length && !audioTrack) throw new TypeError("Expected an audio track, not undefined");
    this.audioTrack = audioTrack;
  }
  abort() { this.aborted = true; this.onend?.(); }
}

function microphoneFixture(context: TestContext, mode: boolean | string = true, upgrade?: () => Promise<void>) {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let released = 0;
  const track = { readyState: "live", getSettings: () => ({ echoCancellation: mode }), getCapabilities: () => ({ echoCancellation: upgrade ? [true, false, "all"] : [true, false] }), applyConstraints: upgrade, stop: () => { released += 1; } } as unknown as MediaStreamTrack;
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US", mediaDevices: { getUserMedia: async () => stream } } });
  return { track, stream, released: () => released };
}

test("silent processed-track recognition falls back once and still accepts continuous submissions", async (context) => {
  const fixture = microphoneFixture(context);
  const warnings: string[] = [];
  const completed: string[] = [];
  context.after(startMicrophoneInterruption({ keepAlive: true, onReady: () => {}, onSpeech: () => {}, onComplete: (text) => completed.push(text), onCaptureFallback: (text) => warnings.push(text), onError: (message) => assert.fail(message) }));
  await Promise.resolve();
  const first = RecognitionStub.latest;
  first.onstart?.();
  context.mock.timers.tick(6000);
  const fallback = RecognitionStub.latest;
  assert.notEqual(fallback, first);
  assert.equal(first.aborted, true);
  assert.equal(fixture.released(), 1);
  assert.deepEqual(fallback.startArgumentCounts, [0]);
  fallback.onstart?.();
  fallback.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Hitech City Submit" } }] });
  assert.deepEqual(completed, ["Hitech City"]);
  context.mock.timers.tick(120000);
  assert.equal(warnings.length, 1);
  assert.equal(fallback.aborted, false);
});

test("raw results including rejected echo keep working track recognition from being downgraded", async (context) => {
  microphoneFixture(context);
  let results = 0;
  context.after(startMicrophoneInterruption({ keepAlive: true, spokenText: "The current driving route is ready", onReady: () => {}, onResult: () => { results += 1; }, onSpeech: () => assert.fail("Echo"), onCaptureFallback: () => assert.fail("Working track"), onError: (message) => assert.fail(message) }));
  await Promise.resolve();
  const recognition = RecognitionStub.latest;
  recognition.onstart?.();
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "The current driving route is ready" } }] });
  context.mock.timers.tick(10000);
  assert.equal(results, 1);
  assert.equal(RecognitionStub.latest, recognition);
});

for (const failure of ["OverconstrainedError", "NotSupportedError", "unexpected"]) {
  test(`all-system cancellation upgrade failure preserves usable input: ${failure}`, async (context) => {
    const fixture = microphoneFixture(context, true, async () => { throw failure === "unexpected" ? new Error("upgrade failed") : new DOMException("unsupported", failure); });
    let warnings = 0;
    context.after(startMicrophoneInterruption({ onSpeech: () => {}, onCaptureFallback: () => { warnings += 1; }, onError: (message) => assert.fail(message) }));
    await new Promise(setImmediate);
    assert.equal(RecognitionStub.latest.audioTrack, failure === "unexpected" ? undefined : fixture.track);
    assert.equal(warnings, failure === "unexpected" ? 1 : 0);
  });
}

test("advertised all-system mode is applied and late upgrades are cancelled without starting recognition", async (context) => {
  let upgrade!: () => void;
  const fixture = microphoneFixture(context, "all", () => new Promise<void>((resolve) => { upgrade = resolve; }));
  const before = RecognitionStub.latest;
  const stop = startMicrophoneInterruption({ onSpeech: () => {}, onError: (message) => assert.fail(message) });
  await Promise.resolve();
  stop();
  upgrade();
  await new Promise(setImmediate);
  assert.equal(fixture.released(), 1);
  assert.equal(RecognitionStub.latest, before);
});

test("supported all-system mode passes the processed track to recognition", async (context) => {
  const fixture = microphoneFixture(context, "all", async () => {});
  context.after(startMicrophoneInterruption({ onSpeech: () => {}, onError: (message) => assert.fail(message) }));
  await new Promise(setImmediate);
  assert.equal(RecognitionStub.latest.audioTrack, fixture.track);
});

test("synchronous track rejection cannot overwrite compatibility recognizer cleanup", async (context) => {
  const fixture = microphoneFixture(context);
  class RejectTrack extends RecognitionStub {
    start(audioTrack?: MediaStreamTrack) { if (audioTrack) throw new DOMException("no track", "NotSupportedError"); super.start(); }
  }
  Object.assign(window, { SpeechRecognition: RejectTrack });
  const warnings: string[] = [];
  const stop = startMicrophoneInterruption({ onReady: () => {}, onSpeech: () => {}, onCaptureFallback: (message) => warnings.push(message), onError: (message) => assert.fail(message) });
  await new Promise(setImmediate);
  const fallback = RecognitionStub.latest;
  fallback.onstart?.();
  assert.equal(fixture.released(), 1);
  assert.equal(warnings.length, 1);
  stop();
  assert.equal(fallback.aborted, true);
});

for (const name of ["NotAllowedError", "SecurityError", "NotReadableError"]) {
  test(`capture failure uses the correct permission or compatibility path: ${name}`, async (context) => {
    microphoneFixture(context);
    const errors: string[] = [];
    const warnings: string[] = [];
    context.mock.method(navigator.mediaDevices, "getUserMedia", async () => { throw new DOMException("capture failed", name); });
    context.after(startMicrophoneInterruption({ onSpeech: () => {}, onCaptureFallback: (message) => warnings.push(message), onError: (message) => errors.push(message) }));
    await new Promise(setImmediate);
    assert.equal(errors.length, name === "NotReadableError" ? 0 : 1);
    assert.equal(warnings.length, name === "NotReadableError" ? 1 : 0);
  });
}

test("missing media capture uses native input and native errors still stop safely", (context) => {
  mockBrowser(context, { navigator: { language: "en-US" }, window: { SpeechRecognition: RecognitionStub } });
  const errors: string[] = [];
  context.after(startMicrophoneInterruption({ onSpeech: () => {}, onError: (message) => errors.push(message) }));
  assert.deepEqual(RecognitionStub.latest.startArgumentCounts, [0]);
  RecognitionStub.latest.onerror?.({ error: "network" });
  assert.match(errors[0], /could not connect/);
});

test("missing or ended microphone tracks fail visibly and release streams", async (context) => {
  const fixture = microphoneFixture(context);
  Object.assign(fixture.track, { readyState: "ended" });
  const errors: string[] = [];
  context.after(startMicrophoneInterruption({ onSpeech: () => {}, onError: (message) => errors.push(message) }));
  await Promise.resolve();
  assert.match(errors[0], /No live microphone/);
  assert.equal(fixture.released(), 1);
});

test("persistent recognition survives time limits, discards drafts and submits independent turns", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  mockBrowser(context, { navigator: { language: "en-US" }, window: { SpeechRecognition: RecognitionStub } });
  const completed: string[] = [];
  const drafts: string[] = [];
  let discarded = 0;
  context.after(startRecognition({ keepAlive: true, onTranscript: (text) => drafts.push(text), onComplete: (text) => completed.push(text), onDiscard: () => { discarded += 1; }, onEnd: () => assert.fail("Persistent timeout"), onError: (reason) => assert.fail(reason) }));
  const recognition = RecognitionStub.latest;
  context.mock.timers.tick(180000);
  const result = (text: string) => ({ isFinal: true, 0: { transcript: text } });
  recognition.onresult?.({ resultIndex: 0, results: [result("Unsent destination Discard")] });
  assert.equal(discarded, 1);
  assert.equal(drafts.at(-1), "");
  recognition.onresult?.({ resultIndex: 1, results: [result("Unsent destination Discard"), result("Hitech City Submit")] });
  recognition.onresult?.({ resultIndex: 2, results: [result("Unsent destination Discard"), result("Hitech City Submit"), result("How far is it Send")] });
  assert.deepEqual(completed, ["Hitech City", "How far is it"]);
  assert.equal(recognition.aborted, false);
});

test("interruption discard resets speech state and forwards draft deletion", (context) => {
  let discards = 0;
  let speech = 0;
  const { recognition } = interruptionFixture(context, { keepAlive: true, playbackActive: () => false, onSpeech: () => { speech += 1; }, onDiscard: () => { discards += 1; }, onError: (message) => assert.fail(message) });
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Discard" } }] });
  recognition.onresult?.({ resultIndex: 1, results: [{ isFinal: true, 0: { transcript: "Discard" } }, { isFinal: false, 0: { transcript: "Next draft" } }] });
  assert.equal(discards, 1);
  assert.equal(speech, 2);
});

test("ordinary microphone input uses zero arguments on initial start and native restart", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
  const stop = startRecognition({ onTranscript: () => {}, onComplete: () => {}, onError: (reason) => assert.fail(reason), onEnd: () => {} });
  context.after(stop);
  const recognition = RecognitionStub.latest;
  assert.deepEqual(recognition.startArgumentCounts, [0]);
  recognition.onend?.();
  context.mock.timers.tick(150);
  assert.deepEqual(recognition.startArgumentCounts, [0, 0]);
});

for (const failure of ["TypeError", "NotSupportedError"]) {
  test(`a rejected microphone track reports a compatibility error without retrying unprocessed input: ${failure}`, (context) => {
    const errors: string[] = [];
    const error = new Error("Audio-track recognition unavailable");
    error.name = failure;
    class TrackRejectingRecognition extends RecognitionStub {
      start(audioTrack?: MediaStreamTrack) { super.start(audioTrack); throw error; }
    }
    mockBrowser(context, { window: { SpeechRecognition: TrackRejectingRecognition }, navigator: { language: "en-US" } });
    const audioTrack = { kind: "audio", readyState: "live" } as MediaStreamTrack;
    const stop = startRecognition({ audioTrack, onTranscript: () => {}, onError: (reason) => errors.push(reason), onEnd: () => assert.fail("Failure must not silently end") });
    context.after(stop);
    assert.deepEqual(errors, ["audio-track"]);
    assert.deepEqual(RecognitionStub.latest.startArgumentCounts, [1]);
    assert.equal(RecognitionStub.latest.audioTrack, audioTrack);
    assert.equal(RecognitionStub.latest.aborted, true);
  });
}

test("a failed native restart reports its startup error rather than silently ending", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const errors: string[] = [];
  class RestartRejectingRecognition extends RecognitionStub {
    start() {
      super.start();
      if (this.startArgumentCounts.length > 1) {
        const error = new Error("Recognition is already active");
        error.name = "InvalidStateError";
        throw error;
      }
    }
  }
  mockBrowser(context, { window: { SpeechRecognition: RestartRejectingRecognition }, navigator: { language: "en-US" } });
  const stop = startRecognition({ onTranscript: () => {}, onComplete: () => {}, onError: (reason) => errors.push(reason), onEnd: () => assert.fail("Failure must not silently end") });
  context.after(stop);
  RecognitionStub.latest.onend?.();
  context.mock.timers.tick(150);
  assert.deepEqual(errors, ["busy"]);
  assert.equal(RecognitionStub.latest.aborted, true);
});

for (const [browserError, expected] of [["audio-capture", "audio-capture"], ["language-not-supported", "language"]]) {
  test(`speech-service errors retain an actionable category: ${browserError}`, (context) => {
    const errors: string[] = [];
    mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
    const stop = startRecognition({ onTranscript: () => {}, onError: (reason) => errors.push(reason), onEnd: () => {} });
    context.after(stop);
    RecognitionStub.latest.onerror?.({ error: browserError });
    assert.deepEqual(errors, [expected]);
  });
}

test("speech capture retains final fragments and subsequent words until the user finishes", (context) => {
  mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
  const transcripts: { text: string; final: boolean }[] = [];
  let endings = 0;
  const stop = startRecognition({ onTranscript: (text, final) => transcripts.push({ text, final }), onError: () => assert.fail("Unexpected recognition error"), onEnd: () => { endings += 1; } });
  context.after(stop);
  const recognition = RecognitionStub.latest;
  assert.equal(recognition.continuous, true);
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Can you check are there any" } }] });
  recognition.onresult?.({ resultIndex: 1, results: [{ isFinal: true, 0: { transcript: "Can you check are there any" } }, { isFinal: false, 0: { transcript: "restaurants along my route" } }] });
  assert.equal(endings, 0);
  assert.equal(recognition.aborted, false);
  assert.deepEqual(transcripts.at(-1), { text: "Can you check are there any restaurants along my route", final: false });
  stop();
  assert.equal(recognition.aborted, true);
});

test("cancelled recognition ignores late transcript and end events", (context) => {
  mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
  let received = 0;
  const stop = startRecognition({ onTranscript: () => { received += 1; }, onError: () => {}, onEnd: () => { received += 1; } });
  const lateResult = RecognitionStub.latest.onresult;
  stop();
  lateResult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "late speech" } }] });
  assert.equal(received, 0);
});

class UtteranceStub {
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 0;
  voice: { lang: string; localService: boolean } | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(public readonly text: string) {}
}

test("spoken replies select clear English audio and preserve decimal distances between chunks", (context) => {
  const utterances: UtteranceStub[] = [];
  const englishVoice = { lang: "en-US", localService: true };
  const synthesis = { cancel: () => {}, resume: () => {}, getVoices: () => [{ lang: "fr-FR", localService: true }, englishVoice], speak: (utterance: UtteranceStub) => utterances.push(utterance) };
  mockBrowser(context, { window: { speechSynthesis: synthesis }, SpeechSynthesisUtterance: UtteranceStub, navigator: { language: "en-US" } });
  let finished = 0;
  const stop = speakResponse("The route is 12.4 km. Arrival is about 20 minutes.", () => { finished += 1; });
  context.after(stop);
  assert.equal(utterances[0].text, "The route is 12.4 km.");
  assert.equal(utterances[0].voice, englishVoice);
  assert.equal(utterances[0].volume, 1);
  assert.equal(utterances[0].rate, 0.9);
  utterances[0].onend?.();
  assert.equal(utterances.length, 2);
  utterances[1].onend?.();
  assert.equal(finished, 1);
});

test("interrupted playback releases its responding state and cannot queue another chunk", (context) => {
  const utterances: UtteranceStub[] = [];
  mockBrowser(context, { window: { speechSynthesis: { cancel: () => {}, resume: () => {}, getVoices: () => [], speak: (utterance: UtteranceStub) => utterances.push(utterance) } }, SpeechSynthesisUtterance: UtteranceStub, navigator: { language: "en-US" } });
  let finished = 0;
  const stop = speakResponse("First sentence. Second sentence.", () => { finished += 1; });
  context.after(stop);
  utterances[0].onerror?.({ error: "interrupted" });
  assert.equal(finished, 1);
  utterances[0].onend?.();
  assert.equal(utterances.length, 1);
});

function interruptionFixture(context: TestContext, callbacks: Parameters<typeof startVoiceInterruption>[0]) {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const utterances: UtteranceStub[] = [];
  mockBrowser(context, {
    navigator: { language: "en-US" },
    window: { SpeechRecognition: RecognitionStub, speechSynthesis: { cancel: () => {}, resume: () => {}, getVoices: () => [], speak: (utterance: UtteranceStub) => utterances.push(utterance) } },
    SpeechSynthesisUtterance: UtteranceStub,
  });
  const stop = startVoiceInterruption(callbacks);
  context.after(stop);
  return { recognition: RecognitionStub.latest, utterances, stop };
}

test("interruption uses an echo-cancelled microphone track during active playback and releases it on opt-out", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const utterances: UtteranceStub[] = [];
  let constraints: MediaStreamConstraints | undefined;
  let released = 0;
  let ready = 0;
  const track = { readyState: "live", getSettings: () => ({ echoCancellation: true }), stop: () => { released += 1; } } as unknown as MediaStreamTrack;
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  mockBrowser(context, {
    navigator: { language: "en-US", mediaDevices: { getUserMedia: async (request: MediaStreamConstraints) => { constraints = request; return stream; } } },
    window: { SpeechRecognition: RecognitionStub, speechSynthesis: { cancel: () => {}, resume: () => {}, getVoices: () => [], speak: (utterance: UtteranceStub) => utterances.push(utterance) } },
    SpeechSynthesisUtterance: UtteranceStub,
  });
  const stopPlayback = speakResponse("The route preview is ready. Here are the details.", () => assert.fail("Cancelled reply must not finish"));
  context.after(stopPlayback);
  const stop = startMicrophoneInterruption({
    spokenText: "The route preview is ready. Here are the details.",
    onReady: () => { ready += 1; }, onSpeech: stopPlayback, onError: (message) => assert.fail(message),
  });
  context.after(stop);
  await Promise.resolve();
  assert.deepEqual(constraints, { audio: { echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true }, channelCount: { ideal: 1 } }, video: false });
  const recognition = RecognitionStub.latest;
  assert.equal(recognition.audioTrack, track);
  recognition.onstart?.();
  assert.equal(ready, 1);
  recognition.onend?.();
  context.mock.timers.tick(150);
  assert.equal(recognition.audioTrack, track);
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "Please stop talking" } }] });
  assert.equal(utterances[0].onend, null);
  const lateResult = recognition.onresult;
  stop();
  lateResult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "How far is it Submit" } }] });
  assert.equal(recognition.aborted, true);
  assert.equal(released, 1);
});

test("disabling during permission startup releases the late stream without starting recognition", async (context) => {
  let resolvePermission!: (stream: MediaStream) => void;
  let released = 0;
  const previous = RecognitionStub.latest;
  const track = { stop: () => { released += 1; } } as unknown as MediaStreamTrack;
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  mockBrowser(context, {
    navigator: { mediaDevices: { getUserMedia: () => new Promise<MediaStream>((resolve) => { resolvePermission = resolve; }) } },
    window: { SpeechRecognition: RecognitionStub },
  });
  const stop = startMicrophoneInterruption({ onReady: () => assert.fail("Disabled capture must not become ready"), onSpeech: () => assert.fail("Disabled capture must not interrupt"), onError: () => assert.fail("Disabled capture must not report late errors") });
  stop();
  resolvePermission(stream);
  await Promise.resolve();
  assert.equal(released, 1);
  assert.equal(RecognitionStub.latest, previous);
});

test("microphones without active echo cancellation release capture and visibly use compatibility input", async (context) => {
  let released = 0;
  const errors: string[] = [];
  const warnings: string[] = [];
  const track = { readyState: "live", getSettings: () => ({ echoCancellation: false }), stop: () => { released += 1; } } as unknown as MediaStreamTrack;
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  mockBrowser(context, { navigator: { language: "en-US", mediaDevices: { getUserMedia: async () => stream } }, window: { SpeechRecognition: RecognitionStub } });
  context.after(startMicrophoneInterruption({ onSpeech: () => {}, onCaptureFallback: (message) => warnings.push(message), onError: (message) => errors.push(message) }));
  await Promise.resolve();
  assert.deepEqual(errors, []);
  assert.match(warnings[0], /compatibility mode/);
  assert.equal(released, 1);
  assert.deepEqual(RecognitionStub.latest.startArgumentCounts, [0]);
});

test("microphone tracks are released when the interrupted request is submitted", async (context) => {
  let released = 0;
  const completed: string[] = [];
  const track = { readyState: "live", getSettings: () => ({ echoCancellation: true }), stop: () => { released += 1; } } as unknown as MediaStreamTrack;
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  mockBrowser(context, { navigator: { language: "en-US", mediaDevices: { getUserMedia: async () => stream } }, window: { SpeechRecognition: RecognitionStub } });
  const stop = startMicrophoneInterruption({ onSpeech: () => {}, onComplete: (text) => completed.push(text), onError: (message) => assert.fail(message) });
  context.after(stop);
  await Promise.resolve();
  RecognitionStub.latest.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "How far is it Submit" } }] });
  assert.deepEqual(completed, ["How far is it"]);
  assert.equal(released, 1);
});

test("repeated spoken choices retain the final choice through a playback prefix", (context) => {
  const completed: string[] = [];
  const playback = "Option one Charminar Monument. Option two HITECH City. These matches are nearest first from your starting location.";
  const { recognition } = interruptionFixture(context, {
    optionCount: 2, spokenText: playback, onSpeech: () => {}, onComplete: (text) => completed.push(text), onError: (message) => assert.fail(message),
  });
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: `${playback} option one option one option two Submit` } }] });
  assert.deepEqual(completed, ["option 1 option 1 option 2"]);
  assert.equal(lastOptionIndex(completed[0]), 1);
});

test("playback fragments remain excluded after interruption without losing the user's later choice", (context) => {
  const completed: string[] = [];
  const transcripts: string[] = [];
  const { recognition } = interruptionFixture(context, {
    optionCount: 2, spokenText: "Option one Charminar Monument. Option two HITECH City.",
    onSpeech: () => {}, onTranscript: (text) => transcripts.push(text), onComplete: (text) => completed.push(text), onError: (message) => assert.fail(message),
  });
  const first = { isFinal: true, 0: { transcript: "Choose option one" } };
  const echo = { isFinal: true, 0: { transcript: "Option two HITECH City" } };
  const last = { isFinal: true, 0: { transcript: "Choose option two" } };
  recognition.onresult?.({ resultIndex: 0, results: [first] });
  recognition.onresult?.({ resultIndex: 1, results: [first, echo] });
  recognition.onresult?.({ resultIndex: 2, results: [first, echo, last] });
  assert.deepEqual(completed, []);
  recognition.onresult?.({ resultIndex: 3, results: [first, echo, last, { isFinal: true, 0: { transcript: "Submit" } }] });
  assert.deepEqual(completed, ["Choose option one Choose option two"]);
  assert.ok(transcripts.every((text) => !text.includes("HITECH City")));
  assert.equal(lastOptionIndex(completed[0]), 1);
});

test("interruption readiness follows the browser start event and is reported only once", (context) => {
  let ready = 0;
  const { recognition } = interruptionFixture(context, {
    onReady: () => { ready += 1; }, onSpeech: () => {}, onError: () => assert.fail("Unexpected interruption error"),
  });
  assert.equal(ready, 0);
  recognition.onstart?.();
  assert.equal(ready, 1);
  recognition.onend?.();
  context.mock.timers.tick(150);
  recognition.onstart?.();
  context.mock.timers.tick(2500);
  assert.equal(ready, 1);
  assert.equal(recognition.aborted, false);
});

test("a microphone that never becomes ready reports one bounded manual fallback", (context) => {
  const errors: string[] = [];
  const { recognition } = interruptionFixture(context, {
    onReady: () => assert.fail("Microphone must not become ready"), onSpeech: () => assert.fail("Timed-out capture must not interrupt"), onError: (message) => errors.push(message),
  });
  const lateStart = recognition.onstart;
  context.mock.timers.tick(2500);
  assert.equal(recognition.aborted, true);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /did not become ready/);
  lateStart?.();
  context.mock.timers.tick(90000);
  assert.equal(errors.length, 1);
});

test("stopping microphone warmup prevents a late ready callback or timeout", (context) => {
  const { recognition, stop } = interruptionFixture(context, {
    onReady: () => assert.fail("Cancelled warmup must not start playback"), onSpeech: () => {}, onError: () => assert.fail("Cancelled warmup must not report a timeout"),
  });
  const lateStart = recognition.onstart;
  stop();
  lateStart?.();
  context.mock.timers.tick(90000);
  assert.equal(recognition.aborted, true);
});

test("sound events and empty or noise-only transcripts do not interrupt playback", (context) => {
  const speech: string[] = [];
  const { recognition } = interruptionFixture(context, { onSpeech: (text) => speech.push(text), onError: () => assert.fail("Unexpected interruption error") });
  recognition.onspeechstart?.();
  recognition.onspeechend?.();
  recognition.onerror?.({ error: "no-speech" });
  const results: StubResultEvent["results"] = [];
  for (const text of ["", "   ", "!!!", "um", "[background noise]", "[music]"]) {
    results.push({ isFinal: true, 0: { transcript: text } });
    recognition.onresult?.({ resultIndex: results.length - 1, results });
  }
  context.mock.timers.tick(10000);
  assert.deepEqual(speech, []);
  assert.equal(recognition.aborted, false);
  recognition.onresult?.({ resultIndex: results.length, results: [...results, { isFinal: true, 0: { transcript: "choose option two" } }] });
  assert.deepEqual(speech, ["choose option two"]);
});

for (const phrase of ["Choose option 2 Send", "विकल्प दो सबमिट"]) {
  test(`a current address choice interrupts with its control word and no wake phrase: ${phrase}`, (context) => {
    const speech: string[] = [];
    const completed: string[] = [];
    const { recognition } = interruptionFixture(context, {
      optionCount: 2, spokenText: "Option one: Charminar Monument. Option two: HITECH City. Say the option number.",
      onSpeech: (text) => speech.push(text), onComplete: (text) => completed.push(text), onError: () => assert.fail("Unexpected interruption error"),
    });
    const request = voiceRequest(phrase);
    assert.ok(request);
    const first = { isFinal: true, 0: { transcript: request } };
    recognition.onresult?.({ resultIndex: 0, results: [first] });
    assert.deepEqual(speech, [request]);
    recognition.onend?.();
    context.mock.timers.tick(150);
    const marker = phrase.slice(request.length).trim();
    recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: marker } }] });
    assert.deepEqual(speech, [request]);
    assert.deepEqual(completed, [request]);
    assert.equal(recognition.aborted, true);
  });
}

test("address interruption ignores playback echo", (context) => {
  const { recognition } = interruptionFixture(context, {
    optionCount: 2, spokenText: "Option two: HITECH City. Say the option number.",
    onSpeech: () => assert.fail("Echo must not interrupt"),
    onComplete: () => assert.fail("Echo must not submit"), onError: () => assert.fail("Unexpected interruption error"),
  });
  const results: StubResultEvent["results"] = [];
  for (const text of ["Option two HITECH City", "Say the option number"]) {
    results.push({ isFinal: true, 0: { transcript: text } });
    recognition.onresult?.({ resultIndex: results.length - 1, results });
  }
  assert.equal(recognition.aborted, false);
});

test("an address selection joined to a known playback prefix still interrupts and submits only the selection", (context) => {
  const speech: string[] = [];
  const completed: string[] = [];
  const playback = "Option one Charminar Monument. Option two HITECH City. These matches are nearest first from your starting location.";
  const { recognition } = interruptionFixture(context, {
    optionCount: 2, spokenText: playback,
    onSpeech: (text) => speech.push(text), onComplete: (text) => completed.push(text), onError: () => assert.fail("Unexpected interruption error"),
  });
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: `${playback} Choose option two Submit` } }] });
  assert.deepEqual(speech, ["choose option 2"]);
  assert.deepEqual(completed, ["choose option 2"]);
});

test("ordinary speech interrupts without a pending address list or wake phrase", (context) => {
  const completed: string[] = [];
  const speech: string[] = [];
  const { recognition } = interruptionFixture(context, {
    onSpeech: (text) => speech.push(text), onComplete: (text) => completed.push(text), onError: () => assert.fail("Unexpected interruption error"),
  });
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "How far is my destination Submit" } }] });
  assert.deepEqual(speech, ["How far is my destination"]);
  assert.deepEqual(completed, ["How far is my destination"]);
  assert.equal(recognition.aborted, true);
});

test("ordinary interim speech stops playback but never submits interim text", (context) => {
  const speech: string[] = [];
  const completed: string[] = [];
  let stopPlayback = () => {};
  const { recognition, utterances } = interruptionFixture(context, {
    spokenText: "The route preview is ready. Here is the rest of the reply.",
    onSpeech: (text) => { speech.push(text); stopPlayback(); },
    onComplete: (text) => completed.push(text), onError: () => assert.fail("Unexpected interruption error"),
  });
  stopPlayback = speakResponse("The route preview is ready. Here is the rest of the reply.", () => assert.fail("Cancelled playback must not resume"));
  context.after(() => stopPlayback());
  const lateEnd = utterances[0].onend;
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "choose option two Send" } }] });
  assert.deepEqual(speech, ["choose option two Send"]);
  assert.equal(utterances[0].onend, null);
  lateEnd?.();
  assert.equal(utterances.length, 1);
  assert.deepEqual(completed, []);
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "choose option two Send" } }] });
  assert.deepEqual(speech, ["choose option two Send"]);
  assert.deepEqual(completed, ["choose option two"]);
});

test("disabling interruption listening ignores late recognized speech", (context) => {
  let detected = 0;
  const { recognition, stop } = interruptionFixture(context, { onSpeech: () => { detected += 1; }, onError: () => assert.fail("Unexpected interruption error") });
  const lateResult = recognition.onresult;
  stop();
  lateResult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Hey Navigator choose option two Navigator Send" } }] });
  context.mock.timers.tick(1000);
  assert.equal(detected, 0);
  assert.equal(recognition.aborted, true);
});

test("a natural request split into finalized segments retains its opening words", (context) => {
  const speech: string[] = [];
  const completed: string[] = [];
  const { recognition } = interruptionFixture(context, { onSpeech: (text) => speech.push(text), onComplete: (text) => completed.push(text), onError: () => assert.fail("Unexpected interruption error") });
  const first = { isFinal: true, 0: { transcript: "How far" } };
  const second = { isFinal: true, 0: { transcript: "is my" } };
  recognition.onresult?.({ resultIndex: 0, results: [first] });
  assert.deepEqual(speech, ["How far"]);
  recognition.onresult?.({ resultIndex: 1, results: [first, second] });
  assert.deepEqual(speech, ["How far"]);
  recognition.onresult?.({ resultIndex: 2, results: [first, second, { isFinal: true, 0: { transcript: "destination Send" } }] });
  assert.deepEqual(completed, ["How far is my destination"]);
});

test("an incomplete address survives a bounded native restart without losing its first word", (context) => {
  const completed: string[] = [];
  const { recognition } = interruptionFixture(context, { onSpeech: () => {}, onComplete: (text) => completed.push(text), onError: () => assert.fail("Unexpected interruption error") });
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Hey" } }] });
  recognition.onend?.();
  context.mock.timers.tick(150);
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Navigator option two Send" } }] });
  assert.deepEqual(completed, ["option two"]);
});

test("a known playback prefix joined to the address phrase in one result is excluded", (context) => {
  const speech: string[] = [];
  const completed: string[] = [];
  const { recognition } = interruptionFixture(context, {
    spokenText: "Option one is Charminar Monument. Option two is HITECH City.",
    onSpeech: (text) => speech.push(text), onComplete: (text) => completed.push(text), onError: () => assert.fail("Unexpected interruption error"),
  });
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Option one is Charminar Monument Hey Navigator choose option two Send" } }] });
  assert.deepEqual(speech, ["choose option two"]);
  assert.deepEqual(completed, ["choose option two"]);
});

test("unrelated or negated speech before the address phrase is not silently discarded", (context) => {
  const completed: string[] = [];
  const { recognition } = interruptionFixture(context, {
    spokenText: "Option one is Charminar Monument.",
    onSpeech: () => {}, onComplete: (text) => completed.push(text), onError: () => assert.fail("Unexpected interruption error"),
  });
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Do not do this Hey Navigator confirm route Send" } }] });
  assert.deepEqual(completed, ["Do not do this Hey Navigator confirm route"]);
});

test("a retracted interim wake phrase does not discard the final natural request", (context) => {
  const completed: string[] = [];
  const { recognition } = interruptionFixture(context, { onSpeech: () => {}, onComplete: (text) => completed.push(text), onError: () => assert.fail("Unexpected interruption error") });
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "Hey Navigator" } }] });
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Confirm route Send" } }] });
  assert.deepEqual(completed, ["Confirm route"]);
  assert.equal(recognition.aborted, true);
});

test("interruption listening cannot keep an idle recognizer open past ninety seconds", (context) => {
  const errors: string[] = [];
  const { recognition } = interruptionFixture(context, { onSpeech: () => assert.fail("Unexpected interruption"), onError: (message) => errors.push(message) });
  context.mock.timers.tick(90000);
  assert.equal(recognition.aborted, true);
  assert.match(errors[0], /without confirmed speech/);
});

test("unsupported interruption capture reports a manual fallback", (context) => {
  const errors: string[] = [];
  mockBrowser(context, { window: {}, navigator: {} });
  startVoiceInterruption({ onSpeech: () => assert.fail("Unexpected interruption"), onError: (message) => errors.push(message) });
  assert.match(errors[0], /Stop speaking/);
});

test("denied interruption listening reports the permission error and a manual fallback", (context) => {
  const errors: string[] = [];
  const { recognition } = interruptionFixture(context, { onSpeech: () => assert.fail("Unexpected interruption"), onError: (message) => errors.push(message) });
  recognition.onerror?.({ error: "not-allowed" });
  assert.match(errors[0], /permission/i);
  assert.match(errors[0], /Stop speaking/);
});

for (const language of ["en-IN", "hi-IN"] as const) {
  test(`${language} playback echo is discarded without interrupting or submitting`, (context) => {
    const english = language === "en-IN";
    const echo = english ? "Option one Charminar Monument" : "विकल्प एक चारमीनार स्मारक";
    const spokenText = english ? "Option 1: Charminar Monument. Say the option number followed by Nova Submit." : "विकल्प १: चारमीनार स्मारक। विकल्प के नंबर के बाद नोवा सबमिट बोलिए।";
    const speech: string[] = [];
    const completed: string[] = [];
    const { recognition } = interruptionFixture(context, { spokenText, language, onSpeech: (text) => speech.push(text), onComplete: (text) => completed.push(text), onError: () => assert.fail("Unexpected interruption error") });
    assert.equal(recognition.lang, language);
    const first = { isFinal: true, 0: { transcript: echo } };
    const second = { isFinal: true, 0: { transcript: english ? "Say the option number followed by Nova Submit" : "विकल्प के नंबर के बाद नोवा सबमिट बोलिए" } };
    recognition.onresult?.({ resultIndex: 0, results: [first] });
    recognition.onresult?.({ resultIndex: 1, results: [first, second] });
    assert.deepEqual(speech, []);
    assert.deepEqual(completed, []);
    assert.equal(recognition.aborted, false);
    const request = english ? "Choose option two" : "दूसरा विकल्प चुनो";
    recognition.onresult?.({ resultIndex: 2, results: [first, second, { isFinal: true, 0: { transcript: `${english ? "Hey Navigator" : "हे नेविगेटर"} ${request} ${english ? "Navigator Send" : "नेविगेटर सेंड"}` } }] });
    assert.deepEqual(speech, [request]);
    assert.deepEqual(completed, [request]);
  });
}

test("confirmed interruption keeps its first words and the same recorder until explicit submission", (context) => {
  const completed: string[] = [];
  const transcripts: string[] = [];
  let stopPlayback = () => {};
  const { recognition, utterances } = interruptionFixture(context, {
    spokenText: "Option one has a long address. Option two has another long address.",
    onSpeech: () => stopPlayback(),
    onTranscript: (text) => transcripts.push(text),
    onComplete: (text) => completed.push(text),
    onError: () => assert.fail("Unexpected interruption error"),
  });
  stopPlayback = speakResponse("Option one has a long address. Option two has another long address.", () => assert.fail("Cancelled playback must not restart a follow-up"));
  context.after(() => stopPlayback());
  const lateEnd = utterances[0].onend;
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Hey Navigator Choose option two" } }] });
  assert.equal(utterances[0].onend, null);
  lateEnd?.();
  assert.equal(utterances.length, 1);
  assert.strictEqual(RecognitionStub.latest, recognition);
  assert.equal(transcripts.at(-1), "Choose option two");
  assert.deepEqual(completed, []);
  recognition.onresult?.({ resultIndex: 1, results: [{ isFinal: true, 0: { transcript: "Hey Navigator Choose option two" } }, { isFinal: true, 0: { transcript: "Navigator Send" } }] });
  assert.deepEqual(completed, ["Choose option two"]);
});

test("recognition omissions in a long spoken reply do not trigger an interruption", (context) => {
  const { recognition } = interruptionFixture(context, {
    spokenText: "I found five destination matches nearest first from your starting location. Say the option number followed by Nova Submit.",
    onSpeech: () => assert.fail("Playback echo must not interrupt"),
    onComplete: () => assert.fail("Playback echo must not submit"),
    onError: () => assert.fail("Unexpected interruption error"),
  });
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "I found five matches nearest first from your location say the option number followed by Nova Submit" } }] });
  assert.equal(recognition.aborted, false);
});

test("an echoed finalized segment is excluded when user speech arrives in the same event", (context) => {
  const speech: string[] = [];
  const completed: string[] = [];
  const { recognition } = interruptionFixture(context, {
    spokenText: "Option one is Charminar Monument.",
    onSpeech: (text) => speech.push(text), onComplete: (text) => completed.push(text), onError: () => assert.fail("Unexpected interruption error"),
  });
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Option one is Charminar Monument" } }, { isFinal: true, 0: { transcript: "Hey Navigator Choose option two Navigator Send" } }] });
  assert.deepEqual(speech, ["Choose option two"]);
  assert.deepEqual(completed, ["Choose option two"]);
});

for (const phrase of ["yes Submit", "yes Navigator Send", "हाँ नेविगेटर सेंड", "2 Nova Submit"]) {
  test(`short confirmed interruption retains the request: ${phrase}`, (context) => {
    const completed: string[] = [];
    const { recognition } = interruptionFixture(context, {
      spokenText: "Say confirm route or cancel, followed by Nova Submit.",
      onSpeech: () => {}, onComplete: (text) => completed.push(text), onError: () => assert.fail("Unexpected interruption error"),
    });
    recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: `Hey Navigator ${phrase}` } }] });
    assert.deepEqual(completed, [voiceRequest(phrase)]);
  });
}

test("the addressed interruption phrase alone stops playback without submitting a request", (context) => {
  const speech: string[] = [];
  const completed: string[] = [];
  const { recognition } = interruptionFixture(context, {
    onSpeech: (text) => speech.push(text), onComplete: (text) => completed.push(text), onError: () => assert.fail("Unexpected interruption error"),
  });
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Hey Navigator" } }] });
  assert.deepEqual(speech, [""]);
  assert.deepEqual(completed, []);
  recognition.onend?.();
  context.mock.timers.tick(150);
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "option two Navigator Send" } }] });
  assert.deepEqual(completed, ["option two"]);
});

test("interruption and send markers cannot submit an empty addressed request", (context) => {
  const completed: string[] = [];
  const { recognition } = interruptionFixture(context, { onSpeech: () => {}, onComplete: (text) => completed.push(text), onError: () => assert.fail("Unexpected interruption error") });
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Hey Navigator Navigator Send" } }] });
  assert.deepEqual(completed, []);
  assert.equal(recognition.aborted, true);
});

test("only a leading complete interruption phrase addresses Nova", () => {
  assert.equal(voiceInterruptionRequest("Hey Navigator, option two"), "option two");
  assert.equal(voiceInterruptionRequest("हे नेविगेटर विकल्प दो"), "विकल्प दो");
  assert.equal(voiceInterruptionRequest("Hey Navigator"), "");
  for (const text of ["Navigator", "hey", "yes", "Choose option two", "Say Hey Navigator", "Hey Navigators option two"]) assert.equal(voiceInterruptionRequest(text), null);
});

test("outgoing control phrase instructions cannot act as microphone commands", (context) => {
  const utterances: UtteranceStub[] = [];
  mockBrowser(context, { window: { speechSynthesis: { cancel: () => {}, resume: () => {}, getVoices: () => [], speak: (utterance: UtteranceStub) => utterances.push(utterance) } }, SpeechSynthesisUtterance: UtteranceStub, navigator: { language: "en-US" } });
  for (const text of ["Hey Navigator yes Send", "Hey Navigator yes Submit", "Hey Navigator yes Navigator Send", "Hey Navigator option two Nova Submit", "हे नेविगेटर हाँ सेंड", "हे नेविगेटर हाँ सबमिट", "हे नेविगेटर हाँ नेविगेटर सेंड", "हे नेविगेटर हाँ नोवा सबमिट"]) {
    const spoken = prepareSpokenText(text);
    assert.equal(voiceInterruptionRequest(spoken), null);
    assert.equal(voiceRequest(spoken), null);
    assert.equal(prepareSpokenText(spoken), spoken);
    const stop = speakResponse(text, () => {});
    assert.equal(utterances.at(-1)?.text, spoken);
    stop();
  }
});

test("the exact spoken starting-location sentence produces a complete structured route request", async () => {
  const text = "Select Starting location, location as current location and Target location as Charminar.";
  assert.deepEqual(routeInstruction(text), { originQuery: "current location", query: "Charminar" });
  const intent = await new IntentProcessor().process({ text, context: emptyContext(), session: emptySession() });
  assert.equal(intent.type, "PLAN_ROUTE");
  assert.equal(intent.originQuery, "current location");
  assert.equal(intent.query, "Charminar");
});

test("a current-location route can be planned and confirmed entirely through conversation", async (context) => {
  const routeOrigin = { ...origin, name: "Main origin entrance near Central Square, London Greater London England United Kingdom" };
  const routeDestination = { ...destination, name: "Charminar Monument Near Laad Bazaar, Hyderabad Telangana India" };
  mockServices(context, undefined, [routeDestination]);
  const navigation = new NavigationController(async () => structuredClone(fixtureRoute));
  let locationRequests = 0;
  const engine = new ConversationEngine(navigation, {
    onPlaces: () => {}, onSelectPlace: () => {}, onDetours: () => {}, getReferenceLocation: () => null,
    getCurrentLocation: async () => { locationRequests += 1; return routeOrigin; },
  });
  const reply = await engine.send("Select Starting location, location as current location and Target location as Charminar.");
  assert.equal(locationRequests, 1);
  assert.equal(engine.getSnapshot().pendingOrigin?.id, origin.id);
  assert.equal(engine.getSnapshot().pendingDestination?.id, destination.id);
  assert.equal(navigation.getSnapshot().route, null);
  assert.match(reply, /say confirm route/i);
  const proposal = engine.getSnapshot().messages.at(-1);
  assert.ok(proposal?.role === "assistant");
  for (const location of [routeOrigin, routeDestination]) {
    assert.ok(proposal.text.includes(location.name));
    assert.ok(proposal.spokenText?.includes(location.name.split(/\s+/u).slice(0, 5).join(" ")));
    assert.ok(!proposal.spokenText?.includes(location.name));
  }
  await engine.send("Confirm route.");
  assert.equal(navigation.getSnapshot().origin?.id, origin.id);
  assert.equal(navigation.getSnapshot().destination?.id, destination.id);
  assert.equal(navigation.getSnapshot().route?.distanceMeters, fixtureRoute.distanceMeters);
  assert.equal(navigation.getSnapshot().origin?.name, routeOrigin.name);
  assert.equal(navigation.getSnapshot().destination?.name, routeDestination.name);
  const ready = engine.getSnapshot().messages.at(-1);
  assert.ok(ready?.role === "assistant");
  assert.ok(ready.spokenText?.includes("Charminar Monument Near Laad Bazaar,"));
  assert.ok(!ready.spokenText?.includes(routeDestination.name));
});

test("an explicit spoken address choice confirms the requested route without another prompt", async (context) => {
  const otherDestination = { ...destination, id: "test:other", name: "Other test address" };
  mockServices(context, undefined, [destination, otherDestination]);
  const navigation = new NavigationController(async () => structuredClone(fixtureRoute));
  const engine = new ConversationEngine(navigation, { onPlaces: () => {}, onSelectPlace: () => {}, onDetours: () => {}, getReferenceLocation: () => null, getCurrentLocation: async () => origin });
  await engine.send("Plan a route from current location to Charminar");
  assert.equal(engine.getSnapshot().pendingLocationChoices.length, 2);
  const reply = await engine.send("Option two. Submit.");
  assert.equal(navigation.getSnapshot().destination?.id, otherDestination.id);
  assert.ok(navigation.getSnapshot().route);
  assert.equal(engine.getSnapshot().pendingDestination, null);
  assert.equal(engine.getSnapshot().pendingLocationChoices.length, 0);
  assert.doesNotMatch(reply, /say confirm|change your destination|plan a driving route/i);
});

for (const [selection, expected] of [
  ["Option one option one option two Submit", 1],
  ["Option 2 option 2 option 1 Submit", 0],
  ["विकल्प एक विकल्प एक विकल्प दो सबमिट", 1],
  [Array(80).fill("option one").join(" ") + " option two Submit", 1],
] as const) {
  test(`pending address selection uses the last repeated option: ${selection.slice(0, 65)}`, async (context) => {
    const otherDestination = { ...destination, id: "test:other", name: "Other test address" };
    mockServices(context, undefined, [destination, otherDestination]);
    let routes = 0;
    const navigation = new NavigationController(async () => { routes += 1; return structuredClone(fixtureRoute); });
    const engine = new ConversationEngine(navigation, { onPlaces: () => {}, onSelectPlace: () => {}, onDetours: () => {}, getReferenceLocation: () => null, getCurrentLocation: async () => origin });
    await engine.send("Plan a route from current location to Charminar");
    const selected = engine.getSnapshot().pendingLocationChoices[expected];
    await engine.send(selection);
    assert.equal(navigation.getSnapshot().destination?.id, selected.id);
    assert.equal(routes, 1);
    assert.equal(engine.getSnapshot().pendingLocationChoices.length, 0);
  });
}

test("an invalid final option never falls back to an earlier valid selection", async (context) => {
  mockServices(context, undefined, [destination, { ...destination, id: "test:other", name: "Other test address" }]);
  const navigation = await controllerFixture();
  const engine = engineFixture(navigation);
  await engine.send("Destination HITECH City");
  const choices = engine.getSnapshot().pendingLocationChoices;
  const previous = navigation.getSnapshot();
  for (const text of ["Option one option 99 Submit", "Option two option 0 Submit"]) {
    await assert.rejects(() => engine.send(text), /not in the current destination choices/);
    assert.strictEqual(navigation.getSnapshot(), previous);
    assert.deepEqual(engine.getSnapshot().pendingLocationChoices, choices);
  }
});

test("address choices remain usable beyond five minutes and survive informational or ambiguous replies", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-30T00:00:00Z") });
  const otherDestination = { ...destination, id: "test:other", name: "Other test address" };
  mockServices(context, undefined, [destination, otherDestination]);
  const navigation = await controllerFixture();
  const previous = navigation.getSnapshot();
  const engine = engineFixture(navigation);
  await engine.send("Destination HITECH City.");
  const choices = engine.getSnapshot().pendingLocationChoices;
  context.mock.timers.tick(6 * 60 * 1000);
  for (const text of ["How far is my destination?", "Tell me about option two", "Option two?", "2?", "दो?", "Option one or option two", "Option one and option two", "Don't choose option two"]) {
    await engine.send(text);
    assert.deepEqual(engine.getSnapshot().pendingLocationChoices, choices, text);
    assert.strictEqual(navigation.getSnapshot(), previous, text);
  }
  await assert.rejects(() => engine.chooseLocation(9), /not in the current destination choices/);
  assert.deepEqual(engine.getSnapshot().pendingLocationChoices, choices);
  await engine.chooseLocation(1);
  assert.equal(navigation.getSnapshot().destination?.id, otherDestination.id);
  assert.equal(engine.getSnapshot().pendingDestination, null);
  await assert.rejects(() => engine.chooseLocation(1), /not in the current destination choices/);
});

test("a single-result proposal does not expire while the microphone window ends", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-30T00:00:00Z") });
  mockServices(context, undefined, [{ ...destination, id: "test:retained", name: "Retained destination" }]);
  const navigation = await controllerFixture();
  const engine = engineFixture(navigation);
  await engine.send("Destination HITECH City.");
  context.mock.timers.tick(6 * 60 * 1000);
  await engine.send("How far is my destination?");
  assert.equal(engine.getSnapshot().pendingDestination?.id, "test:retained");
  await engine.send("Confirm destination. Submit.");
  assert.equal(navigation.getSnapshot().destination?.id, "test:retained");
});

for (const invalidation of ["cancel", "session clear", "route change"] as const) {
  test(`retained address choices cannot be selected after ${invalidation}`, async (context) => {
    mockServices(context, undefined, [destination, { ...destination, id: "test:other", name: "Other destination" }]);
    const navigation = await controllerFixture();
    const engine = engineFixture(navigation);
    await engine.send("Destination HITECH City.");
    if (invalidation === "cancel") engine.cancel();
    else if (invalidation === "session clear") engine.resetNavigationContext();
    else await navigation.execute({ type: "SET_ROUTE", origin, destination });
    const previous = navigation.getSnapshot();
    await assert.rejects(() => engine.chooseLocation(0), /not in the current destination choices/);
    assert.strictEqual(navigation.getSnapshot(), previous);
  });
}

for (const language of ["en", "hi"] as const) {
  test(`${language} destination options retain full addresses but speak only the option prompt`, async (context) => {
    const locations: Location[] = [
      { ...destination, id: "test:long-one", name: language === "hi" ? "चारमीनार स्मारक लाड बाज़ार के पास हैदराबाद तेलंगाना भारत" : "Charminar\tMonument  Near\nLaad Bazaar, Hyderabad Telangana India" },
      { ...destination, id: "test:long-two", name: language === "hi" ? "चारमीनार बाज़ार मक्का मस्जिद के पास हैदराबाद तेलंगाना भारत" : "Charminar Market Near Mecca Masjid, Hyderabad Telangana India" },
      { ...destination, id: "test:short", name: language === "hi" ? "चारमीनार" : "Charminar" },
    ];
    mockServices(context, undefined, locations);
    const navigation = await controllerFixture();
    const previous = navigation.getSnapshot();
    const engine = engineFixture(navigation);
    engine.setLanguage(language);
    const response = await engine.send(language === "hi" ? "मुझे चारमीनार ले चलो" : "Target location Charminar.");
    const message = engine.getSnapshot().messages.at(-1);
    assert.ok(message?.role === "assistant");
    assert.equal(message.text, response);
    assert.ok(message.spokenText);
    for (const location of locations) assert.ok(response.includes(location.name));
    assert.deepEqual(engine.getSnapshot().pendingLocationChoices, locations);
    assert.strictEqual(navigation.getSnapshot(), previous);
    assert.equal(message.spokenText, "Say the option.");
    const spokenText = message.spokenText;
    await engine.chooseLocation(1);
    assert.equal(engine.getSnapshot().pendingDestination, null);
    assert.deepEqual(navigation.getSnapshot().destination, locations[1]);
    const ready = engine.getSnapshot().messages.at(-1);
    assert.ok(ready?.role === "assistant");
    assert.ok(ready.text.includes(locations[1].name));
    assert.ok(ready.spokenText?.includes(locations[1].name.split(/\s+/u).slice(0, 5).join(" ")));
    assert.ok(!ready.spokenText?.includes(locations[1].name));
    const savedMessage = engine.getSnapshot().messages.find((item) => item.id === message.id);
    assert.ok(savedMessage?.role === "assistant");
    assert.equal(savedMessage.spokenText, spokenText);
    assert.equal(savedMessage.text, response);
  });
}

for (const source of ["active origin", "new current location", "selected starting location"] as const) {
  test(`only the nearest five in-country destination choices are shown from the ${source}`, async (context) => {
    const reference = source === "active origin" ? { ...origin, countryCode: "gb" } : { ...origin, countryCode: "in", id: source === "selected starting location" ? "test:manual-origin" : "device:current", lat: 17.36, lon: 78.47 };
    const locations: Location[] = [
      { ...reference, id: "test:far", name: "Far landmark on Sample Road, Town Region", lat: reference.lat + 2 },
      { ...reference, id: "test:middle", name: "Middle landmark on Sample Road, Town Region", lat: reference.lat + 0.01 },
      { ...reference, id: "test:close", name: "Close landmark on Sample Road, Town Region", lat: reference.lat + 0.001 },
      { ...reference, id: "test:second", name: "Second landmark on Sample Road, Town Region", lat: reference.lat + 0.005 },
      { ...reference, id: "test:fourth", name: "Fourth landmark on Sample Road, Town Region", lat: reference.lat + 0.03 },
      { ...reference, id: "test:nearest", name: "Nearest landmark on Sample Road, Town Region", lat: reference.lat + 0.0001 },
      { ...reference, id: "test:foreign", countryCode: source === "active origin" ? "in" : "gb", name: "Foreign landmark", lat: reference.lat + 0.00001 },
      { ...reference, id: "test:unknown-country", countryCode: undefined, name: "Unverified country landmark", lat: reference.lat + 0.000001 },
    ];
    const providerOrder = locations.map((location) => location.id);
    const requests: unknown[] = [];
    mockServices(context, undefined, locations, undefined, requests);
    const navigation = source === "selected starting location" ? new NavigationController(async () => structuredClone(fixtureRoute)) : await controllerFixture();
    if (source === "active origin") await navigation.execute({ type: "SET_ROUTE", origin: reference, destination });
    const previous = navigation.getSnapshot();
    let locationRequests = 0;
    const engine = new ConversationEngine(navigation, {
      onPlaces: () => {}, onSelectPlace: () => {}, onDetours: () => {}, getReferenceLocation: () => source === "selected starting location" ? reference : origin,
      getCurrentLocation: async () => { locationRequests += 1; return reference; },
    });
    const response = await engine.send(source === "new current location" ? "Plan a route from current location to Charminar" : "Target location Charminar.");
    assert.equal(locationRequests, source === "new current location" ? 1 : 0);
    assert.deepEqual(engine.getSnapshot().pendingLocationChoices.map((location) => location.id), ["test:nearest", "test:close", "test:second", "test:middle", "test:fourth"]);
    assert.deepEqual(requests, [{ query: "Charminar", reference: { lat: reference.lat, lon: reference.lon }, countryCode: reference.countryCode }]);
    assert.deepEqual(locations.map((location) => location.id), providerOrder);
    assert.ok(response.includes(`Option 1: ${locations[5].name}`));
    assert.ok(!response.includes(locations[0].name));
    assert.ok(!response.includes(locations[6].name));
    assert.ok(!response.includes(locations[7].name));
    assert.ok(response.includes("Option 5:"));
    assert.ok(!response.includes("Option 6:"));
    const message = engine.getSnapshot().messages.at(-1);
    assert.ok(message?.role === "assistant");
    assert.equal(message.spokenText, "Say the option.");
    assert.strictEqual(navigation.getSnapshot(), previous);
    await engine.send("Option one");
    assert.equal(engine.getSnapshot().pendingDestination, null);
    assert.deepEqual(navigation.getSnapshot().destination, locations[5]);
    assert.deepEqual(navigation.getSnapshot().origin, reference);
  });
}

  test("country codes are validated, normalized and retained in location data", () => {
    assert.equal(locationSchema.parse({ ...origin, countryCode: "IN" }).countryCode, "in");
    assert.equal(locationSchema.safeParse({ ...origin, countryCode: "India" }).success, false);
    assert.equal(locationSchema.safeParse(origin).success, true);
  });

  test("a GPS origin without country metadata supplies coordinates for server-side country lookup", async (context) => {
    const current = { ...origin, id: "device:current", name: "Current location" };
    const requests: unknown[] = [];
    mockServices(context, undefined, [{ ...destination, countryCode: "gb" }], undefined, requests);
    const navigation = new NavigationController(async () => structuredClone(fixtureRoute));
    const engine = new ConversationEngine(navigation, {
      onPlaces: () => {}, onSelectPlace: () => {}, onDetours: () => {}, getReferenceLocation: () => null, getCurrentLocation: async () => current,
    });
    await engine.send("Plan a route from current location to HITECH City");
    assert.deepEqual(requests, [{ query: "HITECH City", reference: { lat: current.lat, lon: current.lon } }]);
    assert.equal(engine.getSnapshot().pendingDestination?.countryCode, "gb");
    assert.equal(navigation.getSnapshot().route, null);
  });

  for (const countryCode of ["in", undefined]) {
    test(`a single destination with ${countryCode ?? "unknown"} country cannot bypass a gb origin filter`, async (context) => {
      mockServices(context, undefined, [{ ...destination, countryCode }]);
      const navigation = new NavigationController(async () => structuredClone(fixtureRoute));
      await navigation.execute({ type: "SET_ROUTE", origin: { ...origin, countryCode: "gb" }, destination });
      const previous = navigation.getSnapshot();
      const engine = engineFixture(navigation);
      await assert.rejects(() => engine.send("Destination HITECH City"), /starting location's country/);
      assert.equal(engine.getSnapshot().pendingDestination, null);
      assert.equal(engine.getSnapshot().pendingLocationChoices.length, 0);
      assert.strictEqual(navigation.getSnapshot(), previous);
    });
  }

test("a rejected location permission cannot produce a fabricated route", async () => {
  const navigation = new NavigationController(async () => structuredClone(fixtureRoute));
  const engine = new ConversationEngine(navigation, { onPlaces: () => {}, onSelectPlace: () => {}, onDetours: () => {}, getReferenceLocation: () => null, getCurrentLocation: async () => { throw new Error("Location access was denied"); } });
  await assert.rejects(() => engine.send("Plan a route from current location to Charminar"), /Location access was denied/);
  assert.equal(navigation.getSnapshot().route, null);
  assert.equal(engine.getSnapshot().pendingDestination, null);
});

test("an affirmative utterance without a pending explicit request never starts navigation", async () => {
  const navigation = await controllerFixture();
  const previous = navigation.getSnapshot();
  const reply = await engineFixture(navigation).send("Confirm route");
  assert.match(reply, /no route change awaiting confirmation/i);
  assert.strictEqual(navigation.getSnapshot(), previous);
});

test("Hindi commands preserve real place names instead of translating address words", () => {
  assert.equal(destinationInstruction("मुझे चार मीनार ले चलो"), "चार मीनार");
  assert.equal(destinationInstruction("मेरेको चारमीनार लेके चलो"), "चारमीनार");
  assert.deepEqual(routeInstruction("अभी की लोकेशन से चार मीनार तक रास्ता दिखाओ"), { originQuery: "अभी की लोकेशन", query: "चार मीनार" });
  assert.equal(hindiConfirmation("हाँ, कन्फर्म करो"), "yes");
  assert.equal(hindiConfirmation("Hau"), "yes");
  assert.equal(hindiConfirmation("नक्को"), "no");
  assert.equal(hindiConfirmation("haan mat karo"), null);
});

test("Hindi route questions and searches cannot change the active destination", async (context) => {
  mockServices(context);
  const navigation = await controllerFixture();
  const engine = engineFixture(navigation);
  const previous = navigation.getSnapshot();
  for (const phrase of ["कितना टाइम लगेगा", "दूरी कितनी है", "ट्रैफिक है क्या", "दूसरा रास्ता दिखाओ", "पास में रेस्टोरेंट दिखाओ", "रास्ते में रेस्टोरेंट दिखाओ", "दूसरे वाले की जानकारी बताओ", "मुझे चारमीनार मत ले जाओ", "हाँ"]) {
    assert.match(await engine.send(phrase), /[\u0900-\u097f]/u);
    assert.strictEqual(navigation.getSnapshot(), previous, phrase);
    assert.equal(engine.getSnapshot().pendingDestination, null, phrase);
  }
});

test("Hindi planning, spoken options, cancellation and Deccani confirmation retain the safety gate", async (context) => {
  mockServices(context, undefined, [destination, { ...destination, id: "test:other", name: "Other address" }]);
  const navigation = new NavigationController(async () => structuredClone(fixtureRoute));
  const engine = new ConversationEngine(navigation, { onPlaces: () => {}, onSelectPlace: () => {}, onDetours: () => {}, getReferenceLocation: () => null, getCurrentLocation: async () => origin });
  assert.match(await engine.send("अभी की लोकेशन से चारमीनार तक रास्ता दिखाओ"), /विकल्प/);
  assert.equal(navigation.getSnapshot().route, null);
  await engine.send("विकल्प दो");
  assert.equal(engine.getSnapshot().pendingDestination, null);
  assert.equal(navigation.getSnapshot().destination?.id, "test:other");
  await engine.send("नक्को");
  assert.equal(engine.getSnapshot().pendingDestination, null);
  assert.equal(navigation.getSnapshot().destination?.id, "test:other");
  await engine.send("Mereko Charminar leke chalo");
  await engine.send("दो");
  await engine.send("Hau");
  assert.equal(navigation.getSnapshot().destination?.id, "test:other");
  assert.equal(engine.getSnapshot().language, "hi");
});

test("Hindi informational questions do not choose a pending destination option", async (context) => {
  mockServices(context, undefined, [destination, { ...destination, id: "test:other" }]);
  const navigation = new NavigationController(async () => structuredClone(fixtureRoute));
  const engine = new ConversationEngine(navigation, { onPlaces: () => {}, onSelectPlace: () => {}, onDetours: () => {}, getReferenceLocation: () => null, getCurrentLocation: async () => origin });
  await engine.send("मेरेको चारमीनार लेके चलो");
  await engine.send("दूसरे विकल्प का पता क्या है");
  assert.equal(engine.getSnapshot().pendingDestination, null);
  assert.equal(navigation.getSnapshot().route, null);
});

test("the controller rejects mixed-language negations even for a confirmed action", async () => {
  const navigation = await controllerFixture();
  const previous = navigation.getSnapshot();
  for (const sourceText of ["Navigate to Charminar मत", "Take me to Charminar nahi", "मुझे चारमीनार मत ले जाओ", "मेरेको पहले और दूसरे वाले को ले चलो"]) {
    await assert.rejects(() => navigation.execute({ ...changeAction(navigation), sourceText }));
    assert.strictEqual(navigation.getSnapshot(), previous);
  }
});

test("Hindi speech capture explicitly uses hi-IN on an English device", (context) => {
  mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
  const stop = startRecognition({ language: "hi-IN", onTranscript: () => {}, onError: () => assert.fail("Unexpected recognition error"), onEnd: () => {} });
  context.after(stop);
  assert.equal(RecognitionStub.latest.lang, "hi-IN");
  assert.equal(RecognitionStub.latest.continuous, true);
});

test("Hindi replies select a Hindi voice rather than the device English voice", (context) => {
  const utterances: UtteranceStub[] = [];
  const hindiVoice = { lang: "hi-IN", localService: true };
  mockBrowser(context, { window: { speechSynthesis: { cancel: () => {}, resume: () => {}, getVoices: () => [{ lang: "en-US", localService: true }, hindiVoice], speak: (utterance: UtteranceStub) => utterances.push(utterance) } }, SpeechSynthesisUtterance: UtteranceStub, navigator: { language: "en-US" } });
  context.after(speakResponse("कितना समय लगेगा।", () => {}));
  assert.equal(utterances[0].lang, "hi-IN");
  assert.strictEqual(utterances[0].voice, hindiVoice);
});

test("missing Hindi voices show an actionable error instead of using an English voice", (context) => {
  let spoken = 0;
  let finished = 0;
  let error = "";
  mockBrowser(context, { window: { speechSynthesis: { cancel: () => {}, resume: () => {}, getVoices: () => [{ lang: "en-US", localService: true }], speak: () => { spoken += 1; } } }, SpeechSynthesisUtterance: UtteranceStub, navigator: { language: "en-US" } });
  context.after(speakResponse("मंज़िल नहीं बदली है।", () => { finished += 1; }, (message) => { error = message; }));
  assert.equal(spoken, 0);
  assert.equal(finished, 1);
  assert.match(error, /Hindi voice/i);
});

test("a model cannot invent an origin and destination from an informational question", async () => {
  const unsafe: AIProvider = { label: "Unsafe test adapter", mode: "model", process: async () => ({ type: "PLAN_ROUTE", originQuery: "invented", query: "invented" }) };
  const intent = await new IntentProcessor(unsafe).process({ text: "How far is my destination?", context: emptyContext(), session: emptySession() });
  assert.equal(intent.type, "CLARIFY");
});

test("complete send phrases and bounded Nova recognition variants are stripped only at the end", () => {
  assert.equal(voiceRequest("Target location Charminar. Nova Submit."), "Target location Charminar.");
  assert.equal(voiceRequest("  Option two, NOVA, SUBMIT!  "), "Option two");
  assert.equal(voiceRequest("विकल्प दो नोवा सबमिट।"), "विकल्प दो");
  assert.equal(voiceRequest("हाँ Nova सबमिट"), "हाँ");
  assert.equal(voiceRequest("Nova Submit"), "");
  for (const phrase of ["Send", "SEND", "Submit", "SUBMIT", "सेंड", "सबमिट", "Navigator Send", "नेविगेटर सेंड", "no va submit", "no or va submit", "no, or, va submit", "नो वा सबमिट"]) {
    assert.equal(voiceRequest(`Option two ${phrase}.`), "Option two", phrase);
    assert.equal(voiceRequest(phrase), "", phrase);
    assert.equal(voiceRequest(`${phrase} cafe`), null, phrase);
  }
  for (const text of ["Target location Charminar", "Find Supernova Submission", "Find Nova Submission", "Find Nova Submit cafe", "Nova Submit is a phrase", "Read the phrase 'Nova Submit'", "Send it now", "Submit it now", "Destination Send Cafe", "Destination Submitter", "Destination Westend", "Destination Sendai", "no", "or", "va", "Navigator", "Find Navigator Sender", ""]) {
    assert.equal(voiceRequest(text), null, text);
  }
  assert.equal(voiceRequest("Find Supernova Submit"), "Find Supernova");
  for (const word of ["no", "or", "va"]) assert.equal(voiceRequest(`${word} submit`), word);
});

for (const text of ["Destination HITECH City. Submit.", "Destination HITECH City.", "Target HITECH City.", "Target HITECH City. Send."]) {
  test(`raw conversation input geocodes only the destination and requires confirmation: ${text}`, async (context) => {
    const request = voiceRequest(text) ?? text;
    assert.equal(destinationInstruction(request), "HITECH City");
    const queries: string[] = [];
    mockServices(context, undefined, [{ ...destination, id: "test:hitech", name: "HITECH City" }], queries);
    const navigation = await controllerFixture();
    const previous = navigation.getSnapshot();
    const engine = engineFixture(navigation);
    await engine.send(text);
    assert.deepEqual(queries, ["HITECH City"]);
    assert.equal(engine.getSnapshot().messages.find((message) => message.role === "user")?.text, request);
    assert.equal(engine.getSnapshot().pendingDestination?.name, "HITECH City");
    assert.strictEqual(navigation.getSnapshot(), previous);
    await engine.send("Confirm destination. Submit.");
    assert.equal(navigation.getSnapshot().destination?.id, "test:hitech");
    assert.deepEqual(queries, ["HITECH City"]);
  });
}

test("bare place names resolve a destination but preserve the route until confirmation", async (context) => {
  const queries: string[] = [];
  mockServices(context, undefined, [{ ...destination, name: "HITECH City" }], queries);
  const navigation = await controllerFixture();
  const previous = navigation.getSnapshot();
  const engine = engineFixture(navigation);
  const reply = await engine.send("HITECH City.");
  assert.match(reply, /confirm destination/i);
  assert.deepEqual(queries, ["HITECH City"]);
  assert.equal(engine.getSnapshot().pendingDestination?.name, "HITECH City");
  assert.strictEqual(navigation.getSnapshot(), previous);
});

test("an empty send control at the conversation boundary cannot confirm a pending destination", async (context) => {
  mockServices(context, undefined, [{ ...destination, id: "test:hitech", name: "HITECH City" }]);
  const navigation = await controllerFixture();
  const previous = navigation.getSnapshot();
  const engine = engineFixture(navigation);
  await engine.send("Destination HITECH City.");
  const pending = engine.getSnapshot();
  assert.equal(await engine.send("Submit."), "");
  assert.strictEqual(engine.getSnapshot(), pending);
  assert.strictEqual(navigation.getSnapshot(), previous);
});

test("voice cleanup removes only explicit noise and sentence-leading hesitation sounds", () => {
  const request = voiceRequest(" [noise]\tUm, uh, Destination HITECH City.\n[background noise] Send! [silence] ");
  assert.equal(request, "Destination HITECH City.");
  assert.equal(destinationInstruction(request), "HITECH City");
  assert.equal(voiceRequest("Um. Select starting location as current location and target location as HITECH City. Send."), "Select starting location as current location and target location as HITECH City.");
  assert.equal(voiceRequest("Uh, मुझे चारमीनार ले चलो सेंड।"), "मुझे चारमीनार ले चलो");
  assert.equal(sanitizeVoiceRequest("Destination [inaudible] City"), "Destination [inaudible] City");
  assert.equal(sanitizeVoiceRequest("Destination Um Qais"), "Destination Um Qais");
  assert.equal(sanitizeVoiceRequest("Destination Walla Walla"), "Destination Walla Walla");
  assert.equal(voiceRequest("Destination Sector 12, Road No. 5. Send."), "Destination Sector 12, Road No. 5.");
  assert.equal(voiceRequest("Destination HITECH City. Send. Send!"), "Destination HITECH City.");
  assert.equal(voiceRequest("Destination HITECH City. Send; Navigator Send."), "Destination HITECH City.");
  assert.equal(voiceRequest("Destination HITECH City. Submit; Send. Submit!"), "Destination HITECH City.");
});

test("cleanup preserves negation, questions and multiple destinations rather than inventing a command", () => {
  for (const text of ["Do not navigate to HITECH City.", "Don't change my destination.", "If I go to HITECH City, how far is it?", "Destination HITECH City?", "Navigate to HITECH City or Charminar."]) {
    const request = voiceRequest(`Um, [noise] ${text} Send.`);
    assert.equal(request, text);
    assert.equal(destinationInstruction(request), null);
    assert.equal(routeInstruction(request), null);
  }
});

for (const marker of ["Send.", "SEND!", "Submit.", "SUBMIT!", "सेंड।", "सबमिट।"]) {
  test(`only a finalized last-word marker submits the complete cleaned request: ${marker}`, (context) => {
    mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
    const completed: string[] = [];
    const transcripts: string[] = [];
    const stop = startRecognition({ onTranscript: (text) => transcripts.push(text), onError: () => assert.fail("Unexpected recognition error"), onEnd: () => {}, onComplete: (text) => completed.push(text) });
    context.after(stop);
    const recognition = RecognitionStub.latest;
    const first = { isFinal: true, 0: { transcript: "Um, [noise] Destination HITECH City." } };
    recognition.onresult?.({ resultIndex: 0, results: [first] });
    recognition.onresult?.({ resultIndex: 1, results: [first, { isFinal: false, 0: { transcript: marker } }] });
    assert.deepEqual(completed, []);
    const lateResult = recognition.onresult;
    const results = [first, { isFinal: true, 0: { transcript: marker } }];
    recognition.onresult?.({ resultIndex: 1, results });
    lateResult?.({ resultIndex: 1, results });
    assert.deepEqual(completed, ["Destination HITECH City."]);
    assert.equal(transcripts.at(-1), "Destination HITECH City.");
    assert.equal(recognition.aborted, true);
  });
}

for (const text of ["Send", "Submit", "सेंड।", "सबमिट।", "Um, [noise] Send!", "Um, [noise] Submit!", "Send. Send.", "Submit. Send. Submit."]) {
  test(`the last-word send control cannot submit an empty cleaned message: ${text}`, (context) => {
    mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
    const completed: string[] = [];
    const stop = startRecognition({ onTranscript: () => {}, onError: () => assert.fail("Unexpected recognition error"), onEnd: () => {}, onComplete: (request) => completed.push(request) });
    context.after(stop);
    RecognitionStub.latest.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
    assert.deepEqual(completed, []);
    assert.equal(RecognitionStub.latest.aborted, true);
  });
}

test("microphone startup waits for playback settling and keeps the full bounded recording window", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
  let starts = 0;
  let ends = 0;
  const stop = startRecognition({ startDelayMs: 400, maxDurationMs: 15000, onTranscript: () => {}, onError: () => assert.fail("Unexpected recognition error"), onEnd: () => { ends += 1; } });
  context.after(stop);
  const recognition = RecognitionStub.latest;
  recognition.start = () => { starts += 1; };
  context.mock.timers.tick(399);
  assert.equal(starts, 0);
  context.mock.timers.tick(1);
  assert.equal(starts, 1);
  context.mock.timers.tick(14999);
  assert.equal(ends, 0);
  context.mock.timers.tick(1);
  assert.equal(ends, 1);
  assert.equal(recognition.aborted, true);
});

test("cancelling during playback settling prevents delayed microphone startup", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
  let starts = 0;
  const stop = startRecognition({ startDelayMs: 400, onTranscript: () => assert.fail("Cancelled capture must not receive text"), onError: () => {}, onEnd: () => {} });
  const recognition = RecognitionStub.latest;
  recognition.start = () => { starts += 1; };
  stop();
  context.mock.timers.tick(1000);
  assert.equal(starts, 0);
  assert.equal(recognition.aborted, true);
});

test("the split Nova send alias survives a foreground recognition restart", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
  const completed: string[] = [];
  const stop = startRecognition({ onTranscript: () => {}, onError: () => assert.fail("Unexpected recognition error"), onEnd: () => {}, onComplete: (text) => completed.push(text) });
  context.after(stop);
  const recognition = RecognitionStub.latest;
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Target location Charminar no or" } }] });
  recognition.onend?.();
  context.mock.timers.tick(150);
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "va submit" } }] });
  assert.deepEqual(completed, ["Target location Charminar"]);
});

test("hands-free capture waits for the send phrase even through long pauses", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
  const completed: string[] = [];
  const stop = startRecognition({ onTranscript: () => {}, onError: () => assert.fail("Unexpected recognition error"), onEnd: () => {}, onComplete: (text) => completed.push(text) });
  context.after(stop);
  const recognition = RecognitionStub.latest;
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Select starting location" } }] });
  context.mock.timers.tick(10000);
  assert.equal(completed.length, 0);
  recognition.onspeechstart?.();
  context.mock.timers.tick(4000);
  assert.equal(completed.length, 0);
  recognition.onresult?.({ resultIndex: 1, results: [{ isFinal: true, 0: { transcript: "Select starting location" } }, { isFinal: true, 0: { transcript: "as current location and target location as Charminar" } }] });
  recognition.onspeechend?.();
  context.mock.timers.tick(10000);
  assert.equal(completed.length, 0);
  const lateResult = recognition.onresult;
  recognition.onresult?.({ resultIndex: 2, results: [{ isFinal: true, 0: { transcript: "Select starting location" } }, { isFinal: true, 0: { transcript: "as current location and target location as Charminar" } }, { isFinal: false, 0: { transcript: "Nova Submit" } }] });
  assert.equal(completed.length, 0);
  recognition.onresult?.({ resultIndex: 2, results: [{ isFinal: true, 0: { transcript: "Select starting location" } }, { isFinal: true, 0: { transcript: "as current location and target location as Charminar" } }, { isFinal: true, 0: { transcript: "Nova Submit" } }] });
  assert.deepEqual(completed, ["Select starting location as current location and target location as Charminar"]);
  assert.equal(recognition.aborted, true);
  lateResult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Navigate to Charminar Nova Submit" } }] });
  context.mock.timers.tick(10000);
  assert.equal(completed.length, 1);
});

test("cancelling hands-free recording prevents a late send phrase from submitting", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
  let completed = 0;
  const stop = startRecognition({ onTranscript: () => {}, onError: () => {}, onEnd: () => {}, onComplete: () => { completed += 1; } });
  RecognitionStub.latest.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Navigate to Charminar" } }] });
  const lateResult = RecognitionStub.latest.onresult;
  stop();
  lateResult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Navigate to Charminar Nova Submit" } }] });
  context.mock.timers.tick(5000);
  assert.equal(completed, 0);
});

test("a foreground recognizer restart preserves earlier fragments in the same bounded turn", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
  const completed: string[] = [];
  const stop = startRecognition({ onTranscript: () => {}, onError: () => assert.fail("Unexpected recognition error"), onEnd: () => {}, onComplete: (text) => completed.push(text) });
  context.after(stop);
  const recognition = RecognitionStub.latest;
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Plan a route from current location" } }] });
  recognition.onend?.();
  context.mock.timers.tick(150);
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "to Charminar" } }] });
  context.mock.timers.tick(3000);
  assert.deepEqual(completed, []);
  recognition.onresult?.({ resultIndex: 1, results: [{ isFinal: true, 0: { transcript: "to Charminar" } }, { isFinal: true, 0: { transcript: "Nova Submit" } }] });
  assert.deepEqual(completed, ["Plan a route from current location to Charminar"]);
});

test("a follow-up microphone window stops at its limit without submitting unfinished speech", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
  let completed = 0;
  let ended = 0;
  const stop = startRecognition({ onTranscript: () => {}, onError: () => {}, onEnd: () => { ended += 1; }, onComplete: () => { completed += 1; }, maxDurationMs: 15000 });
  context.after(stop);
  RecognitionStub.latest.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "confirm" } }] });
  context.mock.timers.tick(15000);
  assert.equal(ended, 1);
  assert.equal(completed, 0);
  assert.equal(RecognitionStub.latest.aborted, true);
});

test("Hindi speech submits without a click and removes the Hindi send phrase", (context) => {
  mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
  const completed: string[] = [];
  const transcripts: string[] = [];
  const stop = startRecognition({ language: "hi-IN", onTranscript: (text) => transcripts.push(text), onError: () => assert.fail("Unexpected recognition error"), onEnd: () => {}, onComplete: (text) => completed.push(text) });
  context.after(stop);
  RecognitionStub.latest.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "विकल्प दो नोवा सबमिट।" } }] });
  assert.deepEqual(completed, ["विकल्प दो"]);
  assert.equal(transcripts.at(-1), "विकल्प दो");
});

test("the send phrase can be split across foreground recognition restarts", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
  const completed: string[] = [];
  const stop = startRecognition({ onTranscript: () => {}, onError: () => assert.fail("Unexpected recognition error"), onEnd: () => {}, onComplete: (text) => completed.push(text) });
  context.after(stop);
  const recognition = RecognitionStub.latest;
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Target location Charminar Nova" } }] });
  recognition.onend?.();
  context.mock.timers.tick(150);
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Submit" } }] });
  assert.deepEqual(completed, ["Target location Charminar"]);
});

test("an idle browser restart keeps waiting for the phrase inside the original recording limit", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
  let completed = 0;
  let endings = 0;
  const stop = startRecognition({ onTranscript: () => {}, onError: () => assert.fail("Unexpected recognition error"), onEnd: () => { endings += 1; }, onComplete: () => { completed += 1; }, maxDurationMs: 15000 });
  context.after(stop);
  const recognition = RecognitionStub.latest;
  recognition.onerror?.({ error: "no-speech" });
  recognition.onend?.();
  context.mock.timers.tick(150);
  assert.equal(endings, 0);
  recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Confirm route" } }] });
  context.mock.timers.tick(14850);
  assert.equal(endings, 1);
  assert.equal(completed, 0);
  assert.equal(recognition.aborted, true);
});

test("saying only the send phrase cannot submit an empty request", (context) => {
  mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
  let completed = 0;
  const stop = startRecognition({ onTranscript: () => {}, onError: () => {}, onEnd: () => {}, onComplete: () => { completed += 1; } });
  context.after(stop);
  RecognitionStub.latest.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Nova Submit" } }] });
  assert.equal(completed, 0);
  assert.equal(RecognitionStub.latest.aborted, true);
});

test("the send phrase submits an existing draft exactly once without duplicating it", (context) => {
  mockBrowser(context, { window: { SpeechRecognition: RecognitionStub }, navigator: { language: "en-US" } });
  const completed: string[] = [];
  const transcripts: string[] = [];
  const stop = startRecognition({ initialTranscript: "Target location Charminar.", onTranscript: (text) => transcripts.push(text), onError: () => assert.fail("Unexpected recognition error"), onEnd: () => {}, onComplete: (text) => completed.push(text) });
  context.after(stop);
  RecognitionStub.latest.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Nova Submit" } }] });
  assert.deepEqual(completed, ["Target location Charminar."]);
  assert.equal(transcripts.at(-1), "Target location Charminar.");
});