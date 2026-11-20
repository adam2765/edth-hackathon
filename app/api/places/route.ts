import { NextResponse, type NextRequest } from "next/server";
import { AREAS, isAreaId } from "@/lib/geo/areas";
import { loadGazetteer, searchByName } from "@/lib/geo/gazetteer";
import { startPointFrom } from "@/lib/reports/mission";
import type { PlacesReply } from "@/lib/reports/types";

/**
 * Places in an area's gazetteer by name, for picking a mission's start point:
 * `GET /api/places?area=vincennes&q=chateau`. Up to 8, best match first, each with the circle a
 * start point there would get.
 */
export async function GET(req: NextRequest) {
  const area = req.nextUrl.searchParams.get("area");
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (!isAreaId(area)) return NextResponse.json({ error: `\`area\` is one of: ${Object.keys(AREAS).join(", ")}.` }, { status: 400 });
  const reply: PlacesReply = { places: q ? searchByName(q, loadGazetteer(area)).slice(0, 8).map((m) => startPointFrom(m.feature)) : [] };
  return NextResponse.json(reply);
}
