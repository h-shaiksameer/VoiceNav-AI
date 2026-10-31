import { z } from "zod";
import type { Location, RouteResult } from "@/types/domain";
import { requestRoute } from "@/services/client";
import type { RoutingMatrixProvider, TrafficProfile, TravelMatrix } from "./types";

const matrixSchema = z.object({ distancesMeters: z.array(z.array(z.number())), durationsSeconds: z.array(z.array(z.number())), traffic: z.object({ trafficAware: z.literal(false) }) });

export const osrmOptimizerProvider: RoutingMatrixProvider = {
  async getMatrix(locations: Location[], _traffic?: TrafficProfile): Promise<TravelMatrix> {
    const response = await fetch("/api/route/matrix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ waypoints: locations.map(({ lat, lon }) => ({ lat, lon })) }) });
    const data: unknown = await response.json();
    if (!response.ok) throw new Error(data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Travel matrix unavailable.");
    return matrixSchema.parse(data);
  },
  getRoute(locations: Location[]): Promise<RouteResult> {
    return requestRoute(locations.map(({ lat, lon }) => ({ lat, lon })));
  },
};
