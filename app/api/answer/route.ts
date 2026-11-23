import { NextResponse } from "next/server";
import { operatorDenied } from "@/lib/reports/auth";
import { recordAnswer } from "@/lib/reports/record";
import { COMMAND_POST, sessionCode } from "@/lib/reports/types";

/**
 * The answer to a question: POST JSON `{ session, report, choice }`, where `report` is the
 * `report_id` the coordinator returned and `choice` a candidate id, or null for "none of these".
 * From a phone, the phone has already moved its own marker; this tells the command post. The
 * command post sends `by: "CP"` when it chooses for a unit that cannot tap, as on a radio net.
 * The first answer stands, whoever gave it.
 */
export async function POST(req: Request) {
  let body: { session?: unknown; report?: unknown; choice?: unknown; by?: unknown };
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
  if (body.by != null && body.by !== COMMAND_POST) return NextResponse.json({ error: `\`by\` is "${COMMAND_POST}" or left out.` }, { status: 400 });
  // The phone answers for itself; only the command post's own answer is behind the PIN [266].
  if (body.by === COMMAND_POST) {
    const denied = operatorDenied(req);
    if (denied) return denied;
  }
  try {
    const r = await recordAnswer(session, report, choice, Date.now(), body.by === COMMAND_POST ? COMMAND_POST : null);
    if (!r.ok) return NextResponse.json({ error: r.error, ended: r.ended }, { status: r.status });
    // `by` says who answered first: "CP" when the command post did, so a late phone can tell.
    return NextResponse.json({ answer_id: r.entry.id, by: r.entry.by ?? null });
  } catch (err) {
    console.error("saving the answer failed", err);
    return NextResponse.json({ error: "Saving the answer failed." }, { status: 500 });
  }
}
