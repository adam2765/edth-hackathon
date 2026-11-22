import { NextResponse } from "next/server";
import { AREAS } from "@/lib/geo/areas";
import type { Resolution } from "@/lib/geo/types";
import { missionRoster } from "@/lib/reports/mission";
import { forgetHeldReadings, heldHints, heldReadings, heldWords, readTranscript, REQUEST_ONLY } from "@/lib/reports/pipeline";
import { addToRoster, dismissHeld, heldReport, openMissionLog, reportContext, saveReport } from "@/lib/reports/record";
import { COMMAND_POST, callsignGiven, callsignOf, sessionCode, type HeldReply } from "@/lib/reports/types";

const ACTIONS = ["assign", "add", "dismiss"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * The operator settles a radio report held in the Unassigned tray [203]:
 * `POST /api/sessions/<code>/held/<id>` with JSON `{ action, callsign? }`.
 *   - `assign`: gives it to `callsign`, a unit on the roster. The words are placed again from where
 *     that unit was when the report came in, since "200 metres north of me" depends on who said it.
 *     The model read them while the report waited [256]; it reads them now only if that failed.
 *   - `add`: puts `callsign` on the roster first, then gives it the report. Only this adds a unit.
 *   - `dismiss`: drops it. Nothing moves.
 * The first decision stands: a report settled already returns `already: true` and changes nothing.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[code]/held/[id]">) {
  const { code, id } = await ctx.params;
  const session = sessionCode(code);
  if (!session) return NextResponse.json({ error: "Session codes are letters, digits, - and _, up to 40." }, { status: 400 });
  if (!/^[a-z0-9]+-[a-z0-9]+$/.test(id)) return NextResponse.json({ error: "No such held report." }, { status: 404 });
  let body: { action?: unknown; callsign?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  const action = ACTIONS.find((a) => a === body.action) as Action | undefined;
  if (!action) return NextResponse.json({ error: `\`action\` is one of: ${ACTIONS.join(", ")}.` }, { status: 400 });
  if (action !== "dismiss" && !callsignGiven(body.callsign)) return NextResponse.json({ error: "Send the `callsign` to give it to." }, { status: 400 });
  const callsign = callsignOf(body.callsign);
  const now = Date.now();

  try {
    const h = await heldReport(session, id);
    if (!h.ok) return NextResponse.json({ error: h.error, ended: h.ended }, { status: h.status });
    if (h.settled) {
      forgetHeldReadings(session, id);
      return NextResponse.json(settledReply(h.settled));
    }

    if (action === "dismiss") {
      const r = await dismissHeld(session, id, COMMAND_POST, now);
      if (!r.ok) return NextResponse.json({ error: r.error, ended: r.ended }, { status: r.status });
      forgetHeldReadings(session, id);
      const reply: HeldReply = { report_id: null, callsign: null, already: r.already };
      return NextResponse.json(reply);
    }

    if (action === "add") {
      const r = await addToRoster(session, callsign, COMMAND_POST, id, now);
      if (!r.ok) return NextResponse.json({ error: r.error, ended: r.ended }, { status: r.status });
    } else {
      const m = await openMissionLog(session);
      if (!m.ok) return NextResponse.json({ error: m.error, ended: m.ended }, { status: m.status });
      if (!missionRoster(m.entries).includes(callsign)) return NextResponse.json({ error: `${callsign} is not on the roster. Add it first.` }, { status: 400 });
    }

    // The unit as it was when the report came in, not as it is now.
    const held = h.entry;
    const c = await reportContext(session, callsign, { area: held.area, lastPosition: null }, held.ts, held.ts);
    if (!c.ok) return NextResponse.json({ error: c.error, ended: c.ended }, { status: c.status });
    const t0 = performance.now();
    const area = AREAS[c.area];
    let read: Awaited<ReturnType<typeof readTranscript>> | null = null;
    // A request for recon is cut out before the model reads the words, as for any report [234].
    const { split: heard, text } = heldWords(held);
    if (text) {
      // The model's reading from while the report waited, or still being read [256]; only the place is worked out here.
      read = await readTranscript(text, { area, ...heldHints(held), lastPosition: c.lastPosition, now: held.ts, tracks: c.tracks, callsign }, heldReadings(session, id));
    }
    // A call that was only a request is kept as a report with nothing to place, so the held one is settled.
    const resolution: Resolution =
      read?.resolution ??
      (heard.only && heard.request
        ? REQUEST_ONLY
        : { status: "unresolved", candidates: [], evidence: { rule: "empty_transcript", detail: "speech-to-text returned no words; given to a unit by the operator" } });
    const saved = await saveReport(
      {
        session,
        callsign,
        seq: null,
        clientTs: held.clientTs,
        area: c.area,
        transcript: held.transcript,
        language: held.language,
        intent: read?.intent ?? null,
        resolution,
        lastPosition: c.lastPosition,
        timings_ms: { stt: 0, extract: read?.extract_ms ?? 0, resolve: read?.resolve_ms ?? 0, total: Math.round(performance.now() - t0) },
        sender: { heard: held.heard, how: "operator", held: id },
        ...(heard.request ? { request: heard.request, read: heard.text } : {}),
      },
      now,
    );
    if (!saved) return NextResponse.json({ error: "This mission has ended.", ended: true }, { status: 409 });
    forgetHeldReadings(session, id);
    const reply: HeldReply = { report_id: saved.id, callsign, already: saved.already === true };
    return NextResponse.json(reply);
  } catch (err) {
    console.error("settling the held report failed", err);
    return NextResponse.json({ error: "Settling the held report failed." }, { status: 500 });
  }
}

function settledReply(s: { kind: "report"; id: string; callsign: string } | { kind: "dismiss" }): HeldReply {
  return s.kind === "report" ? { report_id: s.id, callsign: s.callsign, already: true } : { report_id: null, callsign: null, already: true };
}
