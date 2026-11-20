import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { useKeepAwake } from "expo-keep-awake";
import { StatusBar } from "expo-status-bar";
import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { SCENARIOS } from "./scenarios";
import { MAX_CLIP_MS, MIN_CLIP_MS, SPEECH_RECORDING, scenarioClipUri } from "./src/sources";
import { speak, stopSpeaking } from "./src/speech";
import { describePlacement, positionAfter, sendUtterance } from "./src/transport";
import type { AreaId, Candidate, Lang, Position, ReportReply, Scenario, ScenarioStep, Utterance } from "./src/types";

const DEFAULT_SERVER = process.env.EXPO_PUBLIC_SERVER_URL ?? "https://edth-hackathon.vercel.app";
const AREAS: { id: AreaId; label: string }[] = [
  { id: "vincennes", label: "Vincennes" },
  { id: "kyiv", label: "Київ" },
];

type Busy = "idle" | "starting" | "recording" | "sending" | "scenario";

interface Entry {
  id: string;
  ts: number;
  callsign: string;
  source: Utterance["source"];
  /** What the scenario clip says, for comparison with the transcript. */
  scripted?: string;
  transcript: string;
  outcome: string;
  status: "resolved" | "ambiguous" | "unresolved" | "error";
  timings?: string;
  question?: string;
  candidates?: Candidate[];
  /** True while a question is waiting for a choice. */
  pending?: boolean;
}

type StepResult = { state: "running" | "pass" | "fail"; note: string };

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function langOf(reply: ReportReply, area: AreaId): Lang {
  const l = reply.intent?.language;
  return l === "fr" || l === "uk" ? l : !reply.intent && area === "kyiv" ? "uk" : "en";
}

/** Did the coordinator answer what the scenario step expected? */
function evaluate(step: ScenarioStep, reply: ReportReply, chosen?: Candidate): { pass: boolean; note: string } {
  const r = reply.resolution;
  if (r.status !== step.expect.status) return { pass: false, note: `expected ${step.expect.status}, got ${r.status}` };
  if (step.expect.feature_id && r.evidence.feature_id !== step.expect.feature_id) {
    return { pass: false, note: `expected ${step.expect.feature_id}, got ${r.evidence.feature_id ?? "none"}` };
  }
  if (step.expect.heading_to && r.heading_to?.id !== step.expect.heading_to) {
    return { pass: false, note: `expected heading to ${step.expect.heading_to}, got ${r.heading_to?.id ?? "none"}` };
  }
  if (step.choose && !chosen) return { pass: false, note: `choice ${step.choose} was not offered` };
  return { pass: true, note: chosen ? `asked, chose ${chosen.name}` : r.status };
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Transmitter />
    </SafeAreaProvider>
  );
}

