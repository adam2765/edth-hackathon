import { NextResponse } from "next/server";
import { parseFix } from "@/lib/reports/plot";
import { recordFix } from "@/lib/reports/record";
import { COMMAND_POST, sessionCode, type FixReply } from "@/lib/reports/types";

/**
 * A person at the command post puts a unit somewhere by hand [243]:
 * `POST /api/sessions/<code>/units/position` with JSON `{ callsign, lat, lon }` or
 * `{ callsign, place }` (a gazetteer place id), and `radius_m?` and `note?`, as for a track moved by
 * hand. For a unit the app did not place, or placed wrongly. Only a unit on the roster; a point
 * outside the mission's area is refused. The position comes from the person, never from a model.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[code]/units/position">) {
  const session = sessionCode((await ctx.params).code);
  if (!session) return NextResponse.json({ error: "Session codes are letters, digits, - and _, up to 40." }, { status: 400 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  const parsed = parseFix(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const r = await recordFix(session, parsed.input, COMMAND_POST);
    if (!r.ok) return NextResponse.json({ error: r.error, ended: r.ended }, { status: r.status });
    const reply: FixReply = { entry: r.entry };
    return NextResponse.json(reply, { status: 201 });
  } catch (err) {
    console.error("placing a unit by hand failed", err);
    return NextResponse.json({ error: "Saving that failed." }, { status: 500 });
  }
}
