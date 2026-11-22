/**
 * Reading a reply to an open question. Measured by `npm run eval:replies`; not in the request
 * path yet. When a unit speaks while a question is open, the model says what the reply does: picks
 * one of the numbered choices, says none is right, says where instead, asks to hear it again, and
 * so on. It returns a kind and a choice number, never a place: the place is the stored choice's.
 * A prompt of its own, apart from the extraction prompt, so that prompt and its baselines stay as
 * they are. Same providers as extraction: Mistral, or Ollama with PROVIDER_MODE=local.
 */
import { LOCAL_EXTRACT_MODEL } from "./extractor";
import { ollamaUrl, providerMode } from "./mode";
import { ollamaChatBody, ollamaChatContent, type ChatMessage } from "./ollama";

export const REPLY_KINDS = ["pick", "none", "rephrase", "repeat", "stand_by", "dont_know", "disregard", "new_report", "unclear"] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];

export interface QuestionChoice {
  name: string;
  /** The kind of place, in English words: "metro station", "castle", "crossing". */
  kind: string;
  distance_m?: number;
  /** The town, when it tells two same-name places apart. */
  town?: string;
}

export interface OpenQuestion {
  /** Who the question is about: the speaker, or a track, by its number and the words said for it. */
  about: "self" | { track: number; text?: string };
  /** The question as the speaker heard it. */
  text: string;
  choices: QuestionChoice[];
}

export interface ReplyReading {
  kind: ReplyKind;
  /** The chosen choice, counting from 1, for `pick`; null for every other kind. */
  choice: number | null;
}

export interface ReplyReader {
  name: string;
  read(reply: string, question: OpenQuestion, opts?: { timeoutMs?: number }): Promise<ReplyReading>;
}

export const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "choice"],
  properties: {
    kind: { type: "string", enum: [...REPLY_KINDS] },
    choice: { type: ["integer", "null"] },
  },
};

/** The rules. The examples use names that are in no area's gazetteer, so a copied name shows up. */
export function replyPrompt(): string {
  return `You read a reply to a question asked by a position-reporting app used by soldiers and field units over the radio.
The app asked because a report could mean more than one place. You get who the question is about (the speaker, or a track: something the speaker reported seeing), the question, its numbered choices, and the reply as speech-to-text wrote it.
The reply may be in English, French, Ukrainian or Russian. It may have filler words, a call sign, or radio words such as "over".

Say what the reply does, as one kind:
- pick: it chooses one of the choices: by its number or place in the list ("two", "the second", "the last one"), by its name or part of it, by its kind ("the metro", "the castle"), by its town, by what sets it apart ("the closer one"), or in a sentence that names it ("I'm at the castle"). "Yes", "correct" or "affirm" picks the choice when there is only one.
- none: it says no choice is right and gives no other place ("neither", "none of them"; "no" or "negative" alone).
- rephrase: it answers the question with a place that is not one of the choices: another place, or a distance and a direction, for the same thing the question is about ("no, by the town hall", "correction, 300 metres north of me"). A reply that gives only a place, naming no one, is about what the question is about.
- repeat: it asks to hear the question or the choices again, or asks about them ("say again", "which one is closer?").
- stand_by: it asks the app to wait; the answer will come later ("wait one", "stand by").
- dont_know: it says it cannot tell which ("not sure", "no idea").
- disregard: it withdraws the report the question is about ("disregard", "cancel that", "ignore my last").
- new_report: it is not an answer but a new report: the speaker has moved on, or reports something else, or it is about someone or something other than what the question is about. For a question about a track, "I'm at ..." is about the speaker. For a question about the speaker, a sighting of a vehicle or a drone is about a track.
- unclear: no usable words (noise, a sound, a cut-off word), or a reply that fits no kind, such as "yes" to a question with two or more choices.

Rules:
- choice is the number of the chosen choice for pick, and null for every other kind.
- A number that counts things or measures a distance is not a choice: "two blocks east", "two vehicles", "200 metres".
- A reply that first rejects and then picks ("no, the second one", "not the castle, the metro") is a pick.
- A reply that picks and then reports something more is a pick.
- Pick only when exactly one choice fits. When the words fit two choices, it is unclear.

Examples:
Question about: the speaker
Question: Which one: Oakfield (station), or Oakfield (park)?
Choices:
1. Oakfield (metro station, 300 m)
2. Oakfield (park, 450 m)
Reply: "the park" -> {"kind":"pick","choice":2}
Reply: "number one, over" -> {"kind":"pick","choice":1}
Reply: "neither" -> {"kind":"none","choice":null}
Reply: "neither, I'm by the bakery on Elm Street" -> {"kind":"rephrase","choice":null}
Reply: "moving north now" -> {"kind":"new_report","choice":null}

Question about: Track 3 (enemy vehicle), something the speaker reported seeing
Question: Track 3. Which bridge: Mill Bridge, or Stone Bridge?
Choices:
1. Mill Bridge (bridge, 600 m)
2. Stone Bridge (bridge, 900 m)
Reply: "near the school instead" -> {"kind":"rephrase","choice":null}
Reply: "I'm at the school" -> {"kind":"new_report","choice":null}

Answer with JSON only: {"kind": "...", "choice": number or null}.`;
}

