import { NextResponse } from "next/server";
import { getMmsEnvironment } from "@/services/voice/mmsConfig";

export const runtime = "nodejs";

export function GET() {
  const { enabled } = getMmsEnvironment();
  return NextResponse.json({ mmsEnabled: enabled }, { headers: { "Cache-Control": "no-store" } });
}
