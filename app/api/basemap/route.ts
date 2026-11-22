import { NextResponse } from "next/server";
import { baseMapPreference } from "@/lib/map/prefer";

// Which base map the map pages should start with: the one saved on this computer, or OpenFreeMap's.
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({ prefer: baseMapPreference() }, { headers: { "Cache-Control": "no-store" } });
}
