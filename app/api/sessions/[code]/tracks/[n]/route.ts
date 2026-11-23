import { NextResponse } from "next/server";
import { operatorDenied } from "@/lib/reports/auth";
import { parsePlot } from "@/lib/reports/plot";
import { recordPlot } from "@/lib/reports/record";
import { COMMAND_POST, sessionCode, type PlotAction, type PlotReply } from "@/lib/reports/types";

const ACTIONS: PlotAction[] = ["edit", "move", "gone", "restore"];

/**
 * The command post changes a track by hand: `PATCH /api/sessions/<code>/tracks/<n>` with JSON
 * `{ action, … }`. `edit` takes `affiliation`, `kind`, `count?` and `note?`; `move` takes `lat` and
 * `lon` (or `place`), `radius_m?` and `note?`; `gone` and `restore` take nothing else.
 */
export async function PATCH(req: Request, ctx: RouteContext<"/api/sessions/[code]/tracks/[n]">) {
  const denied = operatorDenied(req);
  if (denied) return denied;
  const params = await ctx.params;
  const session = sessionCode(params.code);
  if (!session) return NextResponse.json({ error: "Session codes are letters, digits, - and _, up to 40." }, { status: 400 });
  const n = /^\d{1,4}$/.test(params.n) ? Number(params.n) : null;
  let body: { action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  const action = ACTIONS.find((a) => a === body?.action);
  if (!action) return NextResponse.json({ error: `\`action\` is one of: ${ACTIONS.join(", ")}.` }, { status: 400 });
  const parsed = parsePlot(body, action, n);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const r = await recordPlot(session, parsed.input, COMMAND_POST);
    if (!r.ok) return NextResponse.json({ error: r.error, ended: r.ended }, { status: r.status });
    const reply: PlotReply = { entry: r.entry };
    return NextResponse.json(reply);
  } catch (err) {
    console.error("changing a track failed", err);
    return NextResponse.json({ error: "Changing the track failed." }, { status: 500 });
  }
}
