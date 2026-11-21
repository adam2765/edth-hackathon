import { NextResponse } from "next/server";
import { hostIdentity } from "@/lib/runtime/hosts";
import { isReady } from "@/lib/providers/readiness";

export const dynamic = "force-dynamic";
export function GET() {
  const ready = isReady();
  return NextResponse.json({ app: "voice-to-map", ...hostIdentity(), ready }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
