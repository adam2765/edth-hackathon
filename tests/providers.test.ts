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
