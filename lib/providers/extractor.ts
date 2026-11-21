/**
 * Intent extraction seam. The model reads the transcript and fills the intent schema.
 * It never produces coordinates; the resolver does that from the gazetteer.
 * PROVIDER_MODE=local: a model on this computer through Ollama, with the same prompt and schema.
 * Otherwise Mistral if MISTRAL_API_KEY is set, else Featherless (OpenAI-compatible) with FEATHERLESS_API_KEY.
 */
import type { Category, Direction, Intent, Relation } from "../geo/types";
import { TRACK_KINDS } from "../geo/trackKinds";
import { ollamaUrl, providerMode } from "./mode";

export interface ExtractOptions {
  /** Language reported by speech-to-text, if any. */
  languageHint?: string | null;
  /** Where the speakers are, e.g. "central Kyiv, Ukraine". Context only; never used for coordinates. */
  place?: string;
  /** Overrides the extractor's own time limit, for example while a local model loads. */
  timeoutMs?: number;
  /**
   * The language the speaker's device is set to (decision 106). The intent takes it as is and the
   * model's own label is not used. Without it, the model's label is checked against the transcript.
   */
  language?: Intent["language"] | null;
}

/** A language the device pinned, from the report's `language` field; null when absent or unknown. */
export function pinnedLanguage(v: unknown): Intent["language"] | null {
  return v === "en" || v === "fr" || v === "uk" ? v : null;
}

/** Local extraction model (decision 84): as accurate as the 8B on the scenarios, and about 2 s instead of 5. */
export const LOCAL_EXTRACT_MODEL = "ministral-3:3b";

export interface IntentExtractor {
  name: string;
  extract(text: string, opts?: ExtractOptions): Promise<Intent>;
}

const CATEGORIES: Category[] = [
  "church", "metro_station", "castle", "town_hall", "school", "park", "cemetery", "hospital", "police", "bridge", "street",
  "stop", "fuel", "pharmacy", "hotel", "water", "building", "intersection", "other",
];
const RELATIONS: Relation[] = [
  "at",
  "near",
  "in_front_of",
  "behind",
  "next_to",
  "north_of",
  "south_of",
  "east_of",
  "west_of",
  "north_east_of",
  "south_east_of",
  "south_west_of",
  "north_west_of",
  "towards",
  "between",
];
const DIRECTIONS: Direction[] = ["north", "north_east", "east", "south_east", "south", "south_west", "west", "north_west"];
/** A stated distance beyond this is not a report from someone on foot; it is dropped. */
export const MAX_DISTANCE_M = 20_000;

export const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "landmark_text", "landmark_name", "landmark_name_lemma", "landmark_category", "relation", "distance_m", "direction", "language", "confidence", "track"],
  properties: {
    kind: { type: "string", enum: ["position", "movement", "other"] },
    landmark_text: { type: ["string", "null"] },
    landmark_name: { type: ["string", "null"] },
    landmark_name_lemma: { type: ["string", "null"] },
    landmark_category: { type: ["string", "null"], enum: [...CATEGORIES, null] },
    relation: { type: ["string", "null"], enum: [...RELATIONS, null] },
    distance_m: { type: ["number", "null"] },
    direction: { type: ["string", "null"], enum: [...DIRECTIONS, null] },
    language: { type: "string", enum: ["en", "fr", "uk"] },
    confidence: { type: "number" },
    // Last, and null for a report about the speaker: a position report is then written as before
    // tracks existed, plus one short key. Six flat keys cost every report about a second on the local model.
    track: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["ref", "kind", "count", "text", "heading"],
          properties: {
            ref: { type: ["number", "null"] },
            kind: { type: "string", enum: TRACK_KINDS },
            count: { type: ["number", "null"] },
            text: { type: ["string", "null"] },
            heading: { type: ["string", "null"], enum: [...DIRECTIONS, null] },
          },
        },
      ],
    },
  },
} as const;

/** What every example about the speaker ends with: no track. */
const SELF_TAIL = ',"track":null}';

