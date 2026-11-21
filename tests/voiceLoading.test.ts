import { describe, expect, it } from "vitest";
import { loadingLabel } from "../lib/tts/ukrainianVoice";

describe("what the map shows while the Ukrainian voice loads [193]", () => {
  const MB = 1024 * 1024;

  it("counts the megabytes of a download", () => {
    expect(loadingLabel({ phase: "download", from: "site", loaded: 34.6 * MB, total: 77 * MB })).toBe("Завантажую голос: 34 з 77 МБ");
  });

  it("names each other step, and shows no count when the voice comes from this browser's cache", () => {
    expect(loadingLabel({ phase: "runtime" })).toBe("Завантажую голос…");
    expect(loadingLabel({ phase: "download", from: "cache", loaded: 0, total: 77 * MB })).toBe("Завантажую голос…");
    expect(loadingLabel({ phase: "verify" })).toBe("Перевіряю голос…");
    expect(loadingLabel({ phase: "start" })).toBe("Запускаю голос…");
  });
});
