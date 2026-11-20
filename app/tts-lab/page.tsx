"use client";

import { useState } from "react";
import reference from "@/lib/tts/piperReference.json";
import { prepareUkrainian, toIds } from "@/lib/tts/ukrainianText";
import { ukrainianVoice, type LoadProgress, type Speaker, type Synthesis } from "@/lib/tts/ukrainianVoice";
import voice from "@/lib/tts/voiceManifest.json";
import styles from "./lab.module.css";

const SAMPLES = [
  "Яка станція: Хрещатик чи Майдан Незалежності?",
  "Золоті ворота (театр) чи Золоті ворота (станція метро)?",
  "Не вдалося визначити місце. Назвіть вулицю або орієнтир.",
];

const SOURCE_NAME = { cache: "this browser's cache", site: "this site", huggingface: "Hugging Face" } as const;
const MB = 1_000_000;

type Load =
  | { state: "idle" }
  | { state: "loading"; progress: LoadProgress }
  | { state: "ready"; seconds: number }
  | { state: "failed"; message: string };
type Check = { text: string; pass: boolean; detail: string };

function loadingText(p: LoadProgress): string {
  if (p.phase === "runtime") return "Loading the speech runtime…";
  if (p.phase === "download") return `Downloading the voice from ${SOURCE_NAME[p.from]}: ${(p.loaded / MB).toFixed(0)} of ${(p.total / MB).toFixed(0)} MB`;
  if (p.phase === "verify") return "Checking the download…";
  return "Starting the voice…";
}

export default function TtsLab() {
  const [load, setLoad] = useState<Load>({ state: "idle" });
  const [text, setText] = useState(SAMPLES[0]);
  const [speaker, setSpeaker] = useState<Speaker>(voice.defaultSpeaker as Speaker);
  const [keepStress, setKeepStress] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Synthesis | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);

  const ready = load.state === "ready";
  const { sentences, unsupported } = prepareUkrainian(text, { keepStress });

  async function loadVoice() {
    ukrainianVoice.unlock();
    const started = performance.now();
    setLoad({ state: "loading", progress: { phase: "runtime" } });
    try {
      await ukrainianVoice.load((progress) => setLoad({ state: "loading", progress }));
      setLoad({ state: "ready", seconds: (performance.now() - started) / 1000 });
    } catch (err) {
      setLoad({ state: "failed", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function speak() {
    ukrainianVoice.unlock();
    setBusy(true);
    setProblem(null);
    try {
      // The same call the app would make: false means "use the system voice instead".
      const played = await ukrainianVoice.speak(text, { speaker, keepStress });
      if (played) setResult(ukrainianVoice.last);
      else setProblem("The voice declined this text, so the app would fall back to the system voice.");
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Same ids, same speaker, no randomness: the browser must produce what Piper produced.
  async function selfCheck() {
    setBusy(true);
    const out: Check[] = [];
    try {
      for (const c of reference.cases) {
        const ids = toIds(prepareUkrainian(c.text).sentences[0]);
        const sameIds = ids.length === c.ids.length && ids.every((id, i) => id === c.ids[i]);
        const audio = await ukrainianVoice.run(ids, voice.speakers[reference.speaker as Speaker], 0, 0);
        let sum = 0;
        for (let i = 0; i < audio.length; i++) sum += audio[i] * audio[i];
        const rms = Math.sqrt(sum / audio.length);
        const pass = sameIds && audio.length === c.samples && Math.abs(rms - c.rms) / c.rms < 0.02;
        out.push({ text: c.text, pass, detail: `${audio.length} samples (Piper ${c.samples}), loudness ${rms.toFixed(4)} (Piper ${c.rms.toFixed(4)})` });
      }
    } catch (err) {
      out.push({ text: "Self-check stopped", pass: false, detail: err instanceof Error ? err.message : String(err) });
    }
    setChecks(out);
    setBusy(false);
  }

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.title}>Ukrainian voice lab</h1>
        <p className={styles.lead}>
          The Piper voice {voice.name} ({voice.license}) running in this browser with onnxruntime-web. Nothing you type leaves
          the device.
        </p>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Voice</h2>
          {load.state === "idle" && <p className={styles.status}>Not loaded. The first load downloads about 77 MB; after that it comes from this browser&apos;s cache.</p>}
          {load.state === "loading" && (
            <>
              <p className={styles.status}>{loadingText(load.progress)}</p>
              {load.progress.phase === "download" && (
                <div className={styles.bar}>
                  <div className={styles.barFill} style={{ width: `${(100 * load.progress.loaded) / load.progress.total}%` }} />
                </div>
              )}
            </>
          )}
          {load.state === "ready" && (
            <p className={`${styles.status} ${styles.ok}`}>
              Ready. Loaded from {SOURCE_NAME[ukrainianVoice.source ?? "site"]} in {load.seconds.toFixed(1)} s.
            </p>
          )}
          {load.state === "failed" && <p className={`${styles.status} ${styles.bad}`}>{load.message}</p>}
          <div className={styles.row}>
            <button className={`${styles.button} ${styles.primary}`} onClick={loadVoice} disabled={ready || load.state === "loading"}>
              Load voice
            </button>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Say something</h2>
          <textarea className={styles.text} lang="uk" value={text} onChange={(e) => setText(e.target.value)} aria-label="Text to speak" />
          <div className={styles.row}>
            {SAMPLES.map((s, i) => (
              <button key={s} className={styles.button} onClick={() => setText(s)}>
                Sample {i + 1}
              </button>
            ))}
          </div>
          <div className={styles.row}>
            <label className={styles.label}>
              Speaker
              <select className={styles.select} value={speaker} onChange={(e) => setSpeaker(e.target.value as Speaker)}>
                {Object.keys(voice.speakers).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className={styles.label}>
              <input type="checkbox" checked={keepStress} onChange={(e) => setKeepStress(e.target.checked)} />
              Keep stress marks
            </label>
          </div>
          {unsupported.length > 0 && (
            <p className={`${styles.status} ${styles.warn}`}>
              The voice cannot say: {unsupported.join(" ")}. The app would use the system voice for this text.
            </p>
          )}
          {sentences.length === 0 && <p className={`${styles.status} ${styles.warn}`}>There is nothing to say yet.</p>}
          <div className={styles.row}>
            <button className={`${styles.button} ${styles.primary}`} onClick={speak} disabled={!ready || busy || sentences.length === 0}>
              Speak
            </button>
            <button className={styles.button} onClick={() => ukrainianVoice.stop()} disabled={!ready}>
              Stop
            </button>
          </div>
          {result && (
            <p className={styles.status}>
              {result.seconds.toFixed(1)} s of speech made in {Math.round(result.synthMs)} ms ({(result.seconds / (result.synthMs / 1000)).toFixed(1)}× real time).
            </p>
          )}
          {problem && <p className={`${styles.status} ${styles.bad}`}>{problem}</p>}
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Self-check against Piper</h2>
          <p className={styles.lead}>Runs {reference.cases.length} reference sentences with randomness off and compares the result with Piper&apos;s own output.</p>
          <div className={styles.row}>
            <button className={styles.button} onClick={selfCheck} disabled={!ready || busy}>
              Run self-check
            </button>
          </div>
          {checks && (
            <ul className={styles.checks}>
              {checks.map((c) => (
                <li key={c.text} className={c.pass ? styles.ok : styles.bad}>
                  {c.pass ? "Match" : "Mismatch"}: “{c.text}”. {c.detail}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
