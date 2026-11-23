import { NextResponse } from "next/server";
import { operatorDenied } from "@/lib/reports/auth";
import { endMission } from "@/lib/reports/record";
import { sessionCode } from "@/lib/reports/types";

/** Ends a mission: `POST /api/sessions/<code>/end`. Reports and joins are refused after it; the log stays for replay. */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[code]/end">) {
  const denied = operatorDenied(req);
  if (denied) return denied;
  const session = sessionCode((await ctx.params).code);
  if (!session) return NextResponse.json({ error: "Session codes are letters, digits, - and _, up to 40." }, { status: 400 });
  try {
    const r = await endMission(session);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ mission: r.mission });
  } catch (err) {
    console.error("ending a mission failed", err);
    return NextResponse.json({ error: "Ending the mission failed." }, { status: 500 });
  }
}
