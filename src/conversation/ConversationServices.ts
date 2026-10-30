import { requestRoute, requestRouteAlternatives, searchLocations, searchPlaces } from "@/services/client";
import { requestCurrentLocation } from "@/services/geolocation";
import type { Coordinates, Location, PlaceCategory, PlaceResult, RouteResult } from "@/types/domain";

export interface ConversationServices {
  searchLocations(query: string, reference?: Location): Promise<Location[]>;
  searchPlaces(category: PlaceCategory, center: Coordinates, scope: "nearby" | "route", geometry?: RouteResult["geometry"]): Promise<PlaceResult[]>;
  requestRoute(waypoints: Coordinates[]): Promise<RouteResult>;
  requestRouteAlternatives(waypoints: Coordinates[]): Promise<RouteResult[]>;
  requestCurrentLocation(): Promise<Location>;
}

export const defaultConversationServices: ConversationServices = {
  searchLocations,
  searchPlaces,
  requestRoute,
  requestRouteAlternatives,
  requestCurrentLocation,
};