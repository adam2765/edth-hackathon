/**
 * Intent extraction seam. The model reads the transcript and fills the intent schema.
 * It never produces coordinates; the resolver does that from the gazetteer.
 * Mistral if MISTRAL_API_KEY is set, else Featherless (OpenAI-compatible) with FEATHERLESS_API_KEY.
 */
import type { Category, Intent, Relation } from "../geo/types";

export interface IntentExtractor {
  name: string;
  extract(text: string, languageHint?: string | null): Promise<Intent>;
}

const CATEGORIES: Category[] = ["church", "metro_station", "castle", "town_hall", "school", "park", "hospital", "police", "bridge", "street", "other"];
const RELATIONS: Relation[] = ["at", "near", "in_front_of", "behind", "next_to", "north_of", "south_of", "east_of", "west_of", "towards", "between"];

export const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "landmark_text", "landmark_name", "landmark_category", "relation", "language", "confidence"],
  properties: {
    kind: { type: "string", enum: ["position", "movement", "other"] },
    landmark_text: { type: ["string", "null"] },
    landmark_name: { type: ["string", "null"] },
    landmark_category: { type: ["string", "null"], enum: [...CATEGORIES, null] },
    relation: { type: ["string", "null"], enum: [...RELATIONS, null] },
    language: { type: "string", enum: ["en", "fr"] },
    confidence: { type: "number" },
  },
} as const;

export const SYSTEM_PROMPT = `You turn one short spoken position report into JSON. Speakers are on foot in Vincennes, France, and speak English, French, or a mix.

Rules:
- Never output coordinates and never invent a place. Only copy what was said.
- kind: "position" when the speaker says where they are or that they arrived somewhere; "movement" when they are moving or heading towards somewhere ("towards", "heading to", "going to", "vers", "en direction de", "je me dirige vers", "je vais vers"); "other" when no place is given.
- landmark_text: the landmark phrase exactly as said, including type words ("the Château de Vincennes metro station").
- landmark_name: the proper name only, as said ("Château de Vincennes", "Bérault", "rue de Fontenay", "Saint-Louis"). null when only a generic word was said ("the church", "la mairie", "the station").
- landmark_category: from a type word the speaker said ("church"/"église" → church, "metro"/"métro"/"station" → metro_station, "mairie"/"town hall" → town_hall, "rue"/"avenue"/"street" → street, ...). If the type word is only part of the proper name ("Château" in "Château de Vincennes") and no other type word was said, use null.
- relation: "at" (at, à, au, je suis à), "near" (near, close to, près de), "in_front_of" (in front of, outside, devant, en face de), "behind" (behind, derrière), "next_to" (next to, beside, à côté de), "north_of"/"south_of"/"east_of"/"west_of" (north of, au nord de, ...), "towards" (towards, heading to, vers, en direction de), "between" (between, entre). null if no relation is given.
- language: "fr" if the report is mostly French, otherwise "en".
- confidence: 0 to 1, how sure you are of this reading.

Examples:
"I am behind the church" → {"kind":"position","landmark_text":"the church","landmark_name":null,"landmark_category":"church","relation":"behind","language":"en","confidence":0.95}
"Je suis devant la mairie" → {"kind":"position","landmark_text":"la mairie","landmark_name":null,"landmark_category":"town_hall","relation":"in_front_of","language":"fr","confidence":0.95}
"Moving towards Bérault" → {"kind":"movement","landmark_text":"Bérault","landmark_name":"Bérault","landmark_category":null,"relation":"towards","language":"en","confidence":0.9}
"je suis au château de Vincennes" → {"kind":"position","landmark_text":"château de Vincennes","landmark_name":"château de Vincennes","landmark_category":null,"relation":"at","language":"fr","confidence":0.9}
"radio check" → {"kind":"other","landmark_text":null,"landmark_name":null,"landmark_category":null,"relation":null,"language":"en","confidence":0.9}`;

function pick<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/** Coerce whatever came back into a valid Intent. */
export function sanitizeIntent(raw: unknown, languageHint?: string | null): Intent {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const hint = languageHint === "fr" ? "fr" : languageHint === "en" ? "en" : null;
  const conf = typeof o.confidence === "number" && Number.isFinite(o.confidence) ? Math.max(0, Math.min(1, o.confidence)) : 0.5;
  return {
    kind: pick(o.kind, ["position", "movement", "other"] as const) ?? "other",
    landmark_text: str(o.landmark_text),
    landmark_name: str(o.landmark_name),
    landmark_category: pick(o.landmark_category, CATEGORIES),
    relation: pick(o.relation, RELATIONS),
    language: pick(o.language, ["en", "fr"] as const) ?? hint ?? "en",
    confidence: conf,
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
  ) {
    this.name = `${provider}:${model}`;
  }

  async extract(text: string, languageHint?: string | null): Promise<Intent> {
    const response_format = this.useJsonSchema
      ? { type: "json_schema", json_schema: { name: "position_report_intent", schema: INTENT_SCHEMA, strict: true } }
      : { type: "json_object" };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: 200,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        response_format,
      }),
      signal: AbortSignal.timeout(10_000),
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
    return sanitizeIntent(parsed, languageHint);
  }
}

let cached: IntentExtractor | null = null;

export function getExtractor(): IntentExtractor {
  if (cached) return cached;
  if (process.env.MISTRAL_API_KEY) {
    cached = new ChatJsonExtractor("https://api.mistral.ai/v1", process.env.MISTRAL_API_KEY, process.env.MISTRAL_EXTRACT_MODEL || "mistral-small-latest", "mistral", true);
  } else if (process.env.FEATHERLESS_API_KEY) {
    cached = new ChatJsonExtractor(
      "https://api.featherless.ai/v1",
      process.env.FEATHERLESS_API_KEY,
      process.env.FEATHERLESS_MODEL || "Qwen/Qwen2.5-7B-Instruct",
      "featherless",
      false,
    );
  } else throw new Error("No extraction key: set MISTRAL_API_KEY (or FEATHERLESS_API_KEY)");
  return cached;
}
