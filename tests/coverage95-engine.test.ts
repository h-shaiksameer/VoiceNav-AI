import assert from "node:assert/strict";
import { test } from "node:test";
import type { AIProvider } from "@/ai/AIProvider";
import { IntentProcessor } from "@/ai/IntentProcessor";
import { LocalIntentProvider } from "@/ai/providers/LocalIntentProvider";
import { emptyContext } from "@/conversation/ConversationContext";
import { ConversationEngine } from "@/conversation/ConversationEngine";
import type { ConversationServices } from "@/conversation/ConversationServices";
import { destinationInstruction } from "@/navigation/commands";
import { NavigationController } from "@/navigation/NavigationController";
import { emptySession } from "@/navigation/NavigationSession";
import { ParallelAssistantService } from "@/services/ParallelAssistantService";
import { calculateRouteProgress } from "@/services/RouteProgressService";
import type { Intent, Location, PlaceResult, RouteResult } from "@/types/domain";

const origin: Location = { id: "test:origin", name: "Test origin", lat: 51.5, lon: -0.1 };
const destination: Location = { id: "test:destination", name: "Test destination", lat: 51.51, lon: -0.12 };
const second: Location = { id: "test:second", name: "Second destination", lat: 51.52, lon: -0.13 };
const route: RouteResult = { distanceMeters: 2400, durationSeconds: 600, geometry: { type: "LineString", coordinates: [[-0.1, 51.5], [-0.12, 51.51]] } };
const places: PlaceResult[] = [
  { id: "osm:node:1", name: "Test restaurant A", lat: 51.501, lon: -0.101, category: "restaurant", distanceMeters: 150 },
  { id: "osm:node:2", name: "Test restaurant B", lat: 51.502, lon: -0.102, category: "restaurant", distanceMeters: 300 },
];

function services(overrides: Partial<ConversationServices> = {}): ConversationServices {
  return {
    searchLocations: async () => [destination],
    searchPlaces: async () => places,
    requestRoute: async () => route,
    requestRouteAlternatives: async () => [route],
    requestCurrentLocation: async () => origin,
    ...overrides,
  };
}

async function activeNavigation() {
  const navigation = new NavigationController(async () => structuredClone(route));
  await navigation.execute({ type: "SET_ROUTE", origin, destination });
  return navigation;
}

function engineFor(navigation: NavigationController, overrides: Partial<ConversationServices> = {}, callbacks: Partial<ConstructorParameters<typeof ConversationEngine>[1]> = {}) {
  return new ConversationEngine(navigation, { onPlaces: () => {}, onSelectPlace: () => {}, onDetours: () => {}, getReferenceLocation: () => origin, ...callbacks }, services(overrides));
}

// The snapshot drifts without notifying subscribers, as a stale view would.
class DriftingNavigation extends NavigationController {
  offset = 0;
  hideOrigin = false;
  hideRoute = false;
  constructor() {
    super(async () => structuredClone(route));
    const real = this.getSnapshot;
    this.getSnapshot = () => {
      const session = real();
      return { ...session, revision: session.revision + this.offset, origin: this.hideOrigin ? null : session.origin, route: this.hideRoute ? null : session.route };
    };
  }
}

async function driftingFixture(overrides: Partial<ConversationServices> = {}) {
  const navigation = new DriftingNavigation();
  await navigation.execute({ type: "SET_ROUTE", origin, destination });
  return { navigation, engine: engineFor(navigation, overrides) };
}

test("several distinct alternative routes are described in the plural", async () => {
  const alternatives: RouteResult[] = [
    { ...route, geometry: { type: "LineString", coordinates: [[-0.1, 51.5], [-0.11, 51.52], [-0.12, 51.51]] } },
    { ...route, geometry: { type: "LineString", coordinates: [[-0.1, 51.5], [-0.09, 51.49], [-0.12, 51.51]] } },
  ];
  const engine = engineFor(await activeNavigation(), { requestRouteAlternatives: async () => alternatives });
  assert.match(await engine.send("Check other routes."), /2 other driving routes\./);
});

test("a device-location origin is reported to the caller before destination search", async () => {
  const located: Location[] = [];
  const engine = engineFor(new NavigationController(async () => structuredClone(route)), {}, { onCurrentLocation: (location) => located.push(location) });
  await engine.send("Plan a route from current location to Oxford");
  assert.deepEqual(located, [origin]);
});

test("place details describe distance from the route corridor in both languages", async () => {
  const engine = engineFor(await activeNavigation());
  await engine.find("restaurant", "route");
  assert.match(await engine.send("Details about the first one"), /from the route corridor/);
  engine.setLanguage("hi");
  assert.match(await engine.send("Details about the first one"), /रास्ते से दूरी/);
});

