import { NextResponse, type NextRequest } from "next/server";
import { AREAS, isAreaId } from "@/lib/geo/areas";
import { loadGazetteer, searchByName } from "@/lib/geo/gazetteer";
import { startPointFrom } from "@/lib/reports/mission";
import { inArea, pointLabel } from "@/lib/reports/plot";
import type { PlacesReply } from "@/lib/reports/types";

/**
 * Places in an area's gazetteer by name, for picking a mission's start point or where a track
 * goes: `GET /api/places?area=vincennes&q=chateau`. Up to 8, best match first, each with the
 * circle a start point there would get.
 *
 * With `lat` and `lon` instead of `q`, the name the command post would give a track placed at
 * that point: `{ places: [], label: "120 m north-east of Château de Vincennes" }`.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const area = sp.get("area");
  if (!isAreaId(area)) return NextResponse.json({ error: `\`area\` is one of: ${Object.keys(AREAS).join(", ")}.` }, { status: 400 });
  if (sp.has("lat") || sp.has("lon")) {
    const p = { lat: Number(sp.get("lat")), lon: Number(sp.get("lon")) };
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return NextResponse.json({ error: "`lat` and `lon` are numbers." }, { status: 400 });
    if (!inArea(p, area)) return NextResponse.json({ error: `That point is outside ${AREAS[area].label}.` }, { status: 400 });
    const reply: PlacesReply = { places: [], label: pointLabel(p, loadGazetteer(area)) };
    return NextResponse.json(reply);
  }
  const q = (sp.get("q") ?? "").trim().slice(0, 80);
  const reply: PlacesReply = { places: q ? searchByName(q, loadGazetteer(area)).slice(0, 8).map((m) => startPointFrom(m.feature)) : [] };
  return NextResponse.json(reply);
}
