import type { NextRequest } from "next/server";
import { z } from "zod";
import { api } from "@/services/server/http";
import { geocode } from "@/services/geocoding/server";
import { coordinatesSchema, countryCodeSchema } from "@/types/schemas";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  return api(request, z.object({ query: z.string().trim().min(3).max(300), reference: coordinatesSchema.optional(), countryCode: countryCodeSchema.optional() }), ({ query, reference, countryCode }, identity) => geocode(query, identity, reference, countryCode));
}