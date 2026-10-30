import assert from "node:assert/strict";
import { test } from "node:test";
import { api, cached, serializedGeocode, serializedRouting, ServiceError, throttle, upstream } from "@/services/server/http";
import { NextRequest } from "next/server";
import { z } from "zod";
import { geocode } from "@/services/geocoding/server";
import { calculateRoute, calculateRoutes } from "@/services/routing/server";
import { findPlaces } from "@/services/places/server";
import { POST as geocodePost } from "@/app/api/geocode/route";
import { POST as routePost } from "@/app/api/route/route";
import { POST as placesPost } from "@/app/api/places/route";

test("server cache deduplicates in-flight work, caches successes, and retries failures", async () => {
  let calls = 0;
  const load = async () => { calls += 1; return "value"; };
  assert.deepEqual(await Promise.all([cached("dedupe", 1000, load), cached("dedupe", 1000, load)]), ["value", "value"]);
  assert.equal(await cached("dedupe", 1000, load), "value");
  assert.equal(calls, 1);
  await assert.rejects(cached("failure", 1000, async () => { throw new Error("offline"); }));
  assert.equal(await cached("failure", 1000, load), "value");
  assert.equal(calls, 2);
});

test("throttling blocks repeated upstream searches", () => {
  throttle("test-service", 5000);
  assert.throws(() => throttle("test-service", 5000), (error: unknown) => error instanceof ServiceError && error.status === 429);
});

test("upstream classifies rate limits, outages, timeouts, malformed JSON and success", async (context) => {
  for (const [status, expected] of [[429, 429], [502, 502]]) {
    context.mock.method(globalThis, "fetch", async () => new Response("error", { status }));
    await assert.rejects(upstream("https://example.test", "test"), (error: unknown) => error instanceof ServiceError && error.status === expected);
    context.mock.restoreAll();
  }
  for (const name of ["TimeoutError", "AbortError", "NetworkError"]) {
    context.mock.method(globalThis, "fetch", async () => { throw new DOMException("failure", name); });
    await assert.rejects(upstream("https://example.test", "test"), (error: unknown) => error instanceof ServiceError && error.status === (name === "NetworkError" ? 502 : 504));
    context.mock.restoreAll();
  }
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const headers = new Headers(init.headers);
    assert.equal(headers.get("Accept"), "application/json");
    assert.match(headers.get("User-Agent")!, /VoiceNav-AI/);
    assert.equal(init.cache, "no-store");
    return Response.json({ valid: true });
  });
  assert.deepEqual(await upstream("https://example.test", "test"), { valid: true });
});

test("cache expiration and bounded capacity reload rather than returning stale values", async (context) => {
  let now = Date.now();
  context.mock.method(Date, "now", () => now);
  assert.equal(await cached("expiry", 10, async () => 1), 1);
  now += 11;
  assert.equal(await cached("expiry", 10, async () => 2), 2);
  for (let index = 0; index < 301; index += 1) await cached(`capacity:${index}`, 1000, async () => index);
  assert.equal(await cached("capacity:0", 1000, async () => -1), -1);
});

test("serialized service queues bound concurrent requests and recover from failed jobs", async (context) => {
  let now = Date.now() + 100_000;
  context.mock.method(Date, "now", () => { now += 2000; return now; });
  const jobs = Array.from({ length: 7 }, (_, index) => serializedGeocode(async () => {
    if (index === 0) throw new Error("first fails");
    return index;
  }));
  const results = await Promise.allSettled(jobs);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[5].status, "fulfilled");
  assert.equal(results[6].status, "rejected");
  assert.equal(await serializedRouting(async () => "route"), "route");
});

