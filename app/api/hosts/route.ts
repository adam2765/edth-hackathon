import { NextResponse } from "next/server";
import { listHosts } from "@/lib/runtime/hosts";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return NextResponse.json({ hosts: listHosts(new URL(request.url).origin) }, { headers: { "Cache-Control": "no-store" } });
}
