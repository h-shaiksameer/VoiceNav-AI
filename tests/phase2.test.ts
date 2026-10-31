import assert from "node:assert/strict";
import { test } from "node:test";
import { NavigationController } from "@/navigation/NavigationController";
import { LocationTrackingService } from "@/services/LocationTrackingService";
import { MovementDetectionService } from "@/services/MovementDetectionService";
import { ParallelAssistantService } from "@/services/ParallelAssistantService";
import { calculateRouteProgress } from "@/services/RouteProgressService";
import type { Location, NavigationSession, RouteResult, TrackedLocation } from "@/types/domain";

const origin: Location = { id: "origin", name: "Origin", lat: 0, lon: 0 };
const destination: Location = { id: "destination", name: "Destination", lat: 0, lon: 0.01 };
const route: RouteResult = { distanceMeters: 1110, durationSeconds: 120, geometry: { type: "LineString", coordinates: [[0, 0], [0.01, 0]] } };
const tracked = (lon: number, timestamp: number, accuracyMeters = 5): TrackedLocation => ({ id: "device:current", name: "Current location", lat: 0, lon, timestamp, accuracyMeters });

test("journey lifecycle preserves the route and rejects invalid transitions", async () => {
  const navigation = new NavigationController(async () => route);
  assert.throws(() => navigation.startJourney(), /Calculate a route/);
  await navigation.execute({ type: "SET_ROUTE", origin, destination });
  assert.equal(navigation.startJourney().status, "starting");
  assert.equal(navigation.activateJourney().status, "active");
  assert.equal(navigation.pauseJourney().status, "paused");
  assert.equal(navigation.resumeJourney().status, "active");
  const liveLocation = { ...origin, id: "device:current", name: "Current location", lon: 0.002 };
  assert.equal((await navigation.recalculateJourney(liveLocation)).status, "active");
  assert.equal(navigation.getSnapshot().origin?.id, "device:current");
  assert.equal(navigation.markArrived().status, "arrived");
  assert.deepEqual(navigation.getSnapshot().route, route);
  assert.throws(() => navigation.markArrived(), /active journey/);
  assert.equal(navigation.endJourney().status, "stopped");
  assert.deepEqual(navigation.getSnapshot().route, route);
});

test("a superseded route request cannot overwrite the latest navigation choice", async () => {
  let releaseFirst!: () => void;
  let calls = 0;
  const navigation = new NavigationController(async () => {
    calls += 1;
    if (calls === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
    return route;
  });
  const first = navigation.execute({ type: "SET_ROUTE", origin, destination });
  const second = navigation.execute({ type: "SET_ROUTE", origin, destination });
  await second;
  releaseFirst();
  await assert.rejects(first, /superseded/);
  assert.equal(navigation.getSnapshot().status, "ready");
});

test("journey lifecycle guards reject actions without the required state", async () => {
  const navigation = new NavigationController(async () => route);
  assert.throws(() => navigation.activateJourney(), /starting/);
  assert.throws(() => navigation.pauseJourney(), /active/);
  assert.throws(() => navigation.resumeJourney(), /paused/);
  assert.throws(() => navigation.endJourney(), /no journey/);
  await assert.rejects(navigation.recalculateJourney(origin), /active or paused/);
  await navigation.execute({ type: "SET_ROUTE", origin, destination });
  assert.throws(() => navigation.activateJourney(), /starting/);
  assert.equal(navigation.endJourney().status, "stopped");
});

test("route progress reports completion, arrival, and off-route readings", () => {
  const nearStart = calculateRouteProgress(route, tracked(0.001, 1000));
  const nearEnd = calculateRouteProgress(route, tracked(0.01, 2000));
  const offRoute = calculateRouteProgress(route, { ...tracked(0.005, 3000), lat: 0.002 });
  assert.equal(nearStart.arrived, false);
  assert.equal(nearEnd.arrived, true);
  assert.equal(nearEnd.percentage, 100);
  assert.equal(offRoute.offRoute, true);
  assert.ok(offRoute.remainingDistanceMeters > 0);
  const degenerate = calculateRouteProgress({ ...route, geometry: { type: "LineString", coordinates: [[0, 0], [0, 0]] } }, tracked(0, 4000));
  assert.equal(degenerate.percentage, 0);
});

test("movement detection ignores unusable intervals and classifies meaningful movement", () => {
  const detector = new MovementDetectionService();
  assert.equal(detector.update(tracked(0, 1000)), "UNKNOWN");
  assert.equal(detector.update(tracked(0.00001, 2000)), "STATIONARY");
  assert.equal(detector.update(tracked(0.001, 3000)), "MOVING");
  assert.equal(detector.update({ ...tracked(0.002, 4000), accuracyMeters: 101 }), "UNKNOWN");
  assert.equal(detector.update(tracked(0.003, 305000)), "UNKNOWN");
  assert.equal(detector.update(tracked(0.004, 305000)), "UNKNOWN");
  assert.equal(detector.update({ ...tracked(0.004, 306000), accuracyMeters: 50 }), "STATIONARY");
  detector.reset();
  assert.equal(detector.update(tracked(0, 5000)), "UNKNOWN");
});

test("location tracking filters stale and poor fixes and cleans up the watcher", () => {
  const statuses: string[] = [];
  const locations: TrackedLocation[] = [];
  let success: ((position: GeolocationPosition) => void) | undefined;
  let cleared: number | null = null;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation: {
    watchPosition: (onSuccess: (position: GeolocationPosition) => void) => { success = onSuccess; return 7; },
    clearWatch: (id: number) => { cleared = id; },
  } } });
  const service = new LocationTrackingService({ onLocation: (location) => locations.push(location), onStatus: (status) => statuses.push(status) });
  service.start();
  success?.({ timestamp: 1000, coords: { latitude: 0, longitude: 0, accuracy: 5 } } as GeolocationPosition);
  success?.({ timestamp: 900, coords: { latitude: 0, longitude: 0.01, accuracy: 5 } } as GeolocationPosition);
  success?.({ timestamp: 2000, coords: { latitude: 0, longitude: 0.01, accuracy: 100 } } as GeolocationPosition);
  assert.equal(locations.length, 1);
  service.pause();
  assert.equal(cleared, 7);
  service.stop();
  assert.equal(service.getLatest(), null);
  assert.deepEqual(statuses.slice(0, 3), ["waiting", "active", "paused"]);
});

