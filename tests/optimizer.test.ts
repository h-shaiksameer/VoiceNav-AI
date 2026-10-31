import assert from "node:assert/strict";
import { test } from "node:test";
import { osrmOptimizerProvider } from "@/optimizer/osrmProvider";
import { optimizeStops } from "@/optimizer/optimize";
import type { Location } from "@/types/domain";
import type { TravelMatrix } from "@/optimizer/types";

const matrix: TravelMatrix = {
  distancesMeters: [
    [0, 10, 1, 20],
    [10, 0, 2, 3],
    [1, 2, 0, 4],
    [20, 3, 4, 0],
  ],
  durationsSeconds: [
    [0, 10, 1, 20],
    [10, 0, 2, 3],
    [1, 2, 0, 4],
    [20, 3, 4, 0],
  ],
  traffic: { trafficAware: false },
};

const locations: Location[] = [
  { id: "one", name: "One", lat: 17, lon: 78 },
  { id: "two", name: "Two", lat: 17.01, lon: 78.01 },
  { id: "three", name: "Three", lat: 17.02, lon: 78.02 },
  { id: "four", name: "Four", lat: 17.03, lon: 78.03 },
];

test("optimizer chooses the fastest start and visiting order from a complete matrix", () => {
  const result = optimizeStops(matrix);
  assert.deepEqual(result.order, [0, 2, 1, 3]);
  assert.equal(result.startIndex, 0);
  assert.equal(result.totalDistanceMeters, 6);
  assert.equal(result.totalDurationSeconds, 6);
});

test("optimizer rejects incomplete travel matrices", () => {
  assert.throws(() => optimizeStops({ ...matrix, distancesMeters: matrix.distancesMeters.slice(0, 3) }), /complete travel matrix/);
});

test("optimizer route requests contain coordinates rather than location metadata", async (context) => {
  let requestBody: unknown;
  context.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ distanceMeters: 100, durationSeconds: 30, geometry: { type: "LineString", coordinates: [[78, 17], [78.03, 17.03]] } });
  });

  await osrmOptimizerProvider.getRoute(locations);
  assert.deepEqual(requestBody, { waypoints: locations.map(({ lat, lon }) => ({ lat, lon })) });
});
