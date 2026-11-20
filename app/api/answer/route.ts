import { NextResponse } from "next/server";
import { recordAnswer } from "@/lib/reports/record";
import { sessionCode } from "@/lib/reports/types";

/**
 * The speaker's answer to a question: POST JSON `{ session, report, choice }`, where `report` is
 * the `report_id` the coordinator returned and `choice` a candidate id, or null for "none of these".
 * The phone has already moved its own marker; this tells the receiver.
 */
export async function POST(req: Request) {
  let body: { session?: unknown; report?: unknown; choice?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  const session = sessionCode(body.session);
  const report = typeof body.report === "string" && body.report.length <= 64 ? body.report : null;
  const choice = body.choice === null ? null : typeof body.choice === "string" && body.choice.length <= 200 ? body.choice : undefined;
  if (!session || !report || choice === undefined) {
    return NextResponse.json({ error: "Send `session`, `report` and `choice` (a candidate id, or null)." }, { status: 400 });
  }
  try {
    const r = await recordAnswer(session, report, choice);
    if (!r.ok) return NextResponse.json({ error: r.error, ended: r.ended }, { status: r.status });
    return NextResponse.json({ answer_id: r.entry.id });
  } catch (err) {
    console.error("saving the answer failed", err);
    return NextResponse.json({ error: "Saving the answer failed." }, { status: 500 });
  }
}
