import "server-only";
import { z } from "zod";
import { geometrySchema } from "@/types/schemas";
import type { Coordinates, RouteResult } from "@/types/domain";
import { cached, ServiceError, serializedRouting, upstream } from "@/services/server/http";

const responseSchema = z.object({ code: z.string(), routes: z.array(z.object({ distance: z.number().nonnegative(), duration: z.number().nonnegative(), geometry: geometrySchema })).optional() });
const matrixResponseSchema = z.object({ code: z.string(), distances: z.array(z.array(z.number().nonnegative().nullable())), durations: z.array(z.array(z.number().nonnegative().nullable())) });

export async function calculateTravelMatrix(waypoints: Coordinates[], identity: string): Promise<{ distancesMeters: number[][]; durationsSeconds: number[][]; traffic: { trafficAware: false } }> {
  if (waypoints.length < 2 || waypoints.length > 12) throw new ServiceError("Choose between two and twelve locations for optimization.", 422);
  const points = waypoints.map((point) => `${point.lon},${point.lat}`).join(";");
  return cached(`matrix:${points}`, 300_000, () => serializedRouting(async () => {
    const base = (process.env.OSRM_BASE_URL || "https://router.project-osrm.org").replace(/\/$/u, "");
    const response = matrixResponseSchema.parse(await upstream(`${base}/table/v1/driving/${points}?annotations=duration,distance`, identity));
    if (response.code !== "Ok") throw new ServiceError("No travel matrix was found for these locations. Choose more accessible locations and retry.", 422);
    const distancesMeters = response.distances.map((row) => row.map((value) => value ?? Number.POSITIVE_INFINITY));
    const durationsSeconds = response.durations.map((row) => row.map((value) => value ?? Number.POSITIVE_INFINITY));
    if (distancesMeters.some((row) => row.some((value) => !Number.isFinite(value))) || durationsSeconds.some((row) => row.some((value) => !Number.isFinite(value)))) throw new ServiceError("Some selected locations cannot be connected by road.", 422);
    return { distancesMeters, durationsSeconds, traffic: { trafficAware: false as const } };
  }));
}

export async function calculateRoutes(waypoints: Coordinates[], identity: string, alternatives = false): Promise<RouteResult[]> {
  const points = waypoints.map((point) => `${point.lon},${point.lat}`).join(";");
  return cached(`route:${points}:alternatives=${alternatives}`, 300_000, () => serializedRouting(async () => {
    const base = (process.env.OSRM_BASE_URL || "https://router.project-osrm.org").replace(/\/$/, "");
    const response = responseSchema.parse(await upstream(`${base}/route/v1/driving/${points}?overview=full&geometries=geojson&steps=false&alternatives=${alternatives}`, identity));
    if (response.code !== "Ok" || !response.routes?.length) throw new ServiceError("No driving route was found between these locations. Your previous route has been kept.", 422);
    return response.routes.slice(0, 3).map((route) => ({ distanceMeters: route.distance, durationSeconds: route.duration, geometry: route.geometry }));
  }));
}

export async function calculateRoute(waypoints: Coordinates[], identity: string): Promise<RouteResult> {
  return (await calculateRoutes(waypoints, identity))[0];
}