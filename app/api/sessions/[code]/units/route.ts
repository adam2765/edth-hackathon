import { NextResponse } from "next/server";
import { operatorDenied } from "@/lib/reports/auth";
import { recordUnit } from "@/lib/reports/record";
import { parseUnit } from "@/lib/reports/tasks";
import { COMMAND_POST, sessionCode, type UnitReply } from "@/lib/reports/types";

/**
 * What a unit is [235]: `POST /api/sessions/<code>/units` with JSON `{ callsign, kind }`, where
 * `kind` is one of the track kinds ("drone_team", "people", …) or null to clear it. A person at the
 * command post says it; nothing reads it from the call sign or the words. A unit whose kind is drone
 * or drone team can then be sent to look at a track. A unit looking at a track stays a drone or drone
 * team until a person ends that. The same kind again writes nothing and returns `entry: null`.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[code]/units">) {
  const denied = operatorDenied(req);
  if (denied) return denied;
  const session = sessionCode((await ctx.params).code);
  if (!session) return NextResponse.json({ error: "Session codes are letters, digits, - and _, up to 40." }, { status: 400 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  const parsed = parseUnit(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const r = await recordUnit(session, parsed.input, COMMAND_POST);
    if (!r.ok) return NextResponse.json({ error: r.error, ended: r.ended }, { status: r.status });
    const reply: UnitReply = { entry: r.entry };
    return NextResponse.json(reply, { status: r.entry ? 201 : 200 });
  } catch (err) {
    console.error("recording a unit's kind failed", err);
    return NextResponse.json({ error: "Saving that failed." }, { status: 500 });
  }
}
