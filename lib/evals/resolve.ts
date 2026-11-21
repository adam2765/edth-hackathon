/**
 * The resolver step of the extraction eval: an intent and a case's start, placed as the
 * coordinator would place them. Separate from extraction.ts because it loads the gazetteers.
 */
import { AREAS } from "../geo/areas";
import { loadGazetteer } from "../geo/gazetteer";
import { resolveReport } from "../geo/tracks";
import type { Intent, LastPosition, Resolution } from "../geo/types";
import { sanitizeIntent } from "../providers/extractor";
import type { EvalCase, ExpectedOutcome } from "./extraction";

/** The case's start as a last position: a gazetteer place, or a crossing's own point. */
export function lastPositionFor(c: EvalCase, now: number): LastPosition | null {
  if (!c.from) return null;
  // A crossing has no gazetteer entry; its id carries its point ("crossing/49.19046,37.27422").
  const m = /^crossing\/(-?[\d.]+),(-?[\d.]+)$/.exec(c.from.feature);
  const f = m ? { lat: Number(m[1]), lon: Number(m[2]) } : loadGazetteer(c.area).find((g) => g.id === c.from!.feature);
  if (!f) throw new Error(`${c.id}: from.feature ${c.from.feature} is not in the ${c.area} gazetteer`);
  return {
    lat: f.lat,
    lon: f.lon,
    ts: now - 60_000,
    radius_m: 40,
    ...(c.from.street ? { street: c.from.street } : {}),
    ...(c.from.heading_deg != null ? { heading_deg: c.from.heading_deg } : {}),
  };
}

export function resolveCase(c: EvalCase, intent: Intent, now: number): Resolution {
  return resolveReport({
    intent,
    transcript: c.text,
    lastPosition: lastPositionFor(c, now),
    now,
    gazetteer: loadGazetteer(c.area),
    areaCentre: AREAS[c.area].centre,
    tracks: [],
    observer: "EVAL",
  });
}

/**
 * The intent a right reading gives: the case's expected fields (the first value of a list), as
 * the model would write them. Fields the case does not score are left out, so they read as null.
 */
export function expectedIntent(c: EvalCase): Intent {
  const f = Object.fromEntries(Object.entries(c.expect).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, unknown>;
  const track = f.subject === "track" ? { ref: f.track_ref ?? null, kind: f.track_kind ?? "other", count: f.track_count ?? null, text: null, heading: f.track_heading ?? null } : null;
  return sanitizeIntent({ ...f, kind: f.kind ?? "position", track }, null, c.text);
}

/**
 * The outcome a right reading gets from the resolver as it is now. A question of either kind is
 * one outcome, "asks back": what matters is that nothing is pinned.
 */
export function outcomeOf(r: Resolution): ExpectedOutcome {
  if (r.status !== "resolved") return { status: ["ambiguous", "unresolved"] };
  return {
    status: "resolved",
    ...(r.evidence.feature_id ? { feature_id: r.evidence.feature_id } : {}),
    ...(r.heading_to ? { heading_to: r.heading_to.id } : {}),
  };
}
