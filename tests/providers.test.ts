import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each test loads the providers afresh, because they cache their choice.
async function providers() {
  vi.resetModules();
  const extractor = await import("../lib/providers/extractor");
  const transcriber = await import("../lib/providers/transcriber");
  return { ...extractor, ...transcriber };
}

describe("provider mode", () => {
  beforeEach(() => {
    vi.stubEnv("PROVIDER_MODE", "");
    vi.stubEnv("MISTRAL_API_KEY", "");
    vi.stubEnv("MISTRAL_EXTRACT_MODEL", "");
    vi.stubEnv("LOCAL_EXTRACT_MODEL", "");
    vi.stubEnv("OLLAMA_URL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is hosted by default", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "test-key");
    const { getExtractor } = await providers();
    expect(getExtractor().name).toBe("mistral:mistral-small-latest");
  });

  it("extracts with Ollama in local mode, with no key", async () => {
    vi.stubEnv("PROVIDER_MODE", "local");
    const { getExtractor } = await providers();
    expect(getExtractor().name).toBe("ollama:ministral-3:3b");
  });

  it("takes the local model from LOCAL_EXTRACT_MODEL", async () => {
    vi.stubEnv("PROVIDER_MODE", "local");
    vi.stubEnv("LOCAL_EXTRACT_MODEL", "ministral-3:8b");
    const { getExtractor } = await providers();
    expect(getExtractor().name).toBe("ollama:ministral-3:8b");
  });

  it("never sends audio to Mistral in local mode, even with a key", async () => {
    vi.stubEnv("PROVIDER_MODE", "local");
    vi.stubEnv("MISTRAL_API_KEY", "test-key");
    const { getTranscriber, NoLocalTranscriberError } = await providers();
    expect(() => getTranscriber()).toThrow(NoLocalTranscriberError);
  });

  it("sends the same schema request to Ollama on this computer", async () => {
    vi.stubEnv("PROVIDER_MODE", "local");
    const reply = { kind: "position", landmark_text: "the town hall", landmark_name: null, landmark_name_lemma: null, landmark_category: "town_hall", relation: "at", distance_m: null, direction: null, language: "en", confidence: 0.9 };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const { getExtractor } = await providers();
    const intent = await getExtractor().extract("I'm at the town hall.", { place: "Vincennes, France" });

    expect(intent.landmark_category).toBe("town_hall");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("ministral-3:3b");
    expect(body.response_format.type).toBe("json_schema");
  });

  it("takes the language the device pinned over the model's label (decision 106)", async () => {
    vi.stubEnv("PROVIDER_MODE", "local");
    // What the local 3B model answered for an English report in Kyiv
    const reply = { kind: "position", landmark_text: "Khreshchatyk", landmark_name: "Хрещатик", landmark_name_lemma: "Хрещатик", landmark_category: null, relation: "at", distance_m: null, direction: null, language: "uk", confidence: 0.9 };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }))));
    const { getExtractor, pinnedLanguage } = await providers();
    const place = "central Kyiv, Ukraine";
    expect((await getExtractor().extract("I'm at Хрещатик.", { place, language: "en" })).language).toBe("en");
    expect((await getExtractor().extract("I'm at Хрещатик.", { place, language: "fr" })).language).toBe("fr");
    // Not pinned: the model's label, checked against the letters (mixed here, so it stands)
    expect((await getExtractor().extract("I'm at Хрещатик.", { place })).language).toBe("uk");
    expect([pinnedLanguage("uk"), pinnedLanguage("ru"), pinnedLanguage(null), pinnedLanguage("")]).toEqual(["uk", null, null, null]);
  });
});

describe("Mistral speech-to-text with speakers told apart", () => {
  beforeEach(() => {
    vi.stubEnv("PROVIDER_MODE", "");
    vi.stubEnv("MISTRAL_API_KEY", "test-key");
    vi.stubEnv("MISTRAL_STT_DIARIZE", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const clip = new Blob([new Uint8Array(8)], { type: "audio/webm" });
  const segments = [
    { text: " I'm at Bérault.", speaker_id: "speaker_0", start: 0, end: 1.2 },
    { text: " Going to the castle.", speaker_id: "speaker_1", start: 1.3, end: 2.5 },
    { text: " Now.", speaker_id: "speaker_1", start: 2.5, end: 2.9 },
  ];

  it("marks a change of speaker with >>, the mark voices are split at", async () => {
    const { joinSpeakers } = await providers();
    expect(joinSpeakers(segments)).toBe("I'm at Bérault. >> Going to the castle. Now.");
    expect(joinSpeakers([{ text: "One voice." }, { text: "Still one." }])).toBe("One voice. Still one.");
    expect(joinSpeakers([{ text: "A", speaker_id: "s0" }, { text: " " }, { text: "B", speaker_id: null }, { text: "C", speaker_id: "s1" }])).toBe("A B >> C");
  });

  it("asks for speakers and segment timestamps, and joins the segments", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: "I'm at Bérault. Going to the castle. Now.", language: "en", segments })));
    vi.stubGlobal("fetch", fetchMock);
    const { getTranscriber } = await providers();
    const r = await getTranscriber().transcribe(clip, "audio/webm", ["Bérault"]);
    expect(r).toEqual({ text: "I'm at Bérault. >> Going to the castle. Now.", language: "en" });
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(form.get("diarize")).toBe("true");
    expect(form.get("timestamp_granularities")).toBe("segment");
    expect(form.getAll("context_bias")).toEqual(["Bérault"]);
  });

  it("transcribes again without speakers when Mistral refuses the option", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("diarize not supported", { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "I'm at Bérault.", language: "en" })));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getTranscriber } = await providers();
    expect((await getTranscriber().transcribe(clip, "audio/webm", [])).text).toBe("I'm at Bérault.");
    const second = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as FormData;
    expect(second.get("diarize")).toBeNull();
  });

  it("does not retry an outage", async () => {
    const fetchMock = vi.fn(async () => new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const { getTranscriber } = await providers();
    await expect(getTranscriber().transcribe(clip, "audio/webm", [])).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("can be turned off", async () => {
    vi.stubEnv("MISTRAL_STT_DIARIZE", "0");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: "I'm at Bérault.", language: "en" })));
    vi.stubGlobal("fetch", fetchMock);
    const { getTranscriber } = await providers();
    await getTranscriber().transcribe(clip, "audio/webm", []);
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(form.get("diarize")).toBeNull();
  });
});
