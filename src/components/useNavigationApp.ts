"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { PlaceSearch } from "@/conversation/ConversationEngine";
import type { DetourResult, Location, LocationTrackingStatus, PlaceCategory, PlaceResult, RouteResult, TrackedLocation } from "@/types/domain";
import { requestCurrentLocation } from "@/services/geolocation";
import { LocationTrackingService } from "@/services/LocationTrackingService";
import { MovementDetectionService, type MovementState } from "@/services/MovementDetectionService";
import { calculateRouteProgress, type RouteProgress } from "@/services/RouteProgressService";
import { ParallelAssistantService } from "@/services/ParallelAssistantService";
import { createNavigationRuntime } from "./navigationRuntime";

export function useNavigationApp() {
  const [origin, setOriginState] = useState<Location | null>(null);
  const [destination, setDestination] = useState<Location | null>(null);
  const [userLocation, setUserLocation] = useState<Location | null>(null);
  const [trackedLocation, setTrackedLocation] = useState<TrackedLocation | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<LocationTrackingStatus>("idle");
  const [movement, setMovement] = useState<MovementState>("UNKNOWN");
  const [progress, setProgress] = useState<RouteProgress | null>(null);
  const [offRouteReadings, setOffRouteReadings] = useState(0);
  const [search, setSearch] = useState<PlaceSearch | null>(null);
  const [selected, setSelected] = useState<PlaceResult | null>(null);
  const [detours, setDetours] = useState<DetourResult[]>([]);
  const [alternatives, setAlternatives] = useState<RouteResult[]>([]);
  const [category, setCategory] = useState<PlaceCategory>("fuel");
  const [scope, setScope] = useState<"nearby" | "route">("nearby");
  const [busy, setBusy] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [parallelAssistant] = useState(() => new ParallelAssistantService(async (query, current) => {
    const normalized = query.toLowerCase();
    if (!current.route) return "Calculate a route first. Your destination has not changed.";
    if (/traffic|congestion|jam|closure/.test(normalized)) return "Live traffic is not available. The route time is a static OSRM estimate without current congestion or closures.";
    if (/how far|distance|remaining/.test(normalized)) return `${current.destination?.name ?? "Your destination"} is ${Math.round(current.route.distanceMeters)} metres away on the planned route. This is the route total, not live remaining distance.`;
    if (/how long|eta|time|arrive/.test(normalized)) return `The planned route to ${current.destination?.name ?? "your destination"} is estimated at ${Math.ceil(current.route.durationSeconds / 60)} minutes. This is not live traffic-aware ETA.`;
    return `The route to ${current.destination?.name ?? "your destination"} is ready. Ask about distance, estimated time, or traffic. Your destination is unchanged.`;
  }));
  const parallelAssistantSnapshot = useSyncExternalStore(parallelAssistant.subscribe, parallelAssistant.getSnapshot, parallelAssistant.getSnapshot);
  const [locating, setLocating] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [placeError, setPlaceError] = useState("");
  const [movementDetector] = useState(() => new MovementDetectionService());
  const [runtime] = useState(() => createNavigationRuntime({
    onPlaces: (result) => { setSearch(result); setCategory(result.category); setScope(result.scope); setSelected(null); setDetours([]); },
    onSelectPlace: setSelected,
    onDetours: setDetours,
    onAlternatives: setAlternatives,
    onCurrentLocation: setUserLocation,
  }));
  const [tracking] = useState(() => new LocationTrackingService({
    onLocation: (location) => {
      setTrackedLocation(location); setUserLocation(location); setMovement(movementDetector.update(location));
      const current = runtime.navigation.getSnapshot();
      if (current.route) {
        const next = calculateRouteProgress(current.route, location);
        setProgress(next);
        setOffRouteReadings((count) => next.offRoute ? count + 1 : 0);
        if (next.arrived && current.status === "active") runtime.navigation.markArrived();
      }
    },
    onStatus: (status) => setTrackingStatus(status),
  }));
  const session = useSyncExternalStore(runtime.navigation.subscribe, runtime.navigation.getSnapshot, runtime.navigation.getSnapshot);
  const working = busy || assistantBusy || locating;

  useEffect(() => {
    if (session.status === "active") tracking.start();
    else if (session.status === "paused") tracking.pause();
    else if (["stopped", "idle", "arrived"].includes(session.status)) { tracking.stop(); movementDetector.reset(); }
  }, [movementDetector, session.status, tracking]);

  useEffect(() => () => { tracking.stop(); }, [tracking]);

  useEffect(() => runtime.navigation.subscribe(() => {
    const current = runtime.navigation.getSnapshot();
    if (current.origin) { runtime.setReferenceLocation(current.origin); setOriginState(current.origin); }
    setDestination(current.destination);
    setSearch(null); setSelected(null); setDetours([]); setAlternatives([]); setPlaceError("");
    if (!current.route) setScope("nearby");
  }), [runtime]);

  function setOrigin(value: Location | null) { runtime.setReferenceLocation(value); setOriginState(value); }
  function selectPlace(place: PlaceResult | null) { runtime.conversation.selectPlace(place); }

  async function locate() {
    if (working) return;
    setLocating(true); setRouteError("");
    try { const location = await requestCurrentLocation(); setUserLocation(location); setOrigin(location); }
    catch (error) { setRouteError(error instanceof Error ? error.message : "Your current location is unavailable. Enter an origin manually."); }
    finally { setLocating(false); }
  }

  async function calculateRoute() {
    if (working) return;
    if (!origin || !destination) { setRouteError("Search and select an exact origin and destination first."); return; }
    setBusy(true); setRouteError("");
    try { await runtime.navigation.execute({ type: "SET_ROUTE", origin, destination }); setDetours([]); }
    catch (error) { setRouteError(error instanceof Error ? error.message : "Route calculation failed. Your previous route is unchanged."); }
    finally { setBusy(false); }
  }

  async function startJourney() {
    if (working) return;
    if (!runtime.navigation.getSnapshot().route) { setRouteError("Calculate a route before starting a journey."); return; }
    setLocating(true); setRouteError("");
    try { const location = await requestCurrentLocation(); setUserLocation(location); runtime.navigation.startJourney(); runtime.navigation.activateJourney(); }
    catch (error) { setRouteError(error instanceof Error ? error.message : "A valid location is required to start the journey."); }
    finally { setLocating(false); }
  }

  function pauseJourney() { if (!working) runtime.navigation.pauseJourney(); }
  function resumeJourney() { if (!working) runtime.navigation.resumeJourney(); }
  function endJourney() { if (!working) runtime.navigation.endJourney(); }
  async function recalculateJourney() {
    if (working || !trackedLocation) return;
    setBusy(true); setRouteError("");
    try { await runtime.navigation.recalculateJourney(trackedLocation); setOffRouteReadings(0); }
    catch (error) { setRouteError(error instanceof Error ? error.message : "Route recalculation failed. Your current route is unchanged."); }
    finally { setBusy(false); }
  }
  async function askParallelAssistant(query: string) {
    if (working) return null;
    return parallelAssistant.ask(query, runtime.navigation.getSnapshot());
  }

  async function findPlaces() {
    if (working) return;
    setBusy(true); setPlaceError("");
    try { await runtime.conversation.find(category, scope); }
    catch (error) { setPlaceError(error instanceof Error ? error.message : "Place search failed."); }
    finally { setBusy(false); }
  }

  async function externalMessage(text: string) {
    if (working) return;
    setBusy(true); setPlaceError("");
    try { await runtime.conversation.send(text); }
    catch (error) { setPlaceError(error instanceof Error ? error.message : "The request could not be completed."); }
    finally { setBusy(false); }
  }

  async function stopRoute() {
    if (working) return;
    await runtime.navigation.execute({ type: "STOP_NAVIGATION", sourceText: "Stop navigation" });
    setDetours([]); setScope("nearby");
  }

  function navigateTo(place: PlaceResult) {
    const index = search?.places.findIndex((item) => item.id === place.id) ?? -1;
    if (index >= 0) void externalMessage(`Navigate to result ${index + 1}`);
  }

  return {
    origin, destination, session, userLocation, trackedLocation: ["active", "paused"].includes(session.status) ? trackedLocation : null, trackingStatus, movement, progress: ["active", "paused"].includes(session.status) ? progress : null, offRoute: ["active", "paused"].includes(session.status) && offRouteReadings >= 2, search, selected, detours, alternatives, category, scope, parallelAssistantSnapshot, parallelAssistant,
    working, busy, assistantBusy, locating, routeError, placeError, runtime,
    setOrigin, setDestination, setSelected: selectPlace, setCategory, setScope, setAssistantBusy,
    locate, calculateRoute, startJourney, pauseJourney, resumeJourney, endJourney, recalculateJourney, findPlaces, externalMessage, stopRoute, navigateTo, askParallelAssistant,
  };
}