test("place details describe straight-line distance for nearby searches in both languages", async () => {
  const engine = engineFor(await activeNavigation());
  await engine.find("restaurant", "nearby");
  assert.match(await engine.send("Details about the first one"), /in a straight line from the search origin/);
  engine.setLanguage("hi");
  assert.match(await engine.send("Details about the first one"), /शुरुआती जगह से सीधी दूरी/);
});

test("comparing results from a route search without a route reports straight-line distances", async () => {
  for (const [language, expected] of [["en", /from the route/], ["hi", /के बजाय रास्ते/]] as const) {
    const { navigation, engine } = await driftingFixture();
    await engine.find("restaurant", "route");
    navigation.hideRoute = true;
    engine.setLanguage(language);
    assert.match(await engine.compare(), expected);
  }
});

test("a numbered result cannot become a destination before an origin exists", async () => {
  const engine = engineFor(new NavigationController(async () => structuredClone(route)));
  await engine.find("restaurant", "nearby");
  await assert.rejects(engine.send("Navigate to the second one"), /Give a starting location and destination/);
});

test("nearest-place destinations report empty searches and caveat returned matches", async () => {
  const empty = engineFor(await activeNavigation(), { searchPlaces: async () => [] });
  assert.match(await empty.send("Navigate to the nearest restaurant"), /No matching places were returned nearby/);
  const found = engineFor(await activeNavigation());
  assert.match(await found.send("Navigate to the nearest restaurant"), /closest returned result by straight-line distance/);
});

test("non-Error failures are reported with the generic unchanged-route message", async () => {
  const engine = engineFor(new NavigationController(async () => structuredClone(route)), { searchPlaces: async () => { throw "offline"; } });
  await assert.rejects(engine.send("Find restaurants nearby"), (error: unknown) => error === "offline");
  assert.equal(engine.getSnapshot().messages.at(-1)?.text, "The request could not be completed. Your route is unchanged.");
});

test("a journey that changes unnoticed invalidates confirmation", async () => {
  const { navigation, engine } = await driftingFixture();
  await engine.send("Navigate to Oxford");
  navigation.offset = 1;
  await assert.rejects(engine.confirm(), /Your journey changed/);
  assert.equal(engine.getSnapshot().pendingDestination, null);
});

test("stale destination choices are rejected when the revision or origin has drifted", async () => {
  const choices = { searchLocations: async () => [destination, second] };
  const revised = await driftingFixture(choices);
  await revised.engine.send("Navigate to Oxford");
  assert.equal(revised.engine.getSnapshot().pendingLocationChoices.length, 2);
  revised.navigation.offset = 1;
  await assert.rejects(revised.engine.chooseLocation(0), /Your route changed while resolving/);

  const originless = await driftingFixture(choices);
  await originless.engine.send("Navigate to Oxford");
  originless.navigation.hideOrigin = true;
  await assert.rejects(originless.engine.chooseLocation(0), /starting location is required/);
});

test("confirmed changes are described even when no route is available to summarize", async () => {
  const english = await driftingFixture();
  await english.engine.send("Navigate to Oxford");
  english.navigation.hideRoute = true;
  assert.equal(await english.engine.confirm(), "Destination changed: Test destination.");

  const hindi = await driftingFixture();
  await hindi.engine.send("Navigate to Oxford");
  hindi.engine.setLanguage("hi");
  hindi.navigation.hideRoute = true;
  assert.equal(await hindi.engine.confirm(), "Test destination तक का रास्ता तैयार है।");
});

test("providers cannot bypass multi-category or stop-instruction safeguards", async () => {
  const provider = (intent: Intent): AIProvider => ({ label: "Test provider", mode: "model", process: async () => intent });
  const input = (text: string) => ({ text, context: emptyContext(), session: emptySession() });
  const multiple = await new IntentProcessor(provider({ type: "CHANGE_DESTINATION" })).process(input("Take me to the restaurant hospital"));
  assert.deepEqual(multiple, { type: "CLARIFY", clarification: "Choose a single place type or destination." });
  assert.deepEqual(await new IntentProcessor(provider({ type: "STOP_NAVIGATION" })).process(input("Hello there")), { type: "CLARIFY" });
});

test("local intents clarify multiple categories, resolve distance references, and need a category along the route", async () => {
  const local = new LocalIntentProvider();
  const session = emptySession();
  const withPlaces = { ...emptyContext(), recentPlaces: places };
  assert.equal((await local.process({ text: "Take me to the restaurant hospital", context: emptyContext(), session })).type, "CLARIFY");
  assert.deepEqual(await local.process({ text: "kitna door hai pehla wala", context: withPlaces, session }), { type: "GET_PLACE_DETAILS", reference: 0 });
  assert.match((await local.process({ text: "find something along my route", context: emptyContext(), session })).clarification ?? "", /along your route/);
});

