import { NextResponse } from "next/server";
import { AREAS, isAreaId } from "@/lib/geo/areas";
import { loadGazetteer } from "@/lib/geo/gazetteer";
import { startPointFrom } from "@/lib/reports/mission";
import { createMission, listMissions } from "@/lib/reports/record";
import { ROSTER_MAX, rosterOf } from "@/lib/reports/types";

/** The missions on this coordinator: `GET /api/sessions`, open ones first. Phones pick one to join. */
export async function GET() {
  try {
    return NextResponse.json(await listMissions(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("listing missions failed", err);
    return NextResponse.json({ error: "Listing missions failed." }, { status: 500 });
  }
}

const PARIS_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Opens a mission: POST JSON `{ area, name?, start?, roster? }`, where `start` is a gazetteer place
 * id or null, and `roster` the call signs on the radio net, as a list or as text split by commas or
 * lines [201]. Returns 201 with the mission and its new code.
 */
export async function POST(req: Request) {
  let body: { area?: unknown; name?: unknown; start?: unknown; roster?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  if (!isAreaId(body.area)) return NextResponse.json({ error: `\`area\` is one of: ${Object.keys(AREAS).join(", ")}.` }, { status: 400 });
  const area = body.area;
  const now = Date.now();
  const typed = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  const name = typed || `${AREAS[area].label}, ${PARIS_TIME.format(now)}`;
  let start = null;
  if (body.start != null) {
    // The start point is a place from the gazetteer, picked by id: no coordinates come in.
    const f = typeof body.start === "string" ? loadGazetteer(area).find((x) => x.id === body.start) : undefined;
    if (!f) return NextResponse.json({ error: "No place with that id in this area." }, { status: 400 });
    start = startPointFrom(f);
  }
  if (body.roster != null && typeof body.roster !== "string" && !Array.isArray(body.roster)) {
    return NextResponse.json({ error: "`roster` is a list of call signs, or text with one per line or comma." }, { status: 400 });
  }
  const roster = rosterOf(body.roster);
  if (roster.length > ROSTER_MAX) return NextResponse.json({ error: `At most ${ROSTER_MAX} call signs.` }, { status: 400 });
  try {
    const r = await createMission({ area, name, start, roster }, now);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ mission: r.mission }, { status: 201 });
  } catch (err) {
    console.error("opening a mission failed", err);
    return NextResponse.json({ error: "Opening the mission failed." }, { status: 500 });
  }
}
