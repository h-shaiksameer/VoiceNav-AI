import { z } from "zod";

export const coordinatesSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
});
export const countryCodeSchema = z.string().regex(/^[a-z]{2}$/i).transform((value) => value.toLowerCase());
export const locationSchema = coordinatesSchema.extend({ id: z.string().min(1).max(240), name: z.string().min(1).max(600), countryCode: countryCodeSchema.optional() });
export const categorySchema = z.enum(["fuel", "restaurant", "hospital", "pharmacy", "atm", "parking", "cafe", "charging_station"]);
export const geometrySchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(2).max(25000),
});
export const routeSchema = z.object({ distanceMeters: z.number().nonnegative(), durationSeconds: z.number().nonnegative(), geometry: geometrySchema });
export const placeSchema = locationSchema.extend({ category: categorySchema, distanceMeters: z.number().nonnegative(), address: z.string().optional(), openingHours: z.string().optional(), website: z.string().optional() });
export const placesRequestSchema = z.object({
  category: categorySchema,
  center: coordinatesSchema,
  scope: z.enum(["nearby", "route"]),
  geometry: geometrySchema.optional(),
}).refine((value) => value.scope !== "route" || !!value.geometry, "An active route is required.");
export const intentSchema = z.object({
  type: z.enum(["GET_ETA", "GET_ROUTE_DISTANCE", "GET_DISTANCE_BETWEEN", "GET_TRAVEL_TIME_BETWEEN", "LOOKUP_LOCATION", "GET_TRAFFIC", "GET_ROUTE_ALTERNATIVES", "PLAN_ROUTE", "SEARCH_NEARBY", "SEARCH_ALONG_ROUTE", "COMPARE_OPTIONS", "GET_PLACE_DETAILS", "CHANGE_DESTINATION", "STOP_NAVIGATION", "MAP_ZOOM", "CLARIFY"]),
  category: categorySchema.optional(),
  reference: z.number().int().min(0).max(11).optional(),
  query: z.string().max(300).optional(),
  originQuery: z.string().max(300).optional(),
  clarification: z.string().max(500).optional(),
  mapAction: z.enum(["zoom-in", "zoom-out", "reset", "center", "pan-left", "pan-right", "pan-up", "pan-down"]).optional(),
}).strict();

export const navigationActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SET_ROUTE"), origin: locationSchema, destination: locationSchema }).strict(),
  z.object({ type: z.literal("PLAN_ROUTE"), origin: locationSchema, destination: locationSchema, sourceText: z.string().max(500), confirmed: z.literal(true), allowedIds: z.array(z.string().min(1)).min(1).max(12), expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("CHANGE_DESTINATION"), destination: locationSchema, sourceText: z.string().max(500), confirmed: z.literal(true), allowedIds: z.array(z.string().min(1)).min(1).max(12), expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("STOP_NAVIGATION"), sourceText: z.string().max(500) }).strict(),
]);