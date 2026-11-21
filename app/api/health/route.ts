import { NextResponse } from "next/server";
import { hostIdentity } from "@/lib/runtime/hosts";
import { providerMode, whisperUrl } from "@/lib/providers/mode";
import { isReady } from "@/lib/providers/readiness";

export const dynamic = "force-dynamic";
export async function GET() {
  const speechReady = providerMode() !== "local" || await fetch(whisperUrl() + "/health", { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
  const ready = isReady() && speechReady;
  return NextResponse.json({ app: "voice-to-map", ...hostIdentity(), ready }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
