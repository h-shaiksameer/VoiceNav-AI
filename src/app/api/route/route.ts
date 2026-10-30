import type { NextRequest } from "next/server";
import { z } from "zod";
import { coordinatesSchema } from "@/types/schemas";
import { api } from "@/services/server/http";
import { calculateRoute, calculateRoutes } from "@/services/routing/server";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const schema = z.object({ waypoints: z.array(coordinatesSchema).min(2).max(3), alternatives: z.boolean().optional() })
    .refine((value) => !value.alternatives || value.waypoints.length === 2, "Alternative routes require exactly two locations.");
  return api(request, schema, async ({ waypoints, alternatives }, identity) => alternatives ? calculateRoutes(waypoints, identity, true) : calculateRoute(waypoints, identity));
}