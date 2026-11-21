import { NextResponse } from "next/server";
import { recordTask } from "@/lib/reports/record";
import { parseTask } from "@/lib/reports/tasks";
import { COMMAND_POST, sessionCode, type TaskReply } from "@/lib/reports/types";

/**
 * Recon at the command post [234]: `POST /api/sessions/<code>/tasks` with JSON
 *   - `{ action: "send", asset, n, request? }`: sends the friendly drone or drone team `asset` (a
 *     track number) to look at Track `n`, answering `request` if given. A drone already looking at
 *     another track moves to this one.
 *   - `{ action: "done", asset }`: its recon is over.
 *   - `{ action: "decline", request }`: turns a unit's request down. Nothing is sent.
 * A person chooses every time; the app picks nothing. The first decision on a request stands: one
 * settled already returns `already: true` and changes nothing.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[code]/tasks">) {
  const session = sessionCode((await ctx.params).code);
  if (!session) return NextResponse.json({ error: "Session codes are letters, digits, - and _, up to 40." }, { status: 400 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  const parsed = parseTask(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const r = await recordTask(session, parsed.input, COMMAND_POST);
    if (!r.ok) return NextResponse.json({ error: r.error, ended: r.ended }, { status: r.status });
    const reply: TaskReply = { entry: r.entry, already: r.already };
    return NextResponse.json(reply, { status: r.entry ? 201 : 200 });
  } catch (err) {
    console.error("recording a task failed", err);
    return NextResponse.json({ error: "Saving that failed." }, { status: 500 });
  }
}