test("location tracking handles unsupported devices, invalid fixes, duplicate starts, and GPS errors", () => {
  const statuses: string[] = [];
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Reflect.deleteProperty(globalThis, "navigator");
  new LocationTrackingService({ onLocation: () => {}, onStatus: (status) => statuses.push(status) }).start();
  assert.equal(statuses.at(-1), "unavailable");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  const unsupported = new LocationTrackingService({ onLocation: () => {}, onStatus: (status) => statuses.push(status) });
  unsupported.start();
  assert.equal(statuses.at(-1), "unavailable");
  unsupported.pause();
  unsupported.stop();

  let success: ((position: GeolocationPosition) => void) | undefined;
  let failure: ((error: GeolocationPositionError) => void) | undefined;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation: {
    watchPosition: (onSuccess: (position: GeolocationPosition) => void, onFailure: (error: GeolocationPositionError) => void) => { success = onSuccess; failure = onFailure; return 9; },
    clearWatch: () => {},
  } } });
  const service = new LocationTrackingService({ onLocation: () => {}, onStatus: (status) => statuses.push(status) });
  service.start();
  service.start();
  success?.({ timestamp: 1000, coords: { latitude: 100, longitude: 0, accuracy: 5 } } as GeolocationPosition);
  success?.({ timestamp: 2000, coords: { latitude: 0, longitude: 0, accuracy: -1 } } as GeolocationPosition);
  success?.({ timestamp: 3000, coords: { latitude: 0, longitude: 0, accuracy: Number.NaN } } as GeolocationPosition);
  failure?.({ code: 1 } as GeolocationPositionError);
  failure?.({ code: 2 } as GeolocationPositionError);
  failure?.({ code: 3 } as GeolocationPositionError);
  assert.deepEqual(statuses.slice(-3), ["permission_denied", "unavailable", "error"]);
  service.stop();
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
});

test("parallel assistant cancels stale requests and never changes navigation state", async () => {
  const session: NavigationSession = { revision: 3, status: "active", origin, destination, route };
  let releaseFirst!: (answer: string) => void;
  const assistant = new ParallelAssistantService(async (query) => query === "first" ? new Promise<string>((resolve) => { releaseFirst = resolve; }) : "second answer");
  const first = assistant.ask("first", session);
  const second = assistant.ask("second", session);
  assert.equal(await second, "second answer");
  releaseFirst("stale answer");
  assert.equal(await first, null);
  assert.equal(assistant.getSnapshot().answer, "second answer");
  assert.equal(assistant.getSnapshot().status, "complete");
});

test("parallel assistant handles empty, cancelled, failed, and unsubscribed requests", async () => {
  const session: NavigationSession = { revision: 1, status: "ready", origin, destination, route };
  let release!: () => void;
  const assistant = new ParallelAssistantService(async (query) => {
    if (query === "fail") throw new Error("provider failed");
    if (query === "wait") return new Promise<string>((resolve) => { release = () => resolve("late"); });
    return "ok";
  });
  let notifications = 0;
  const unsubscribe = assistant.subscribe(() => { notifications += 1; });
  assert.equal(await assistant.ask("   ", session), null);
  const waiting = assistant.ask("wait", session);
  assistant.cancel();
  release();
  assert.equal(await waiting, null);
  await assert.rejects(assistant.ask("fail", session), /provider failed/);
  assert.equal(assistant.getSnapshot().status, "error");
  assistant.cancel();
  unsubscribe();
  const before = notifications;
  assert.equal(await assistant.ask("ok", session), "ok");
  assert.equal(notifications, before);
  const idleAssistant = new ParallelAssistantService(async () => "unused");
  idleAssistant.cancel();
});

test("a stale assistant failure is ignored after a newer request starts", async () => {
  const session: NavigationSession = { revision: 1, status: "ready", origin, destination, route };
  let rejectFirst!: (error: Error) => void;
  const assistant = new ParallelAssistantService(async (query) => query === "first" ? new Promise<string>((_resolve, reject) => { rejectFirst = reject; }) : "latest");
  const first = assistant.ask("first", session);
  const second = assistant.ask("second", session);
  assert.equal(await second, "latest");
  rejectFirst(new Error("stale failure"));
  assert.equal(await first, null);
  assert.equal(assistant.getSnapshot().answer, "latest");
});