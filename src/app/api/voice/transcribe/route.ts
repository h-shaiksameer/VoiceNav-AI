import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMmsEnvironment } from "@/services/voice/mmsConfig";

export const runtime = "nodejs";

const transcriptionSchema = z.object({
  success: z.literal(true),
  text: z.string().trim().min(1).max(10_000),
  provider: z.literal("meta-mms"),
  model: z.string().min(1),
  language: z.string().min(1),
  inferenceTimeMs: z.number().nonnegative(),
}).strict();

function originAllowed(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  const config = getMmsEnvironment();
  if (!config.enabled) return NextResponse.json({ error: "Meta MMS is disabled." }, { status: 503 });
  if (!originAllowed(request)) return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) return NextResponse.json({ error: "Expected a multipart audio request." }, { status: 415 });

  try {
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File)) return NextResponse.json({ error: "An audio file is required." }, { status: 400 });
    const body = new FormData();
    body.append("audio", new Blob([await audio.arrayBuffer()], { type: audio.type || "application/octet-stream" }), audio.name || "voice-audio");
    const response = await fetch(`${config.serviceUrl.replace(/\/$/u, "")}/transcribe`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const detail = z.object({ detail: z.string() }).safeParse(payload);
      return NextResponse.json({ error: detail.success ? detail.data.detail : "Meta MMS transcription failed." }, { status: response.status >= 500 ? 502 : response.status });
    }
    const parsed = transcriptionSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ error: "Meta MMS returned an invalid transcription." }, { status: 502 });
    return NextResponse.json(parsed.data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
      ? "Meta MMS transcription timed out."
      : "Meta MMS service is unavailable. Start the local Python service and retry.";
    console.error("[VoiceNav MMS] transcription request failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