const metres = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

/** The user message: who it is about, the question, the numbered choices and the reply. */
export function replyMessage(reply: string, q: OpenQuestion): string {
  const about = q.about === "self" ? "the speaker" : `Track ${q.about.track}${q.about.text ? ` (${q.about.text})` : ""}, something the speaker reported seeing`;
  const choices = q.choices.map((c, i) => {
    const parts = [c.kind, c.town, c.distance_m != null ? metres(c.distance_m) : null].filter(Boolean);
    return `${i + 1}. ${c.name} (${parts.join(", ")})`;
  });
  return [`Question about: ${about}`, `Question: ${q.text}`, "Choices:", ...choices, `Reply: ${JSON.stringify(reply)}`].join("\n");
}

/** Keeps the model's answer inside the rules: a known kind, and a choice only for a pick that was offered. */
export function sanitizeReading(o: unknown, choices: number): ReplyReading {
  const r = (o ?? {}) as { kind?: unknown; choice?: unknown };
  const kind = REPLY_KINDS.includes(r.kind as ReplyKind) ? (r.kind as ReplyKind) : "unclear";
  if (kind !== "pick") return { kind, choice: null };
  const n = typeof r.choice === "number" ? r.choice : typeof r.choice === "string" ? Number(r.choice) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= choices ? { kind, choice: n } : { kind: "unclear", choice: null };
}

class ChatJsonReplyReader implements ReplyReader {
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

  async read(reply: string, question: OpenQuestion, opts: { timeoutMs?: number } = {}): Promise<ReplyReading> {
    const response_format = this.useJsonSchema
      ? { type: "json_schema", json_schema: { name: "reply_reading", schema: REPLY_SCHEMA, strict: true } }
      : { type: "json_object" };
    const messages: ChatMessage[] = [
      { role: "system", content: replyPrompt() },
      { role: "user", content: replyMessage(reply, question) },
    ];
    // Ollama through its own endpoint, at the same context as extraction, so the model is not reloaded [254].
    const native = this.provider === "ollama";
    const res = await fetch(native ? `${this.baseUrl}/api/chat` : `${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(
        native
          ? ollamaChatBody(this.model, messages, REPLY_SCHEMA, 60)
          : { model: this.model, temperature: 0, max_tokens: 60, messages, response_format },
      ),
      signal: AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs),
    });
    if (!res.ok) throw new Error(`reply reader ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = (native ? ollamaChatContent(j) : j.choices?.[0]?.message?.content) ?? "{}";
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }
    return sanitizeReading(parsed, question.choices.length);
  }
}

let cached: ReplyReader | null = null;

/** The same provider and model as `getExtractor()`. */
export function getReplyReader(): ReplyReader {
  if (cached) return cached;
  if (providerMode() === "local") {
    cached = new ChatJsonReplyReader(ollamaUrl(), "ollama", process.env.LOCAL_EXTRACT_MODEL || LOCAL_EXTRACT_MODEL, "ollama", true, 25_000);
  } else if (process.env.MISTRAL_API_KEY) {
    cached = new ChatJsonReplyReader("https://api.mistral.ai/v1", process.env.MISTRAL_API_KEY, process.env.MISTRAL_EXTRACT_MODEL || "mistral-small-latest", "mistral", true);
  } else if (process.env.FEATHERLESS_API_KEY) {
    cached = new ChatJsonReplyReader("https://api.featherless.ai/v1", process.env.FEATHERLESS_API_KEY, process.env.FEATHERLESS_MODEL || "Qwen/Qwen2.5-7B-Instruct", "featherless", false);
  } else throw new Error("No key for the reply reader: set MISTRAL_API_KEY, or run offline with PROVIDER_MODE=local (docs/setup.md, part 3)");
  return cached;
}