function Transmitter() {
  useKeepAwake();
  const [callsign, setCallsign] = useState("ALPHA 1");
  const [area, setArea] = useState<AreaId>("vincennes");
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [busy, setBusy] = useState<Busy>("idle");
  const [status, setStatus] = useState("Hold the button and say where you are, or play a scenario.");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [position, setPosition] = useState<Position | null>(null);
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0]?.id ?? "");
  const [stepResults, setStepResults] = useState<Record<string, StepResult>>({});
  const [realTime, setRealTime] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);

  const positionRef = useRef<Position | null>(null);
  const seqRef = useRef(0);
  const busyRef = useRef<Busy>("idle");
  const recordStartRef = useRef(0);
  const releasedRef = useRef(false);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelScenarioRef = useRef(false);
  const recorder = useAudioRecorder(SPEECH_RECORDING);

  const setBusyBoth = (b: Busy) => {
    busyRef.current = b;
    setBusy(b);
  };
  const setPositionBoth = (p: Position | null) => {
    positionRef.current = p;
    setPosition(p);
  };
  const patchEntry = (id: string, patch: Partial<Entry>) => setEntries((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  /**
   * The one path every utterance takes, whatever produced it: send to the coordinator,
   * apply the reply, speak a question back. Returns the reply and the log entry id.
   */
  const handleUtterance = useCallback(
    async (u: Utterance, opts: { area: AreaId; scripted?: string; quiet?: boolean }): Promise<{ reply: ReportReply; entryId: string } | null> => {
      const entryId = `${u.callsign}-${u.seq}-${u.endedAt}`;
      try {
        const { reply, roundTripMs } = await sendUtterance(u, { serverUrl, area: opts.area, session: "demo", lastPosition: positionRef.current });
        const res = reply.resolution;
        const lang = langOf(reply, opts.area);
        const t = reply.timings_ms;
        const timings = `${t.stt ? `STT ${t.stt} · ` : ""}extract ${t.extract} · server ${t.total} · round trip ${roundTripMs} ms`;
        const base = { id: entryId, ts: u.endedAt, callsign: u.callsign, source: u.source, scripted: opts.scripted, transcript: reply.transcript || "(no words heard)", timings };
        if (res.status === "resolved") {
          const name = res.candidates.find((c) => c.id === res.evidence.feature_id)?.name ?? "position";
          const pl = { pin: res.pin, radius_m: res.radius_m, heading_to: res.heading_to, estimated: res.estimated };
          const outcome = describePlacement(pl, name, positionRef.current);
          setPositionBoth(positionAfter(positionRef.current, pl, name, Date.now()));
          setEntries((es) => [{ ...base, outcome, status: "resolved" }, ...es]);
          setStatus(outcome);
        } else if (res.status === "ambiguous") {
          setEntries((es) => [{ ...base, outcome: "Asked back", status: "ambiguous", question: res.question, candidates: res.candidates, pending: true }, ...es]);
          setStatus(res.question ?? "Which one did you mean?");
          if (res.question && !opts.quiet) await speak(res.question, lang);
        } else {
          setEntries((es) => [{ ...base, outcome: res.question ?? "Could not place that.", status: "unresolved" }, ...es]);
          setStatus(res.question ?? "Could not place that.");
          if (res.question && !opts.quiet) await speak(res.question, lang);
        }
        return { reply, entryId };
      } catch (e) {
        const msg = e instanceof Error ? (e.name === "AbortError" ? "The coordinator did not answer in time." : e.message) : "Sending failed.";
        setEntries((es) => [{ id: entryId, ts: u.endedAt, callsign: u.callsign, source: u.source, scripted: opts.scripted, transcript: "", outcome: msg, status: "error" }, ...es]);
        setStatus(msg);
        return null;
      }
    },
    [serverUrl],
  );

  const choose = useCallback((entryId: string, c: Candidate) => {
    stopSpeaking();
    const outcome = describePlacement(c.placement, c.name, positionRef.current);
    setPositionBoth(positionAfter(positionRef.current, c.placement, c.name, Date.now()));
    patchEntry(entryId, { pending: false, outcome: `Chose ${c.name}. ${outcome}` });
    setStatus(outcome);
  }, []);

  // ---------- source: scenario clips ----------
  const runStep = useCallback(
    async (sc: Scenario, step: ScenarioStep, manual = false): Promise<boolean> => {
      setStepResults((r) => ({ ...r, [`${sc.id}/${step.id}`]: { state: "running", note: "sending" } }));
      const audioUri = await scenarioClipUri(step);
      const now = Date.now();
      const u: Utterance = { seq: ++seqRef.current, callsign: step.callsign, source: "scenario", audioUri, mime: "audio/mp4", startedAt: now, endedAt: now, scenarioStepId: step.id };
      const out = await handleUtterance(u, { area: sc.area, scripted: step.text, quiet: !speakReplies });
      if (!out) {
        setStepResults((r) => ({ ...r, [`${sc.id}/${step.id}`]: { state: "fail", note: "no answer from the coordinator" } }));
        return false;
      }
      let chosen: Candidate | undefined;
      if (out.reply.resolution.status === "ambiguous" && step.choose) {
        chosen = out.reply.resolution.candidates.find((c) => c.id === step.choose);
        // Sent on its own, the question is left open for a person to answer.
        if (chosen && !manual) choose(out.entryId, chosen);
      }
      const verdict = evaluate(step, out.reply, chosen);
      if (manual && verdict.pass && chosen) verdict.note = "asked: answer below";
      setStepResults((r) => ({ ...r, [`${sc.id}/${step.id}`]: { state: verdict.pass ? "pass" : "fail", note: verdict.note } }));
      return verdict.pass;
    },
    [handleUtterance, choose, speakReplies],
  );

  const playScenario = useCallback(async () => {
    const sc = SCENARIOS.find((s) => s.id === scenarioId);
    if (!sc || busyRef.current !== "idle") return;
    setBusyBoth("scenario");
    cancelScenarioRef.current = false;
    setArea(sc.area);
    setPositionBoth(null); // a scenario starts from a clean slate, like a fresh page
    setStepResults((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith(`${sc.id}/`))));
    const started = Date.now();
    let passed = 0;
    for (const step of sc.steps) {
      if (cancelScenarioRef.current) break;
      if (realTime) {
        const wait = started + step.t * 1000 - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      setStatus(`${sc.title}: ${step.id} “${step.text}”`);
      if (await runStep(sc, step)) passed++;
    }
    setStatus(cancelScenarioRef.current ? "Scenario stopped." : `${sc.title}: ${passed} of ${sc.steps.length} steps as expected.`);
    setBusyBoth("idle");
  }, [scenarioId, realTime, runStep]);

  /** Sends one step on its own, from wherever the unit is now, and leaves any question open. */
  const sendOneStep = useCallback(
    async (sc: Scenario, step: ScenarioStep) => {
      if (busyRef.current !== "idle") return;
      setBusyBoth("scenario");
      setArea(sc.area);
      setStatus(`Sending “${step.text}”`);
      await runStep(sc, step, true);
      setBusyBoth("idle");
    },
    [runStep],
  );

  // ---------- source: microphone, hold to talk ----------
  const stopAndSend = useCallback(async () => {
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    if (busyRef.current !== "recording") return;
    setBusyBoth("sending");
    const endedAt = Date.now();
    try {
      await recorder.stop();
      // Hand the audio session back so the spoken question uses the loudspeaker, not the earpiece.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!uri || endedAt - recordStartRef.current < MIN_CLIP_MS) {
        setStatus("Too short. Hold the button while you speak.");
        return;
      }
      setStatus("Sending…");
      const u: Utterance = { seq: ++seqRef.current, callsign: callsign.trim() || "UNKNOWN", source: "mic", audioUri: uri, mime: "audio/mp4", startedAt: recordStartRef.current, endedAt };
      await handleUtterance(u, { area, quiet: !speakReplies });
    } catch (e) {
      setStatus(e instanceof Error ? `Recording failed: ${e.message}` : "Recording failed.");
    } finally {
      setBusyBoth("idle");
    }
  }, [recorder, callsign, area, handleUtterance, speakReplies]);

  const onPressIn = useCallback(async () => {
    if (busyRef.current !== "idle") return;
    releasedRef.current = false;
    setBusyBoth("starting");
    stopSpeaking(); // never record our own voice prompt
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setStatus("Microphone access was refused. Allow it in Settings, or use a scenario.");
        setBusyBoth("idle");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordStartRef.current = Date.now();
      setBusyBoth("recording");
      setStatus("Listening… release to send.");
      maxTimerRef.current = setTimeout(() => {
        setStatus("15 s limit reached, sending.");
        stopAndSend();
      }, MAX_CLIP_MS);
      if (releasedRef.current) stopAndSend(); // released while the microphone was still opening
    } catch (e) {
      setStatus(e instanceof Error ? `Could not open the microphone: ${e.message}` : "Could not open the microphone.");
      setBusyBoth("idle");
    }
  }, [recorder, stopAndSend]);

  const onPressOut = useCallback(() => {
    releasedRef.current = true;
    stopAndSend();
  }, [stopAndSend]);

  const reset = () => {
    stopSpeaking();
    cancelScenarioRef.current = true;
    setEntries([]);
    setStepResults({});
    setPositionBoth(null);
    seqRef.current = 0;
    setStatus("Cleared.");
  };

  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  const talkLabel = busy === "starting" ? "Opening mic…" : busy === "recording" ? "Release to send" : busy === "sending" ? "Working…" : busy === "scenario" ? "Scenario running" : "Hold to talk";

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.row}>
          <Text style={styles.title}>Transmitter</Text>
          <TextInput
            style={styles.callsign}
            value={callsign}
            onChangeText={(t) => setCallsign(t.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Call sign"
            placeholder="CALL SIGN"
            placeholderTextColor="#5b6b7c"
          />
        </View>
        <View style={styles.row}>
          {AREAS.map((a) => (
            <Pressable key={a.id} onPress={() => busy === "idle" && setArea(a.id)} style={[styles.chip, area === a.id && styles.chipOn]} accessibilityLabel={`Area ${a.label}`}>
              <Text style={[styles.chipText, area === a.id && styles.chipTextOn]}>{a.label}</Text>
            </Pressable>
          ))}
          <TextInput
            style={styles.server}
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="Coordinator address"
          />
        </View>
      </View>

      <View style={styles.talkRow}>
        <Pressable
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          disabled={busy === "sending" || busy === "scenario"}
          style={[styles.talk, busy === "recording" && styles.talkRec, (busy === "sending" || busy === "scenario" || busy === "starting") && styles.talkBusy]}
          accessibilityLabel={talkLabel}
        >
          <Text style={styles.talkIcon}>{busy === "recording" ? "●" : "🎙"}</Text>
          <Text style={styles.talkLabel}>{talkLabel}</Text>
        </Pressable>
        <View style={styles.talkSide}>
          <Text style={styles.status}>{status}</Text>
          <Text style={styles.muted}>
            {position ? `${position.estimated ? "≈ " : ""}${position.label} · ±${position.radius_m} m · ${fmtTime(position.ts)}` : "No position yet"}
          </Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Scenario (no microphone)</Text>
          <View style={styles.rowWrap}>
            {SCENARIOS.map((s) => (
              <Pressable key={s.id} onPress={() => busy === "idle" && setScenarioId(s.id)} style={[styles.chip, scenarioId === s.id && styles.chipOn]} accessibilityLabel={`Scenario ${s.title}`}>
                <Text style={[styles.chipText, scenarioId === s.id && styles.chipTextOn]}>{s.title}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <Pressable onPress={busy === "scenario" ? () => (cancelScenarioRef.current = true) : playScenario} disabled={busy !== "idle" && busy !== "scenario"} style={[styles.button, busy !== "idle" && busy !== "scenario" && styles.buttonOff]} accessibilityLabel="Play scenario">
              <Text style={styles.buttonText}>{busy === "scenario" ? "Stop" : "Play scenario"}</Text>
            </Pressable>
            <View style={styles.toggle}>
              <Switch value={realTime} onValueChange={setRealTime} />
              <Text style={styles.muted}>Real timing</Text>
            </View>
            <View style={styles.toggle}>
              <Switch value={speakReplies} onValueChange={setSpeakReplies} />
              <Text style={styles.muted}>Speak</Text>
            </View>
          </View>
          {scenario?.steps.map((step) => {
            const r = stepResults[`${scenario.id}/${step.id}`];
            return (
              <Pressable key={step.id} style={styles.step} onPress={() => sendOneStep(scenario, step)} accessibilityLabel={`Send step ${step.id}`}>
                <Text style={[styles.stepMark, r?.state === "pass" && styles.ok, r?.state === "fail" && styles.bad]}>{r?.state === "pass" ? "✓" : r?.state === "fail" ? "✗" : r?.state === "running" ? "…" : "▶"}</Text>
                <View style={styles.flex}>
                  <Text style={styles.stepText}>
                    {step.callsign}: “{step.text}”
                  </Text>
                  <Text style={styles.muted}>{r ? r.note : `expects ${step.expect.status}${step.choose ? ", then a choice" : ""} · tap to send alone`}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Sent ({entries.length})</Text>
          {entries.length > 0 && (
            <Pressable onPress={reset} accessibilityLabel="Clear">
              <Text style={styles.link}>Clear</Text>
            </Pressable>
          )}
        </View>
        {entries.map((e) => (
          <View key={e.id} style={[styles.entry, e.status === "error" && styles.entryError]}>
            <View style={styles.rowBetween}>
              <Text style={styles.entryHead}>
                {fmtTime(e.ts)} · {e.callsign}
              </Text>
              <Text style={styles.muted}>{e.source}</Text>
            </View>
            {e.transcript ? <Text style={styles.entryText}>“{e.transcript}”</Text> : null}
            <Text style={styles.entryOutcome}>{e.outcome}</Text>
            {e.question ? <Text style={styles.entryQuestion}>{e.question}</Text> : null}
            {e.pending &&
              e.candidates?.map((c, i) => (
                <Pressable key={c.id} onPress={() => choose(e.id, c)} style={styles.choice} accessibilityLabel={`Choice ${i + 1}: ${c.name}`}>
                  <Text style={styles.choiceN}>{i + 1}</Text>
                  <View style={styles.flex}>
                    <Text style={styles.choiceName}>{c.name}</Text>
                    <Text style={styles.muted}>
                      {c.category.replace("_", " ")} · {c.distance_m < 1000 ? `${c.distance_m} m` : `${(c.distance_m / 1000).toFixed(1)} km`}
                    </Text>
                  </View>
                </Pressable>
              ))}
            {e.timings ? <Text style={styles.entryTimings}>{e.timings}</Text> : null}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const C = { bg: "#0f1720", panel: "#16212c", panel2: "#1e2c3a", line: "#2a3a4b", text: "#e8eef4", muted: "#93a4b5", accent: "#ff6b2c", blue: "#2c9cff", ok: "#3ccf7a", warn: "#ffc940", bad: "#ff5a5a" };

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: C.text, fontSize: 20, fontWeight: "700", flex: 1 },
  callsign: { color: C.text, backgroundColor: C.panel2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, fontWeight: "700", minWidth: 120, textAlign: "center" },
  server: { flex: 1, color: C.muted, backgroundColor: C.panel, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 12 },
  chip: { backgroundColor: C.panel2, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: C.accent },
  chipText: { color: C.muted, fontWeight: "600" },
  chipTextOn: { color: "#fff" },
  talkRow: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  talk: { width: 116, height: 116, borderRadius: 58, backgroundColor: C.accent, alignItems: "center", justifyContent: "center", gap: 2 },
  talkRec: { backgroundColor: C.bad },
  talkBusy: { backgroundColor: "#5b6b7c" },
  talkIcon: { fontSize: 28, color: "#fff" },
  talkLabel: { color: "#fff", fontWeight: "700", fontSize: 12, textAlign: "center", paddingHorizontal: 8 },
  talkSide: { flex: 1, gap: 6 },
  status: { color: C.text, fontSize: 15, lineHeight: 20 },
  muted: { color: C.muted, fontSize: 12 },
  scroll: { flex: 1 },
  scrollBody: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  card: { backgroundColor: C.panel, borderRadius: 14, padding: 12, gap: 10 },
  cardTitle: { color: C.text, fontWeight: "700", fontSize: 15 },
  button: { backgroundColor: C.blue, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: "#fff", fontWeight: "700" },
  toggle: { flexDirection: "row", alignItems: "center", gap: 4 },
  step: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  stepMark: { color: C.muted, fontSize: 16, width: 18, textAlign: "center", fontWeight: "800" },
  stepText: { color: C.text, fontSize: 14 },
  ok: { color: C.ok },
  bad: { color: C.bad },
  link: { color: C.blue, fontWeight: "600" },
  entry: { backgroundColor: C.panel, borderRadius: 12, padding: 10, gap: 4 },
  entryError: { borderWidth: 1, borderColor: C.bad },
  entryHead: { color: C.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
  entryText: { color: C.text, fontSize: 15 },
  entryOutcome: { color: C.text, fontWeight: "600" },
  entryQuestion: { color: C.warn, fontWeight: "600" },
  entryTimings: { color: C.muted, fontSize: 11 },
  choice: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.panel2, borderRadius: 10, padding: 10 },
  choiceN: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.warn, color: "#1b1b1b", fontWeight: "800", textAlign: "center", lineHeight: 26, overflow: "hidden" },
  choiceName: { color: C.text, fontWeight: "600" },
});
