import { NextResponse } from "next/server";
import { NoLocalTranscriberError, getTranscriber } from "@/lib/providers/transcriber";
import { getExtractor } from "@/lib/providers/extractor";
import { biasTerms, loadGazetteer } from "@/lib/geo/gazetteer";
import { resolve } from "@/lib/geo/resolver";
import { AREAS, DEFAULT_AREA, isAreaId, type AreaId } from "@/lib/geo/areas";
import type { GazetteerFeature, LastPosition } from "@/lib/geo/types";

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
  const lastPosition = parseLastPosition(form.get("lastPosition"));
  const clientTs = Number(form.get("clientTs")) || null;
  const areaIn = form.get("area");
  const area = AREAS[isAreaId(areaIn) ? areaIn : DEFAULT_AREA];
  const { gazetteer, bias } = AREA_DATA[area.id];

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
      return NextResponse.json({
        transcript: "",
        language: sttLanguage,
        intent: null,
        resolution: {
          status: "unresolved",
          candidates: [],
          question: NO_WORDS[sttLanguage === "ru" ? "uk" : (sttLanguage ?? "")] ?? NO_WORDS[area.id === "kyiv" ? "uk" : "en"],
          evidence: { rule: "empty_transcript", detail: "speech-to-text returned no words" },
        },
        timings_ms: timings,
        clientTs,
      });
    }

    const e = performance.now();
    const intent = await getExtractor().extract(transcript, { languageHint: sttLanguage, place: area.place });
    timings.extract = Math.round(performance.now() - e);

    const r0 = performance.now();
    const resolution = resolve({ intent, transcript, lastPosition, now, gazetteer, areaCentre: area.centre });
    timings.resolve = Math.round(performance.now() - r0);
    timings.total = Math.round(performance.now() - t0);

    return NextResponse.json({ transcript, language: sttLanguage ?? intent.language, intent, resolution, timings_ms: timings, clientTs, area: area.id });
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