export function systemPrompt(place = "Vincennes, France"): string {
  const prompt = `You turn one short spoken position report into JSON. Speakers are on foot in ${place}, and speak English, French or Ukrainian, sometimes mixed (Russian words may slip in).

Rules:
- Never output coordinates and never invent a place. Only copy what was said. Never translate a name and never change its script.
- kind: "position" when the speaker says where they are or that they arrived somewhere; "movement" when they are moving or heading towards somewhere ("towards", "heading to", "going to", "vers", "en direction de", "je me dirige vers", "je vais à", "je vais au", "рухаюсь до", "йду до", "иду к", "прямую до", "у напрямку", "в бік"), or say how far or which way they moved ("moved 300 metres north", "j'ai avancé de 200 mètres vers l'est", "пройшов двісті метрів на північ"); "other" when neither a place nor a distance or compass direction is given.
- landmark_text: the landmark phrase exactly as said, including type words ("the Château de Vincennes metro station", "станції метро Хрещатик").
- landmark_name: the proper name only, exactly as said, keeping its grammatical case ("Château de Vincennes", "Bérault", "rue de Fontenay", "Хрещатику", "Золотих воріт", "вулиці Володимирській"). Leave out type words that are not part of the name ("metro", "station", "станція метро"). null when only a generic word was said ("the church", "la mairie", "церкви", "мостом").
- landmark_name_lemma: landmark_name in its dictionary (nominative) form, same language and script ("Хрещатику" → "Хрещатик", "Золотих воріт" → "Золоті ворота", "Софійського собору" → "Софійський собор", "вулиці Володимирській" → "вулиця Володимирська"). In English and French it equals landmark_name. null when landmark_name is null.
- landmark_category: from a type word the speaker said: church (church, église, chapelle, церква, храм, собор), metro_station (metro, station, métro, gare, метро, станція, вокзал), castle (castle, château, замок, фортеця), town_hall (town hall, mairie, мерія, міськрада), school (school, école, школа, університет), park (park, parc, парк, сквер), cemetery (cemetery, graveyard, cimetière, кладовище, цвинтар), hospital (hospital, hôpital, лікарня, госпіталь), police (police, commissariat, поліція), bridge (bridge, pont, міст), street (street, rue, avenue, вулиця, проспект, площа, бульвар), stop (bus stop, tram stop, arrêt, зупинка), fuel (petrol station, gas station, station-service, заправка, АЗС), pharmacy (pharmacy, pharmacie, аптека), hotel (hotel, hôtel, готель, хостел; but "hôtel de ville" is town_hall), water (river, lake, pond, canal, rivière, lac, étang, річка, озеро, ставок), building (building, immeuble, résidence, будинок, будівля, ЖК), intersection (intersection, crossroads, junction, corner, carrefour, croisement, angle, перехрестя). If the type word is only part of the proper name ("Château" in "Château de Vincennes") and no other type word was said, use null.
- A crossing ("passing the next intersection", "au prochain carrefour", "на перехресті з вулицею Хмельницького") is landmark_category "intersection", kind "position" and relation "at". landmark_name is the street it crosses, if one is named, else null. Never "other" just because no name was said.
- relation: "at" (at, à, au, на, в, у), "near" (near, close to, près de, біля, коло, поруч з, недалеко від), "in_front_of" (in front of, outside, devant, en face de, перед, навпроти), "behind" (behind, derrière, за, позаду), "next_to" (next to, beside, à côté de, поряд з), "north_of"/"south_of"/"east_of"/"west_of" (north of, au nord de, на північ від, ...), "north_east_of"/"south_east_of"/"south_west_of"/"north_west_of" (north-east of, au nord-est de, на північний схід від, ...), "towards" (towards, heading to, vers, en direction de, до, у напрямку, в бік, к), "between" (between, entre, між). null if no relation is given. After a verb of going, "à", "au", "в" and "у" are "towards", not "at" ("je vais au parc", "иду в школу").
- Moving down, up or along a street ("moving down Avenue de Nogent", "je remonte la rue de Fontenay", "йду вулицею Хрещатик", "рухаюсь по Хрещатику") is kind "movement" with relation null: the speaker is on that street. Use "towards" only when they are going to a place they are not at yet.
- distance_m: a distance the speaker said, as a number of metres ("200 metres" → 200, "half a kilometre" → 500, "1.5 km" → 1500, "deux cents mètres" → 200, "двісті метрів" → 200, "півкілометра" → 500). null when no distance was said. Never work one out from a time, a number of streets or a vague word ("five minutes", "two blocks", "a bit further" → null).
- direction: the compass direction the speaker moved or is moving in: "north", "north_east", "east", "south_east", "south", "south_west", "west", "north_west" ("moved 300 metres north", "heading south-east", "vers le nord", "на північ", "на південний захід"). null when none was said, when it is not a compass direction ("left", "forward", "back"), and when the compass word says where the speaker is from a landmark: "north of the church" is relation "north_of" with direction null.
- A movement measured from where the speaker was before ("from here", "from my last position", "de ma position", "звідси") names no landmark: landmark_text, landmark_name and landmark_category are null.
- Two places in one report, one the speaker is at, leaving or passing and one they are going to: report only the place they are going to, as kind "movement" with relation "towards". This holds whichever place comes first and in every language ("from the school to the park", "je suis à la poste, je vais à la gare", "я біля школи, йду до парку", "я возле школы, иду к рынку"). The place they are at, leaving or passing is never the landmark. WRONG: "Going past the bakery towards the post office" → landmark "the bakery". RIGHT: landmark "the post office", relation "towards". "Was at X, now at Y" names where they are now: Y, as a position. A crossing with no place to go to ("passing the next junction, going north") is not two places: it follows the crossing rule above, kind "position" and relation "at".
- track: null when the report is about where the speaker is. An object when it is about something else the speaker sees or knows of: people, a vehicle, a tank, a drone, a drone team, a mortar, a gun, a jammer ("enemy vehicle in front of the town hall", "I see a drone 300 metres north of me", "Track 3 moved to the station", "véhicule ennemi devant la mairie", "ворожий танк біля церкви"). With "I", "we", "us" or "me" (je, nous, я, ми) the report is about the speaker, so track is null, even with a side word or a unit word ("We're friendlies, at the bakery" → track null); this decides only track, and every other field follows the rules above. Only without them does a side word ("friendly", "friendlies", "hostile", "enemy", "ami", "allié", "ennemi", "свої", "ворог") name another unit, so the report is a track. WRONG: "Friendly at the bakery" → track null. RIGHT: "Friendly at the bakery" → a track at "the bakery". A landmark the speaker sees ("I can see the church") is not a track: null.
- For a track, kind is "position", and landmark_text, landmark_name, landmark_category, relation and distance_m say where the thing is, by the rules above ("in front of the town hall" is relation "in_front_of"). A named street or place is copied as for a position report ("unknown truck on rue de Fontenay" is landmark_name "rue de Fontenay", relation "at"). "Moved to X", "now at X" and "is at X" are relation "at"; "towards" only while the thing is still on its way there. When it is measured from the speaker ("300 metres north of me", "à 200 mètres à l'est de ma position", "за триста метрів на північ від мене"): no landmark, relation null, distance_m, and direction is that compass direction.
- track.ref: the number when the speaker names a track ("Track 3", "piste trois", "об'єкт три" → 3), else null.
- track.kind: from a type word the speaker said: "people" (person, soldiers, infantry, patrol, soldats, піхота, солдати), "vehicle" (car, truck, véhicule, camion, машина, вантажівка), "armour" (tank, APC, char, blindé, танк, БМП, БТР), "drone" (drone, UAV, quadcopter, дрон, БПЛА), "drone_team" (drone team, équipe drone, розрахунок БПЛА), "mortar" (mortier, міномет), "artillery" (gun, howitzer, canon, гармата), "jammer" (jammer, electronic warfare, brouilleur, РЕБ), else "other".
- track.count: how many, when said ("two vehicles" → 2), else null.
- track.text: the thing as said, without the place ("two enemy vehicles"), else null.
- track.heading: the compass direction the thing itself is moving in, when said ("moving east" → "east"), else null. It is not where the thing is from the speaker.
- language: "fr" if the report is mostly French, "uk" if it is mostly Ukrainian or Russian, otherwise "en".
- confidence: 0 to 1, how sure you are of this reading.

Examples:
"I am behind the church" → {"kind":"position","landmark_text":"the church","landmark_name":null,"landmark_name_lemma":null,"landmark_category":"church","relation":"behind","distance_m":null,"direction":null,"language":"en","confidence":0.95}
"Je suis devant la mairie" → {"kind":"position","landmark_text":"la mairie","landmark_name":null,"landmark_name_lemma":null,"landmark_category":"town_hall","relation":"in_front_of","distance_m":null,"direction":null,"language":"fr","confidence":0.95}
"Moving towards Bérault" → {"kind":"movement","landmark_text":"Bérault","landmark_name":"Bérault","landmark_name_lemma":"Bérault","landmark_category":null,"relation":"towards","distance_m":null,"direction":null,"language":"en","confidence":0.9}
"Moving down Avenue de Nogent" → {"kind":"movement","landmark_text":"Avenue de Nogent","landmark_name":"Avenue de Nogent","landmark_name_lemma":"Avenue de Nogent","landmark_category":"street","relation":null,"distance_m":null,"direction":null,"language":"en","confidence":0.9}
"je suis au château de Vincennes" → {"kind":"position","landmark_text":"château de Vincennes","landmark_name":"château de Vincennes","landmark_name_lemma":"château de Vincennes","landmark_category":null,"relation":"at","distance_m":null,"direction":null,"language":"fr","confidence":0.9}
"Я біля церкви" → {"kind":"position","landmark_text":"церкви","landmark_name":null,"landmark_name_lemma":null,"landmark_category":"church","relation":"near","distance_m":null,"direction":null,"language":"uk","confidence":0.95}
"Перебуваю біля станції метро Хрещатик" → {"kind":"position","landmark_text":"станції метро Хрещатик","landmark_name":"Хрещатик","landmark_name_lemma":"Хрещатик","landmark_category":"metro_station","relation":"near","distance_m":null,"direction":null,"language":"uk","confidence":0.95}
"Рухаюсь до Золотих воріт" → {"kind":"movement","landmark_text":"Золотих воріт","landmark_name":"Золотих воріт","landmark_name_lemma":"Золоті ворота","landmark_category":null,"relation":"towards","distance_m":null,"direction":null,"language":"uk","confidence":0.9}
"I'm about 200 metres south of the church" → {"kind":"position","landmark_text":"the church","landmark_name":null,"landmark_name_lemma":null,"landmark_category":"church","relation":"south_of","distance_m":200,"direction":null,"language":"en","confidence":0.95}
"Moved 300 metres north" → {"kind":"movement","landmark_text":null,"landmark_name":null,"landmark_name_lemma":null,"landmark_category":null,"relation":null,"distance_m":300,"direction":"north","language":"en","confidence":0.9}
"J'ai avancé de 150 mètres vers l'est" → {"kind":"movement","landmark_text":null,"landmark_name":null,"landmark_name_lemma":null,"landmark_category":null,"relation":null,"distance_m":150,"direction":"east","language":"fr","confidence":0.9}
"Пройшов півкілометра на південний захід" → {"kind":"movement","landmark_text":null,"landmark_name":null,"landmark_name_lemma":null,"landmark_category":null,"relation":null,"distance_m":500,"direction":"south_west","language":"uk","confidence":0.9}
"Passing the next intersection" → {"kind":"position","landmark_text":"the next intersection","landmark_name":null,"landmark_name_lemma":null,"landmark_category":"intersection","relation":"at","distance_m":null,"direction":null,"language":"en","confidence":0.9}
"Je suis au carrefour avec la rue de Fontenay" → {"kind":"position","landmark_text":"carrefour avec la rue de Fontenay","landmark_name":"rue de Fontenay","landmark_name_lemma":"rue de Fontenay","landmark_category":"intersection","relation":"at","distance_m":null,"direction":null,"language":"fr","confidence":0.9}
"radio check" → {"kind":"other","landmark_text":null,"landmark_name":null,"landmark_name_lemma":null,"landmark_category":null,"relation":null,"distance_m":null,"direction":null,"language":"en","confidence":0.9}`;
  // Every example above is about the speaker; the examples about a track are written out in full.
  return `${prompt.replace(/("confidence":[\d.]+)\}/g, `$1${SELF_TAIL}`)}
"Enemy vehicle in front of the town hall" → {"kind":"position","landmark_text":"the town hall","landmark_name":null,"landmark_name_lemma":null,"landmark_category":"town_hall","relation":"in_front_of","distance_m":null,"direction":null,"language":"en","confidence":0.9,"track":{"ref":null,"kind":"vehicle","count":null,"text":"enemy vehicle","heading":null}}
"I see a drone about 300 metres north of me" → {"kind":"position","landmark_text":null,"landmark_name":null,"landmark_name_lemma":null,"landmark_category":null,"relation":null,"distance_m":300,"direction":"north","language":"en","confidence":0.9,"track":{"ref":null,"kind":"drone","count":null,"text":"a drone","heading":null}}
"Deux véhicules suspects près de l'église, ils roulent vers l'est" → {"kind":"position","landmark_text":"l'église","landmark_name":null,"landmark_name_lemma":null,"landmark_category":"church","relation":"near","distance_m":null,"direction":null,"language":"fr","confidence":0.9,"track":{"ref":null,"kind":"vehicle","count":2,"text":"deux véhicules suspects","heading":"east"}}
"Ворожий танк біля церкви" → {"kind":"position","landmark_text":"церкви","landmark_name":null,"landmark_name_lemma":null,"landmark_category":"church","relation":"near","distance_m":null,"direction":null,"language":"uk","confidence":0.9,"track":{"ref":null,"kind":"armour","count":null,"text":"ворожий танк","heading":null}}
"Unknown truck on rue de Fontenay" → {"kind":"position","landmark_text":"rue de Fontenay","landmark_name":"rue de Fontenay","landmark_name_lemma":"rue de Fontenay","landmark_category":"street","relation":"at","distance_m":null,"direction":null,"language":"en","confidence":0.9,"track":{"ref":null,"kind":"vehicle","count":null,"text":"unknown truck","heading":null}}
"Friendly at Elmfield metro" → {"kind":"position","landmark_text":"Elmfield metro","landmark_name":"Elmfield","landmark_name_lemma":"Elmfield","landmark_category":"metro_station","relation":"at","distance_m":null,"direction":null,"language":"en","confidence":0.9,"track":{"ref":null,"kind":"other","count":null,"text":"friendly","heading":null}}
"Track 3 moved to Bérault" → {"kind":"position","landmark_text":"Bérault","landmark_name":"Bérault","landmark_name_lemma":"Bérault","landmark_category":null,"relation":"at","distance_m":null,"direction":null,"language":"en","confidence":0.9,"track":{"ref":3,"kind":"other","count":null,"text":null,"heading":null}}
"Track 2 is hostile" → {"kind":"other","landmark_text":null,"landmark_name":null,"landmark_name_lemma":null,"landmark_category":null,"relation":null,"distance_m":null,"direction":null,"language":"en","confidence":0.9,"track":{"ref":2,"kind":"other","count":null,"text":null,"heading":null}}`;
}

