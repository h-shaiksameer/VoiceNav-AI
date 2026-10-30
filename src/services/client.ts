import { z } from "zod";
import { locationSchema, placeSchema, routeSchema } from "@/types/schemas";
import type { Coordinates, Location, PlaceCategory, RouteResult } from "@/types/domain";

async function post<Value>(path: string, body: unknown, schema: z.ZodType<Value>): Promise<Value> {
  let response: Response;
  try {
    response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  } catch { throw new Error("Request failed or timed out. Check your internet connection and try again."); }
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error("The server returned an unreadable response. Please retry."); }
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(data);
    throw new Error(error.success ? error.data.error : "The request failed. Please try again.");
  }
  const result = schema.safeParse(data);
  if (!result.success) throw new Error("The server returned invalid location data. Your current route has been kept.");
  return result.data;
}

export const searchLocations = (query: string, reference?: Location) => post("/api/geocode", { query, ...(reference ? { reference: { lat: reference.lat, lon: reference.lon }, ...(reference.countryCode ? { countryCode: reference.countryCode } : {}) } : {}) }, z.array(locationSchema));
export const requestRoute = (waypoints: Coordinates[]) => post("/api/route", { waypoints }, routeSchema);
export const requestRouteAlternatives = (waypoints: Coordinates[]) => post("/api/route", { waypoints, alternatives: true }, z.array(routeSchema).min(1).max(3));
export const searchPlaces = (category: PlaceCategory, center: Coordinates, scope: "nearby" | "route", geometry?: RouteResult["geometry"]) => post("/api/places", { category, center, scope, geometry: scope === "route" ? geometry : undefined }, z.array(placeSchema));