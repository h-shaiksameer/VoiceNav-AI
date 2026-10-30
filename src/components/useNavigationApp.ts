"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { NavigationController } from "@/navigation/NavigationController";
import { ConversationEngine, type PlaceSearch } from "@/conversation/ConversationEngine";
import type { DetourResult, Location, PlaceCategory, PlaceResult, RouteResult } from "@/types/domain";
import { requestRoute } from "@/services/client";
import { requestCurrentLocation } from "@/services/geolocation";

export function useNavigationApp() {
  const [origin, setOriginState] = useState<Location | null>(null);
  const [destination, setDestination] = useState<Location | null>(null);
  const [userLocation, setUserLocation] = useState<Location | null>(null);
  const reference = useRef<Location | null>(null);
  const [search, setSearch] = useState<PlaceSearch | null>(null);
  const [selected, setSelected] = useState<PlaceResult | null>(null);
  const [detours, setDetours] = useState<DetourResult[]>([]);
  const [alternatives, setAlternatives] = useState<RouteResult[]>([]);
  const [category, setCategory] = useState<PlaceCategory>("fuel");
  const [scope, setScope] = useState<"nearby" | "route">("nearby");
  const [busy, setBusy] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [placeError, setPlaceError] = useState("");
  const [runtime] = useState(() => {
    const navigation = new NavigationController(requestRoute);
    const conversation = new ConversationEngine(navigation, {
      onPlaces: (result) => { setSearch(result); setCategory(result.category); setScope(result.scope); setSelected(null); setDetours([]); },
      onSelectPlace: setSelected,
      onDetours: setDetours,
      onAlternatives: setAlternatives,
      onCurrentLocation: setUserLocation,
      getReferenceLocation: () => reference.current,
    });
    return { navigation, conversation };
  });
  const session = useSyncExternalStore(runtime.navigation.subscribe, runtime.navigation.getSnapshot, runtime.navigation.getSnapshot);
  const working = busy || assistantBusy || locating;

  useEffect(() => runtime.navigation.subscribe(() => {
    const current = runtime.navigation.getSnapshot();
    if (current.origin) { reference.current = current.origin; setOriginState(current.origin); }
    setDestination(current.destination);
    setSearch(null); setSelected(null); setDetours([]); setAlternatives([]); setPlaceError("");
    if (!current.route) setScope("nearby");
  }), [runtime]);

  function setOrigin(value: Location | null) { reference.current = value; setOriginState(value); }
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
    origin, destination, session, userLocation, search, selected, detours, alternatives, category, scope,
    working, busy, assistantBusy, locating, routeError, placeError, runtime,
    setOrigin, setDestination, setSelected: selectPlace, setCategory, setScope, setAssistantBusy,
    locate, calculateRoute, findPlaces, externalMessage, stopRoute, navigateTo,
  };
}