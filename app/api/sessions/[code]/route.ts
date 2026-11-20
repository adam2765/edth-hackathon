import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/reports/store";
import { sessionCode, type SessionLogReply } from "@/lib/reports/types";

/**
 * A session's log for the receiver: `GET /api/sessions/<code>?after=<n>` returns the entries after
 * the first n and the total, so a receiver polling every second gets only what is new.
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
