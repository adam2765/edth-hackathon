import { NextResponse } from "next/server";
import { parsePlot } from "@/lib/reports/plot";
import { recordPlot } from "@/lib/reports/record";
import { COMMAND_POST, sessionCode, type PlotReply } from "@/lib/reports/types";

/**
 * The command post places a track by hand: `POST /api/sessions/<code>/tracks` with JSON
 * `{ affiliation, kind, count?, lat, lon, radius_m?, note? }`, or `place` (a gazetteer place id)
 * instead of `lat` and `lon`. The track gets the mission's next number. Returns 201 with the entry.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[code]/tracks">) {
  const session = sessionCode((await ctx.params).code);
  if (!session) return NextResponse.json({ error: "Session codes are letters, digits, - and _, up to 40." }, { status: 400 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  const parsed = parsePlot(body, "place", null);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const r = await recordPlot(session, parsed.input, COMMAND_POST);
    if (!r.ok) return NextResponse.json({ error: r.error, ended: r.ended }, { status: r.status });
    const reply: PlotReply = { entry: r.entry };
    return NextResponse.json(reply, { status: 201 });
  } catch (err) {
    console.error("placing a track failed", err);
    return NextResponse.json({ error: "Placing the track failed." }, { status: 500 });
  }
}
