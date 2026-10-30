import assert from "node:assert/strict";
import { test } from "node:test";
import { reportServiceResult, serviceAvailability } from "@/services/availability";
import { requestRoute, requestRouteAlternatives, searchLocations, searchPlaces } from "@/services/client";

test("service availability starts unknown, isolates outages, notifies, and recovers", () => {
  assert.equal(serviceAvailability.getServerSnapshot().places.status, "unknown");
  let notifications = 0;
  const unsubscribe = serviceAvailability.subscribe(() => { notifications += 1; });
  const before = serviceAvailability.getSnapshot();
  reportServiceResult("places", false, "HTTP 502");
  assert.equal(serviceAvailability.getSnapshot().places.status, "unavailable");
  assert.equal(serviceAvailability.getSnapshot().places.message, "HTTP 502");
  assert.equal(serviceAvailability.getSnapshot().route, before.route);
  assert.notEqual(serviceAvailability.getSnapshot(), before);
  reportServiceResult("places", false, "HTTP 502");
  assert.equal(notifications, 1);
  reportServiceResult("places", true);
  assert.equal(serviceAvailability.getSnapshot().places.status, "available");
  assert.equal(notifications, 2);
  unsubscribe();
  reportServiceResult("route", true);
  assert.equal(notifications, 2);
});

test("place HTTP outages and rate limits become unavailable and successful retries recover", async (context) => {
  for (const status of [502, 503, 504, 429]) {
    context.mock.method(globalThis, "fetch", async () => Response.json({ error: "Provider unavailable" }, { status }));
    await assert.rejects(searchPlaces("restaurant", { lat: 1, lon: 2 }, "nearby"), /Provider unavailable/);
    assert.equal(serviceAvailability.getSnapshot().places.status, "unavailable");
    context.mock.restoreAll();
  }
  context.mock.method(globalThis, "fetch", async () => Response.json([]));
  assert.deepEqual(await searchPlaces("restaurant", { lat: 1, lon: 2 }, "nearby"), []);
  assert.equal(serviceAvailability.getSnapshot().places.status, "available");
});

test("validation errors do not claim a provider outage", async (context) => {
  reportServiceResult("places", true);
  context.mock.method(globalThis, "fetch", async () => Response.json({ error: "Invalid route" }, { status: 422 }));
  await assert.rejects(searchPlaces("fuel", { lat: 1, lon: 2 }, "route"), /Invalid route/);
  assert.equal(serviceAvailability.getSnapshot().places.status, "available");
});

test("network, unreadable JSON and schema failures are unavailable, never fabricated results", async (context) => {
  const responses = [
    async () => { throw new Error("offline"); },
    async () => new Response("not json", { status: 502 }),
    async () => Response.json({ unexpected: true }),
    async () => Response.json({}, { status: 500 }),
  ];
  for (const fetchResponse of responses) {
    context.mock.method(globalThis, "fetch", fetchResponse);
    await assert.rejects(searchLocations("London"));
    assert.equal(serviceAvailability.getSnapshot().geocode.status, "unavailable");
    context.mock.restoreAll();
  }
});

test("API clients preserve country, corridor, and alternatives request contracts", async (context) => {
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const route = { distanceMeters: 100, durationSeconds: 30, geometry: { type: "LineString", coordinates: [[2, 1], [3, 2]] } };
  context.mock.method(globalThis, "fetch", async (path: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push({ path, body });
    return Response.json(path === "/api/route" ? body.alternatives ? [route] : route : []);
  });
  await searchLocations("A place", { id: "origin", name: "Origin", lat: 1, lon: 2, countryCode: "in" });
  assert.equal(requests[0].body.countryCode, "in");
  assert.deepEqual(requests[0].body.reference, { lat: 1, lon: 2 });
  await searchLocations("An origin");
  assert.equal(requests[1].body.reference, undefined);
  const points = [{ lat: 1, lon: 2 }, { lat: 2, lon: 3 }];
  assert.deepEqual(await requestRoute(points), route);
  assert.deepEqual(await requestRouteAlternatives(points), [route]);
  assert.equal(requests[3].body.alternatives, true);
  await searchPlaces("fuel", points[0], "route", route.geometry as Parameters<typeof searchPlaces>[3]);
  assert.deepEqual(requests[4].body.geometry, route.geometry);
  await searchPlaces("fuel", points[0], "nearby", route.geometry as Parameters<typeof searchPlaces>[3]);
  assert.equal(requests[5].body.geometry, undefined);
  context.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 400 }));
  await assert.rejects(requestRoute(points), /request failed/);
});