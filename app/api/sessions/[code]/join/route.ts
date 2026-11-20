import { NextResponse } from "next/server";
import { joinMission } from "@/lib/reports/record";
import { callsignOf, sessionCode } from "@/lib/reports/types";

const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * A phone joins a mission: POST JSON `{ callsign, device }`, where `device` is an id the phone
 * made up and keeps. Returns where the coordinator has the unit (the start point on a first join).
 * 404 for an unknown mission; 409 with `ended` or `taken` when it has ended or the call sign is in
 * use on another phone.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[code]/join">) {
  const session = sessionCode((await ctx.params).code);
  let body: { callsign?: unknown; device?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  const callsign = callsignOf(body.callsign);
  const device = typeof body.device === "string" && DEVICE_RE.test(body.device) ? body.device : null;
  if (!session || !device || callsign === "UNKNOWN") {
    return NextResponse.json({ error: "Send `callsign` and `device` (8 to 64 letters, digits, - or _)." }, { status: 400 });
  }
  try {
    const r = await joinMission(session, callsign, device);
    if (!r.ok) return NextResponse.json({ error: r.error, ended: r.ended, taken: r.taken }, { status: r.status });
    return NextResponse.json(r.reply);
  } catch (err) {
    console.error("joining a mission failed", err);
    return NextResponse.json({ error: "Joining failed." }, { status: 500 });
  }
}