test("API boundary rejects unsafe requests before invoking services", async () => {
  let calls = 0;
  const schema = z.object({ query: z.string().min(3) });
  const handle = async () => { calls += 1; return { ok: true }; };
  const request = (body?: string, headers: Record<string, string> = {}) => new NextRequest("https://app.test/api/test", { method: "POST", headers, body });
  const cases: [NextRequest, number][] = [
    [request("{}", { origin: "https://evil.test" }), 403],
    [request("{}"), 415],
    [request("{}", { "content-type": "application/json", "content-length": "1500001" }), 413],
    [request(undefined, { "content-type": "application/json" }), 400],
    [request("not json", { "content-type": "application/json" }), 400],
    [request("{}", { "content-type": "application/json" }), 400],
    [request("x".repeat(1_500_001), { "content-type": "application/json" }), 413],
  ];
  for (const [input, status] of cases) assert.equal((await api(input, schema, handle)).status, status);
  assert.equal(calls, 0);
  const valid = () => request('{"query":"valid"}', { "content-type": "application/json", origin: "https://app.test" });
  const success = await api(valid(), schema, handle);
  assert.equal(success.status, 200);
  assert.equal(success.headers.get("Cache-Control"), "no-store");
  assert.equal(calls, 1);
  assert.equal((await api(valid(), schema, async () => { throw new ServiceError("busy", 429); })).status, 429);
  const failure = await api(valid(), schema, async () => { throw new Error("private server detail"); });
  assert.equal(failure.status, 502);
  assert.doesNotMatch(JSON.stringify(await failure.json()), /private server detail/);
});

test("Nominatim filters countries, resolves GPS country, preserves IDs, and caches requests", async (context) => {
  let now = Date.now() + 1_000_000;
  context.mock.method(Date, "now", () => { now += 6000; return now; });
  const requests: URL[] = [];
  context.mock.method(globalThis, "fetch", async (value: string | URL) => {
    const url = new URL(value);
    requests.push(url);
    if (url.pathname.endsWith("reverse")) return Response.json({ address: { country_code: "IN" } });
    return Response.json([
      { place_id: 1, osm_type: "node", osm_id: 55, lat: "17", lon: "78", display_name: "Indian address", address: { country_code: "in" } },
      { place_id: 2, lat: "51", lon: "0", display_name: "British address", address: { country_code: "gb" } },
      { place_id: 3, lat: "18", lon: "79", display_name: "Unverified address" },
    ]);
  });
  const scoped = await geocode("Scoped fixture", "test", { lat: 17, lon: 78 });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].id, "osm:node:55");
  assert.equal(scoped[0].countryCode, "in");
  assert.equal(requests[1].searchParams.get("countrycodes"), "in");
  assert.equal(requests[1].searchParams.get("limit"), "5");
  await geocode("Scoped fixture", "test", { lat: 17, lon: 78 });
  assert.equal(requests.length, 2);
  const global = await geocode("Global fixture", "test");
  assert.equal(global.length, 3);
  assert.equal(global[1].id, "nominatim:2");
  assert.equal(requests.at(-1)?.searchParams.has("countrycodes"), false);
  assert.equal((await geocode("Explicit country", "test", undefined, "gb"))[0].id, "nominatim:2");
  context.mock.method(globalThis, "fetch", async () => Response.json({ address: {} }));
  await assert.rejects(geocode("Missing country", "test", { lat: 19, lon: 79 }), /country could not be verified/);
  context.mock.method(globalThis, "fetch", async () => Response.json([{ place_id: 1, lat: 999, lon: 0, display_name: "Invalid" }]));
  await assert.rejects(geocode("Invalid coordinates", "test"));
});

test("OSRM request order, alternatives bounds, and no-route failures are validated", async (context) => {
  let now = Date.now() + 2_000_000;
  context.mock.method(Date, "now", () => { now += 6000; return now; });
  const geometry = { type: "LineString", coordinates: [[78, 17], [78.01, 17.01]] };
  const route = { distance: 500, duration: 100, geometry };
  context.mock.method(globalThis, "fetch", async (url: string) => {
    assert.match(url, /78,17;78.01,17.01/);
    return Response.json({ code: "Ok", routes: [route, route, route, route] });
  });
  const points = [{ lat: 17, lon: 78 }, { lat: 17.01, lon: 78.01 }];
  assert.equal((await calculateRoutes(points, "test", true)).length, 3);
  assert.equal((await calculateRoute(points, "test")).distanceMeters, 500);
  for (const [index, response] of [{ code: "NoRoute" }, { code: "Ok", routes: [] }, { code: "Ok", routes: [{ ...route, duration: -1 }] }].entries()) {
    context.mock.method(globalThis, "fetch", async () => Response.json(response));
    await assert.rejects(calculateRoute([{ lat: 20 + index, lon: 78 }, points[1]], "test"));
  }
});

