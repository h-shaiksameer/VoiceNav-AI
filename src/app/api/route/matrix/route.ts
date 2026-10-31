import { z } from "zod";
import { api } from "@/services/server/http";
import { calculateTravelMatrix } from "@/services/routing/server";
import { coordinatesSchema } from "@/types/schemas";

export const runtime = "nodejs";

const schema = z.object({ waypoints: z.array(coordinatesSchema).min(2).max(12) });

export async function POST(request: Request) {
  return api(request as never, schema, ({ waypoints }, identity) => calculateTravelMatrix(waypoints, identity));
}
