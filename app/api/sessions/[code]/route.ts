import { NextResponse, type NextRequest } from "next/server";
import { deleteMission } from "@/lib/reports/record";
import { getStore } from "@/lib/reports/store";
import { sessionCode, type SessionLogReply } from "@/lib/reports/types";

/**
 * A session's log for the command post: `GET /api/sessions/<code>?after=<n>` returns the entries after
 * the first n and the total, so a command post polling every second gets only what is new.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/sessions/[code]">) {
  const { code } = await ctx.params;
  const session = sessionCode(code);
  if (!session) return NextResponse.json({ error: "Session codes are letters, digits, - and _, up to 40." }, { status: 400 });
  const afterIn = Number(req.nextUrl.searchParams.get("after"));
  const after = Number.isInteger(afterIn) && afterIn > 0 ? afterIn : 0;
  const store = getStore();
  try {
    const { total, entries } = await store.list(session, after);
    const reply: SessionLogReply = { session, stored: store.kind !== "none", total, entries };
    return NextResponse.json(reply, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("reading the session log failed", err);
    return NextResponse.json({ error: "Reading the log failed." }, { status: 500 });
  }
}

/** Deletes an ended mission: `DELETE /api/sessions/<code>`. The file moves to `deleted/`; an open mission gets 409. */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/sessions/[code]">) {
  const session = sessionCode((await ctx.params).code);
  if (!session) return NextResponse.json({ error: "Session codes are letters, digits, - and _, up to 40." }, { status: 400 });
  try {
    const r = await deleteMission(session);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ deleted: session });
  } catch (err) {
    console.error("deleting a mission failed", err);
    return NextResponse.json({ error: "Deleting the mission failed." }, { status: 500 });
  }
}
