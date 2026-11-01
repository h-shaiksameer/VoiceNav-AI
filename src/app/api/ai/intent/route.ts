import type { NextRequest } from "next/server";
import { api } from "@/services/server/http";
import { basetenIntentRequestSchema, inferConfiguredIntent } from "@/services/ai/baseten";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  const response = await api(request, basetenIntentRequestSchema, inferConfiguredIntent);
  let provider = "unknown";
  try { provider = ((await response.clone().json()) as { provider?: string }).provider ?? provider; } catch {}
  console.info(`[VoiceNav AI] POST ${request.nextUrl.pathname} ${response.status} ${Math.round(performance.now() - startedAt)}ms provider=${provider}`);
  return response;
}