function pick<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/**
 * The model's language label, checked against the letters actually said (decision 104). The local
 * 3B model labelled English reports in Kyiv as Ukrainian ("I'm at Khreshchatyk."), so the
 * question came back in Ukrainian.
 *   no Cyrillic letters:           not Ukrainian, unless speech-to-text said so; then the model's
 *                                  en or fr, else speech-to-text's, else English
 *   Cyrillic and no Latin letters: Ukrainian
 *   both:                          the model's label
 */
export function checkLanguage(said: Intent["language"], transcript: string, hint: Intent["language"] | null): Intent["language"] {
  if (!/\p{Script=Cyrillic}/u.test(transcript)) {
    if (said !== "uk" || hint === "uk") return said;
    return hint === "fr" ? "fr" : "en";
  }
  if (!/\p{Script=Latin}/u.test(transcript)) return "uk";
  return said;
}

/** Coerce whatever came back into a valid Intent. With the transcript, the language is checked too. */
export function sanitizeIntent(raw: unknown, languageHint?: string | null, transcript?: string): Intent {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const hint = languageHint === "fr" ? "fr" : languageHint === "en" ? "en" : languageHint === "uk" || languageHint === "ru" ? "uk" : null;
  const conf = typeof o.confidence === "number" && Number.isFinite(o.confidence) ? Math.max(0, Math.min(1, o.confidence)) : 0.5;
  const tr = o.track && typeof o.track === "object" ? (o.track as Record<string, unknown>) : null;
  /** A whole number from 1 to 999: a track's number, or how many were seen. */
  const whole = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1000 ? v : null);
  const dist = typeof o.distance_m === "number" && Number.isFinite(o.distance_m) && o.distance_m > 0 && o.distance_m <= MAX_DISTANCE_M ? Math.round(o.distance_m) : null;
  const said = pick(o.language, ["en", "fr", "uk"] as const) ?? hint ?? "en";
  return {
    kind: pick(o.kind, ["position", "movement", "other"] as const) ?? "other",
    landmark_text: str(o.landmark_text),
    landmark_name: str(o.landmark_name),
    landmark_name_lemma: str(o.landmark_name_lemma) ?? str(o.landmark_name),
    landmark_category: pick(o.landmark_category, CATEGORIES),
    relation: pick(o.relation, RELATIONS),
    distance_m: dist || null,
    direction: pick(o.direction, DIRECTIONS),
    language: transcript === undefined ? said : checkLanguage(said, transcript, hint),
    confidence: conf,
    // The model writes one `track` object, or null; the intent carries it as flat fields.
    subject: tr ? "track" : "self",
    track_ref: whole(tr?.ref),
    track_kind: pick(tr?.kind, TRACK_KINDS),
    track_count: whole(tr?.count),
    track_text: str(tr?.text),
    track_heading: pick(tr?.heading, DIRECTIONS),
  };
}