test("Overpass handles nodes, centers, missing coordinates, corridor filtering, bounds and outages", async (context) => {
  let now = Date.now() + 3_000_000;
  context.mock.method(Date, "now", () => { now += 6000; return now; });
  const requests: string[] = [];
  const elements = [
    { type: "node", id: 1, lat: 17, lon: 78, tags: { name: "Named cafe", "addr:housenumber": "5", "addr:street": "Road", "addr:city": "Town", opening_hours: "24/7", website: "https://example.test" } },
    { type: "way", id: 2, center: { lat: 17.001, lon: 78.001 }, tags: { brand: "Brand cafe" } },
    { type: "relation", id: 3, lat: 17.002, lon: 78.002 },
    { type: "node", id: 4 },
    { type: "node", id: 5, lat: 91, lon: 78 },
    { type: "node", id: 6, lat: 17, lon: 181 },
    { type: "node", id: 7, lat: 18, lon: 79 },
  ];
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests.push(new URLSearchParams(String(init.body)).get("data")!);
    return Response.json({ elements });
  });
  const input = { category: "cafe" as const, center: { lat: 17, lon: 78 }, scope: "nearby" as const };
  const results = await findPlaces(input, "test");
  assert.equal(results.length, 4);
  assert.equal(results[0].address, "5 Road Town");
  assert.equal(results[1].name, "Brand cafe");
  assert.equal(results[2].name, "Unnamed cafe");
  assert.match(requests[0], /around:5000,17,78/);
  await findPlaces(input, "test");
  assert.equal(requests.length, 1);
  const geometry = { type: "LineString" as const, coordinates: [[78, 17], [78.01, 17.01]] as [number, number][] };
  const corridor = await findPlaces({ ...input, scope: "route", geometry }, "test");
  assert.equal(corridor.length, 3);
  assert.match(requests[1], /around:1500/);
  await assert.rejects(findPlaces({ ...input, scope: "route", geometry: { ...geometry, coordinates: [[0, 0], [10, 10]] } }, "test"), /150 km/);
  const dense = { ...geometry, coordinates: Array.from({ length: 180 }, (_, index) => [78 + index / 100_000, 17] as [number, number]) };
  await findPlaces({ ...input, scope: "route", geometry: dense }, "test");
  context.mock.method(globalThis, "fetch", async () => Response.json({ remark: "timeout", elements: [] }));
  await assert.rejects(findPlaces({ ...input, category: "fuel" }, "test"), /partial results have not been used/);
  context.mock.method(globalThis, "fetch", async () => new Response("Bad gateway", { status: 502 }));
  await assert.rejects(findPlaces({ ...input, category: "hospital" }, "test"), /HTTP 502/);
  context.mock.method(globalThis, "fetch", async () => Response.json({ elements: Array.from({ length: 20 }, (_, index) => ({ type: "node", id: index, lat: 17, lon: 78 + index / 10000 })) }));
  assert.equal((await findPlaces({ ...input, category: "atm" }, "test")).length, 12);
});

test("all API endpoints validate contracts and return adapter results", async (context) => {
  let now = Date.now() + 4_000_000;
  context.mock.method(Date, "now", () => { now += 6000; return now; });
  const geometry = { type: "LineString", coordinates: [[80, 20], [80.01, 20.01]] };
  context.mock.method(globalThis, "fetch", async (url: string | URL) => {
    if (String(url).includes("/search?")) return Response.json([]);
    if (String(url).includes("/route/v1")) return Response.json({ code: "Ok", routes: [{ distance: 100, duration: 20, geometry }] });
    return Response.json({ elements: [] });
  });
  const request = (body: unknown) => new NextRequest("https://app.test/api/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await geocodePost(request({ query: "API fixture", countryCode: "IN" }))).status, 200);
  const waypoints = [{ lat: 20, lon: 80 }, { lat: 20.01, lon: 80.01 }];
  assert.equal((await routePost(request({ waypoints }))).status, 200);
  assert.equal((await routePost(request({ waypoints, alternatives: true }))).status, 200);
  assert.equal((await routePost(request({ waypoints: [...waypoints, waypoints[0]], alternatives: true }))).status, 400);
  assert.equal((await placesPost(request({ category: "parking", center: waypoints[0], scope: "nearby" }))).status, 200);
  assert.equal((await placesPost(request({ category: "parking", center: waypoints[0], scope: "route" }))).status, 400);
  assert.equal((await placesPost(request({ category: "parking", center: waypoints[0], scope: "route", geometry }))).status, 200);
});