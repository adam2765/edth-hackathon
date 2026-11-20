import { NextResponse } from "next/server";
import { NoLocalTranscriberError, getTranscriber } from "@/lib/providers/transcriber";
import { getExtractor, pinnedLanguage } from "@/lib/providers/extractor";
import { biasTerms, loadGazetteer } from "@/lib/geo/gazetteer";
import { resolve } from "@/lib/geo/resolver";
import { AREAS, DEFAULT_AREA, isAreaId, type AreaId } from "@/lib/geo/areas";
import type { GazetteerFeature, LastPosition, Resolution } from "@/lib/geo/types";
import { recordReport, reportContext, type ReportInput } from "@/lib/reports/record";
import { callsignOf, sessionCode } from "@/lib/reports/types";

export const maxDuration = 30;

const MAX_AUDIO_BYTES = 1_000_000;
const MAX_TEXT_CHARS = 500;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;

const AREA_DATA = Object.fromEntries(
  (Object.keys(AREAS) as AreaId[]).map((id) => {
    const gazetteer = loadGazetteer(id);
    return [id, { gazetteer, bias: biasTerms(gazetteer, 100) }];
  }),
) as Record<AreaId, { gazetteer: GazetteerFeature[]; bias: string[] }>;

const NO_WORDS: Record<string, string> = {
  uk: "Не розчув. Повторіть, будь ласка.",
  fr: "Je n'ai pas compris. Répétez, s'il vous plaît.",
  en: "I didn't catch that. Try again.",
};

// Per-instance, best effort. Enough to stop a runaway loop in stage 1.
const hits = new Map<string, number[]>();
function rateLimited(ip: string, now: number): boolean {
  const list = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > RATE_MAX;
}

function parseLastPosition(v: FormDataEntryValue | null): LastPosition | null {
  if (typeof v !== "string" || !v) return null;
  try {
    const o = JSON.parse(v);
    if ([o.lat, o.lon, o.ts].every((x) => typeof x === "number" && Number.isFinite(x))) {
      const metres = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : undefined);
      return { lat: o.lat, lon: o.lon, ts: o.ts, uncertainty_m: metres(o.uncertainty_m), radius_m: metres(o.radius_m) };
    }
  } catch {}
  return null;
}

/**
 * Saves the report when the transmitter named a session, and returns its id for the reply. A
 * failure to save is logged and does not cost the speaker their answer.
 */
async function save(session: string | null, input: Omit<ReportInput, "session">): Promise<{ report_id?: string }> {
  if (!session) return {};
  try {
    const id = await recordReport({ session, ...input });
    return id ? { report_id: id } : {};
  } catch (err) {
    console.error("saving the report failed", err);
    return {};
  }
}

export async function POST(req: Request) {
  const t0 = performance.now();
  const now = Date.now();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip, now)) return NextResponse.json({ error: "Too many reports, slow down." }, { status: 429 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const audio = form.get("audio");
  const textIn = form.get("text");
  let lastPosition = parseLastPosition(form.get("lastPosition"));
  const clientTs = Number(form.get("clientTs")) || null;
  const areaIn = form.get("area");
  let areaId: AreaId = isAreaId(areaIn) ? areaIn : DEFAULT_AREA;
  // Who sent it and where it belongs; reports without a session (the web page) are not saved.
  const session = sessionCode(form.get("session"));
  const callsign = callsignOf(form.get("callsign"));
  const seqIn = Number(form.get("seq"));
  const seq = Number.isInteger(seqIn) && seqIn > 0 ? seqIn : null;
  // The language the device is set to. It decides the question's language; without it, it is guessed.
  const pinned = pinnedLanguage(form.get("language"));
  if (session) {
    // In a mission, the mission sets the area and the log gives the last position, not the phone.
    try {
      const c = await reportContext(session, callsign, { area: areaId, lastPosition }, now);
      if (!c.ok) return NextResponse.json({ error: c.error, ended: c.ended }, { status: c.status });
      areaId = c.area;
      lastPosition = c.lastPosition;
    } catch (err) {
      console.error("reading the mission failed", err);
      return NextResponse.json({ error: "Reading the mission failed." }, { status: 500 });
    }
  }
  const area = AREAS[areaId];
  const { gazetteer, bias } = AREA_DATA[area.id];
  const meta = { callsign, seq, clientTs, area: area.id, lastPosition };

  const timings = { stt: 0, extract: 0, resolve: 0, total: 0 };
  let transcript = "";
  let sttLanguage: string | null = null;

  try {
    if (audio instanceof Blob && audio.size > 0) {
      if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: "Clip too large (1 MB max, about 15 s)." }, { status: 413 });
      const s = performance.now();
      const r = await getTranscriber().transcribe(audio, audio.type || "audio/webm", bias);
      timings.stt = Math.round(performance.now() - s);
      transcript = r.text;
      sttLanguage = r.language;
    } else if (typeof textIn === "string" && textIn.trim()) {
      transcript = textIn.trim().slice(0, MAX_TEXT_CHARS);
    } else {
      return NextResponse.json({ error: "Send `audio` or `text`." }, { status: 400 });
    }

    if (!transcript) {
      timings.total = Math.round(performance.now() - t0);
      const heard = pinned ?? sttLanguage;
      const resolution: Resolution = {
        status: "unresolved",
        candidates: [],
        question: NO_WORDS[heard === "ru" ? "uk" : (heard ?? "")] ?? NO_WORDS[area.id === "kyiv" ? "uk" : "en"],
        evidence: { rule: "empty_transcript", detail: "speech-to-text returned no words" },
      };
      const saved = await save(session, { ...meta, transcript: "", language: heard, intent: null, resolution, timings_ms: timings });
      return NextResponse.json({ transcript: "", language: heard, intent: null, resolution, timings_ms: timings, clientTs, area: area.id, ...saved });
    }

    const e = performance.now();
    const intent = await getExtractor().extract(transcript, { languageHint: sttLanguage, place: area.place, language: pinned });
    timings.extract = Math.round(performance.now() - e);

    const r0 = performance.now();
    const resolution = resolve({ intent, transcript, lastPosition, now, gazetteer, areaCentre: area.centre });
    timings.resolve = Math.round(performance.now() - r0);
    timings.total = Math.round(performance.now() - t0);

    const language = pinned ?? sttLanguage ?? intent.language;
    const saved = await save(session, { ...meta, transcript, language, intent, resolution, timings_ms: timings });
    return NextResponse.json({ transcript, language, intent, resolution, timings_ms: timings, clientTs, area: area.id, ...saved });
  } catch (err) {
    timings.total = Math.round(performance.now() - t0);
    if (err instanceof NoLocalTranscriberError) {
      const error = "This coordinator runs offline and cannot turn speech into text yet. Use speech-to-text on the phone, or type the report.";
      return NextResponse.json({ error, transcript, timings_ms: timings }, { status: 501 });
    }
    console.error("report failed", err);
    return NextResponse.json({ error: "Processing failed. Try again or type the report.", transcript, timings_ms: timings }, { status: 502 });
  }
}
