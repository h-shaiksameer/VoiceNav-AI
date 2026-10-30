import type { NextRequest } from "next/server";
import { placesRequestSchema } from "@/types/schemas";
import { api } from "@/services/server/http";
import { findPlaces } from "@/services/places/server";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  return api(request, placesRequestSchema, findPlaces);
}