class ChatJsonExtractor implements IntentExtractor {
  name: string;
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string,
    private provider: string,
    private useJsonSchema: boolean,
    private timeoutMs = 10_000,
  ) {
    this.name = `${provider}:${model}`;
  }

  async extract(text: string, opts: ExtractOptions = {}): Promise<Intent> {
    const response_format = this.useJsonSchema
      ? { type: "json_schema", json_schema: { name: "position_report_intent", schema: INTENT_SCHEMA, strict: true } }
      : { type: "json_object" };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: 400,
        messages: [
          { role: "system", content: systemPrompt(opts.place) },
          { role: "user", content: text },
        ],
        response_format,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs),
    });
    if (!res.ok) throw new Error(`${this.provider} extract ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = j.choices?.[0]?.message?.content ?? "{}";
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }
    const intent = sanitizeIntent(parsed, opts.languageHint, text);
    return opts.language ? { ...intent, language: opts.language } : intent;
  }
}

let cached: IntentExtractor | null = null;

export function getExtractor(): IntentExtractor {
  if (cached) return cached;
  if (providerMode() === "local") {
    // Ollama ignores the key. 25 s instead of 10: the first report after a start or an area change
    // is slower, and the route allows 30 s.
    cached = new ChatJsonExtractor(`${ollamaUrl()}/v1`, "ollama", process.env.LOCAL_EXTRACT_MODEL || LOCAL_EXTRACT_MODEL, "ollama", true, 25_000);
  } else if (process.env.MISTRAL_API_KEY) {
    cached = new ChatJsonExtractor("https://api.mistral.ai/v1", process.env.MISTRAL_API_KEY, process.env.MISTRAL_EXTRACT_MODEL || "mistral-small-latest", "mistral", true);
  } else if (process.env.FEATHERLESS_API_KEY) {
    cached = new ChatJsonExtractor(
      "https://api.featherless.ai/v1",
      process.env.FEATHERLESS_API_KEY,
      process.env.FEATHERLESS_MODEL || "Qwen/Qwen2.5-7B-Instruct",
      "featherless",
      false,
    );
  } else throw new Error("No extraction key: set MISTRAL_API_KEY (or FEATHERLESS_API_KEY), or run offline with PROVIDER_MODE=local (docs/setup.md, part 3)");
  return cached;
}

/**
 * Loads the local model and each place's prompt before the first report, so no speaker waits for that.
 * Measured on the MacBook: 9 s to load the 3B model, 6 s for the first report in a new area.
 */
export async function warmUpExtractor(places: string[]): Promise<void> {
  const extractor = getExtractor();
  for (const place of places) {
    const t0 = performance.now();
    try {
      await extractor.extract("I'm at the town hall.", { place, timeoutMs: 120_000 });
      console.log(`[extractor] ${extractor.name} ready for ${place} in ${Math.round(performance.now() - t0)} ms`);
    } catch (err) {
      console.warn(`[extractor] ${extractor.name} warm-up for ${place} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