test("distance between two named places is distinct from current route distance", async () => {
  const measuredRoute: RouteResult = { distanceMeters: 7800, durationSeconds: 900, geometry: route.geometry };
  const navigation = new NavigationController(async () => structuredClone(route));
  const searched: string[] = [];
  const references: (Location | undefined)[] = [];
  const engine = engineFor(navigation, {
    searchLocations: async (query, reference) => {
      searched.push(query);
      references.push(reference);
      return [{ id: `test:${query}`, name: query, lat: query === "Charminar" ? 17.36 : 17.31, lon: 78.47 }];
    },
    requestRoute: async (waypoints) => {
      assert.equal(waypoints.length, 2);
      return measuredRoute;
    },
  });
  const intent = await new LocalIntentProvider().process({ text: "Check distance between Charminar and Farrukh Nagar", context: emptyContext(), session: emptySession() });
  assert.deepEqual(intent, { type: "GET_DISTANCE_BETWEEN", originQuery: "Charminar", query: "Farrukh Nagar" });
  assert.match(await engine.send("Check distance between Charminar and Farrukh Nagar"), /7.8 km/);
  assert.deepEqual(searched, ["Charminar", "Farrukh Nagar"]);
  assert.deepEqual(references, [origin, { id: "test:Charminar", name: "Charminar", lat: 17.36, lon: 78.47 }]);
  assert.equal(navigation.getSnapshot().route, null);
});

test("distance lookup reports missing endpoints and rejects a changed journey", async () => {
  const missingOrigin = engineFor(new NavigationController(async () => structuredClone(route)), { searchLocations: async () => [] });
  assert.match(await missingOrigin.send("Distance between Charminar and Farooq Nagar"), /could not find Charminar/);

  let destinationSearch = false;
  const missingDestination = engineFor(new NavigationController(async () => structuredClone(route)), { searchLocations: async (query) => {
    destinationSearch = query === "Farooq Nagar";
    return destinationSearch ? [] : [origin];
  } });
  assert.match(await missingDestination.send("Distance between Charminar and Farooq Nagar"), /could not find Farooq Nagar/);

  const navigation = new NavigationController(async () => structuredClone(route));
  const changed = engineFor(navigation, {
    searchLocations: async (query) => [{ id: `test:${query}`, name: query, lat: 1, lon: 2 }],
    requestRoute: async () => {
      await navigation.execute({ type: "SET_ROUTE", origin, destination });
      return route;
    },
  });
  await assert.rejects(changed.send("Distance between Charminar and Farooq Nagar"), /journey changed/);
});

test("destination parsing rejects option replies, current-location phrases, bare categories, and chained requests", () => {
  for (const text of ["option 2", "second one", "current location", "restaurants", "petrol station", "Navigate to A and then B", "Navigate to A and take me to B"]) {
    assert.equal(destinationInstruction(text), null, text);
  }
});

test("journey recalculation and start respect request ordering and status", async () => {
  let calls = 0;
  let finishRecalculation: (value: RouteResult) => void = () => {};
  const navigation = new NavigationController(() => {
    calls += 1;
    return calls === 2 ? new Promise<RouteResult>((resolve) => { finishRecalculation = resolve; }) : Promise.resolve(structuredClone(route));
  });
  await assert.rejects(navigation.execute({ type: "STOP_NAVIGATION", sourceText: "Hello there" }), /explicit stop instruction/);
  await navigation.execute({ type: "SET_ROUTE", origin, destination });
  navigation.startJourney();
  assert.throws(() => navigation.startJourney(), /not ready to start/);
  navigation.activateJourney();
  const recalculation = navigation.recalculateJourney(origin);
  await navigation.execute({ type: "SET_ROUTE", origin, destination });
  finishRecalculation(structuredClone(route));
  await assert.rejects(recalculation, /superseded by a newer navigation request/);
});

test("assistant failures that are not Errors use the generic message", async () => {
  const assistant = new ParallelAssistantService(async () => { throw "offline"; });
  await assert.rejects(assistant.ask("How far?", emptySession()), (error: unknown) => error === "offline");
  assert.equal(assistant.getSnapshot().error, "The assistant request failed.");
});

test("route progress for an empty geometry treats the traveller as arrived", () => {
  const progress = calculateRouteProgress({ ...route, geometry: { type: "LineString", coordinates: [] } }, { ...origin, accuracy: 5, timestamp: 0 } as never);
  assert.equal(progress.arrived, true);
  assert.equal(progress.percentage, 0);
});
