import "server-only";
import { z } from "zod";
import { geometrySchema } from "@/types/schemas";
import type { Coordinates, RouteResult } from "@/types/domain";
import { cached, ServiceError, serializedRouting, upstream } from "@/services/server/http";

const responseSchema = z.object({ code: z.string(), routes: z.array(z.object({ distance: z.number().nonnegative(), duration: z.number().nonnegative(), geometry: geometrySchema })).optional() });

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