import { Ionicons } from "@expo/vector-icons";
import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import Constants from "expo-constants";
import { useKeepAwake } from "expo-keep-awake";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState, type ComponentRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { SCENARIOS } from "./scenarios";
import { MAX_CLIP_MS, MIN_CLIP_MS, SPEECH_RECORDING, clipUri, playClipAloud } from "./src/sources";
import { speak, stopSpeaking } from "./src/speech";
import { discoverHosts, serverOrigin, type FoundHost } from "./src/hosts";
import { CoordinatorError, callsignKey, joinMission, loadSaved, positionFromJoin, writeSaved, type Saved } from "./src/mission";
import { describePlacement, positionAfter, sendAnswer, sendUtterance } from "./src/transport";
import type { AreaId, Candidate, Lang, MissionListReply, Position, ReportReply, Scenario, ScenarioStep, Utterance } from "./src/types";
import { Button, Segmented } from "./src/ui/controls";
import { LogList, QuestionCard } from "./src/ui/LogList";
import { fmtTime, type Entry, type Reach, type StepResult } from "./src/ui/model";
import { ScenarioCard } from "./src/ui/ScenarioCard";
import { SetupSheet } from "./src/ui/SetupSheet";
import { TalkButton } from "./src/ui/TalkButton";
import { TOUCH, color, radius, space, tabular, type } from "./src/ui/theme";

/** The port the coordinator (the web app in the folder above) runs on with `npm run dev -- -p 3117`. */
const COORDINATOR_PORT = 3117;

/**
 * The coordinator on the computer this app was loaded from. A development build fetches its code
 * from that computer's dev server, so its address is known, and the coordinator runs beside it.
 * In the simulator this is localhost; on a phone it is the computer's address on the shared network.
 */
function coordinatorOnThisComputer(): string | null {
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return host ? `http://${host}:${COORDINATOR_PORT}` : null;
}

const LOCAL_COORDINATOR = coordinatorOnThisComputer();
const DEFAULT_SERVER = process.env.EXPO_PUBLIC_SERVER_URL ?? LOCAL_COORDINATOR ?? "http://127.0.0.1:3117";
/** Said on joining a mission: the first report that names a place replaces the start point. */
const CHECK_IN: Record<Lang, string> = {
  en: "Check in: say where you are.",
  fr: "Dites où vous êtes.",
  uk: "Скажіть, де ви зараз.",
};
const AREAS: { id: AreaId; label: string }[] = [
  { id: "vincennes", label: "Vincennes" },
  { id: "kyiv", label: "Київ" },
  { id: "izium", label: "Ізюм" },
];
/** The language the speaker uses (decision 106). Speech-to-text listens for it and questions come back in it. */
const LANGUAGES: { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
  { id: "uk", label: "Українська" },
];

type Busy = "idle" | "starting" | "recording" | "sending" | "scenario";

/** The language the question was written in: the pinned one, unless the coordinator ignored it. */
function langOf(reply: ReportReply, pinned: Lang): Lang {
  const l = reply.intent?.language;
  return l === "en" || l === "fr" || l === "uk" ? l : pinned;
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
  // Who the report was about: a track, where the step expects one, and otherwise the speaker.
  const want = step.expect.track;
  if (want && !r.track) return { pass: false, note: "expected a report about a track, got one about the speaker" };
  if (!want && r.track && r.status !== "unresolved") return { pass: false, note: "read as a report about a track" };
  if (want && r.track) {
    // Numbers count from 1 in a new mission, so a script with tracks is run in one.
    if (want.n !== undefined && r.track.n !== want.n) return { pass: false, note: `expected Track ${want.n}, got ${r.track.n == null ? "no number (not in a mission)" : `Track ${r.track.n}`}` };
    if (want.affiliation !== undefined && r.track.affiliation !== want.affiliation) return { pass: false, note: `expected ${want.affiliation ?? "no word for whose it is"}, got ${r.track.affiliation ?? "none"}` };
    if (want.kind !== undefined && r.track.kind !== want.kind) return { pass: false, note: `expected ${want.kind}, got ${r.track.kind ?? "none"}` };
  }
  if (step.choose && !chosen) return { pass: false, note: `choice ${step.choose} was not offered` };
  const about = r.track?.n != null ? `Track ${r.track.n}, ` : "";
  return { pass: true, note: chosen ? `${about}asked, chose ${chosen.name}` : `${about}${r.status}` };
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
  // The phone's own id and the mission it joined, kept between launches.
  const [saved, setSaved] = useState<Saved>(() => loadSaved());
  const [callsign, setCallsign] = useState(() => saved.joined?.callsign ?? "ALPHA 1");
  const [area, setArea] = useState<AreaId>("vincennes");
  const [language, setLanguage] = useState<Lang>("en");
  const [serverUrl, setServerUrl] = useState(() => process.env.EXPO_PUBLIC_SERVER_URL ?? saved.server ?? saved.joined?.server ?? DEFAULT_SERVER);
  const [hosts, setHosts] = useState<FoundHost[]>([]);
  const [reach, setReach] = useState<Reach>("checking");
  const [connectedHost, setConnectedHost] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [tab, setTab] = useState<"scenarios" | "sent">("sent");
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const [busy, setBusy] = useState<Busy>("idle");
  const [status, setStatus] = useState("Hold the button and say where you are.");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [position, setPosition] = useState<Position | null>(null);
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0]?.id ?? "");
  const [stepResults, setStepResults] = useState<Record<string, StepResult>>({});
  const [realTime, setRealTime] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [playClips, setPlayClips] = useState(false);
  const [developer, setDeveloper] = useState(false);
  useEffect(() => { writeSaved({ ...saved, server: serverUrl }); }, [saved, serverUrl]);
  /** The coordinator's missions; null when it has none to offer (an older deployment). */
  const [missionList, setMissionList] = useState<MissionListReply | null>(null);
  const [joined, setJoined] = useState<{ code: string; name: string; area: AreaId; callsign: string } | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  /** In a mission as the call sign shown. A changed call sign has to join again. */
  const joinedNow = connectedHost === serverUrl && joined && joined.callsign === callsignKey(callsign) ? joined : null;
  const needsConnect = connectedHost !== serverUrl;
  /** A coordinator that keeps missions takes reports only from a phone that joined one. */
  const newestMission = missionList?.missions.filter((m) => m.ended == null).reduce<(typeof missionList.missions)[number] | null>((newest, m) => !newest || m.opened > newest.opened || (m.opened === newest.opened && m.code > newest.code) ? m : newest, null) ?? null;
  const needsJoin = !needsConnect && reach === "ok" && !!missionList?.stored && (!joinedNow || (busy === "idle" && joinedNow.code !== newestMission?.code));
  const autoJoinAttempt = useRef({ key: "", at: 0 });
  /** In a mission, its area; the coordinator uses it whatever the phone sends. */
  const effectiveArea: AreaId = joinedNow?.area ?? area;
  const scenarios = joinedNow ? SCENARIOS.filter((s) => s.area === joinedNow.area) : SCENARIOS;
  const effectiveScenarioId = scenarios.some((s) => s.id === scenarioId) ? scenarioId : (scenarios[0]?.id ?? "");

  const positionRef = useRef<Position | null>(null);
  /** The mission's code, for the send path; null with no mission. */
  const sessionRef = useRef<string | null>(null);
  /** The coordinator's report id for each question asked, by log entry, to send back with the answer. */
  const reportIdsRef = useRef(new Map<string, string>());
  const seqRef = useRef(0);
  const busyRef = useRef<Busy>("idle");
  const recordStartRef = useRef(0);
  const releasedRef = useRef(false);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelScenarioRef = useRef(false);
  const recorder = useAudioRecorder(SPEECH_RECORDING);

  // Probe the USB/Metro host and remembered hosts, then their LAN discovery lists.
  useEffect(() => {
    let cancelled = false;
    let scanning = false;
    const check = async () => {
      if (scanning) return;
      scanning = true;
      try {
        const found = await discoverHosts([serverUrl, LOCAL_COORDINATOR, process.env.EXPO_PUBLIC_SERVER_URL, saved.server, "http://127.0.0.1:3117"]);
        if (cancelled) return;
        setHosts(found);
        const selected = found.find((host) => host.url === serverOrigin(serverUrl));
        setReach(selected ? (selected.ready ? "ok" : "checking") : "unreachable");
        setMissionList(selected?.missions ?? null);
      } finally { scanning = false; }
    };
    void check();
    const interval = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [serverUrl, saved.server]);

  // Sound should come out of the loudspeaker even when the phone's ring switch is on silent,
  // as it would from a radio.
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
  }, []);

  useEffect(() => {
    console.log("[coordinator]", JSON.stringify({ address: serverUrl, reach }));
  }, [serverUrl, reach]);

  const setBusyBoth = (b: Busy) => {
    busyRef.current = b;
    setBusy(b);
  };
  const setPositionBoth = (p: Position | null) => {
    positionRef.current = p;
    setPosition(p);
  };
  const patchEntry = (id: string, patch: Partial<Entry>) => setEntries((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  // ---------- missions ----------
  const setJoinedBoth = (j: typeof joined) => {
    sessionRef.current = j?.code ?? null;
    setJoined(j);
  };

  /** Out of the mission: it ended, or the person left. The phone forgets it and offers the open ones. */
  const leaveMission = useCallback((why: string) => {
    sessionRef.current = null;
    setJoined(null);
    setPositionBoth(null);
    setSaved((s) => {
      const next = { device: s.device, server: s.server };
      writeSaved(next);
      return next;
    });
    setStatus(why);
  }, []);

  const join = useCallback(
    async (code: string, cs: string) => {
      setJoinBusy(true);
      setJoinError(null);
      try {
        const r = await joinMission(serverUrl, code, callsignKey(cs), saved.device);
        if (sessionRef.current !== code) {
          reportIdsRef.current.clear();
          setEntries((entries) => entries.map((entry) => ({ ...entry, pending: false })));
        }
        setJoinedBoth({ code, name: r.mission.name, area: r.mission.area, callsign: r.callsign });
        setArea(r.mission.area);
        setCallsign(r.callsign);
        setPositionBoth(positionFromJoin(r));
        const next = { device: saved.device, server: serverUrl, joined: { server: serverUrl, code, callsign: r.callsign } };
        setSaved(next);
        writeSaved(next);
        if (r.rejoined) {
          setStatus(`Back in ${r.mission.name}.`);
        } else {
          setStatus(`Joined ${r.mission.name}. ${CHECK_IN[language]}`);
          if (speakReplies) await speak(CHECK_IN[language], language);
        }
      } catch (e) {
        const msg = e instanceof Error ? (e.name === "AbortError" ? "The coordinator did not answer in time." : e.message) : "Joining failed.";
        setJoinError(msg);
      } finally {
        setJoinBusy(false);
      }
    },
    [serverUrl, saved.device, language, speakReplies],
  );

  // Follow the newest open mission automatically, between reports only.
  useEffect(() => {
    if (needsConnect || reach !== "ok" || !missionList?.stored || busy !== "idle" || joinBusy) return;
    if (!newestMission) {
      if (joined) leaveMission("Waiting for the server to start a mission.");
      return;
    }
    if (joinedNow?.code === newestMission.code && joinedNow.callsign === callsignKey(callsign)) return;
    const key = `${serverUrl}:${newestMission.code}:${callsignKey(callsign)}`;
    if (autoJoinAttempt.current.key === key && Date.now() - autoJoinAttempt.current.at < 10_000) return;
    autoJoinAttempt.current = { key, at: Date.now() };
    void join(newestMission.code, callsign);
  }, [needsConnect, reach, missionList, busy, joinBusy, newestMission, joinedNow, joined, callsign, serverUrl, join, leaveMission]);

  /**
   * The one path every utterance takes, whatever produced it: send to the coordinator,
   * apply the reply, speak a question back. Returns the reply and the log entry id.
   */
  const handleUtterance = useCallback(
    async (u: Utterance, opts: { area: AreaId; language: Lang; scripted?: string; quiet?: boolean }): Promise<{ reply: ReportReply; entryId: string; roundTripMs: number } | null> => {
      if (needsConnect || needsJoin || reach !== "ok") { setStatus("Waiting for connection to the newest running mission."); return null; }
      const entryId = `${u.callsign}-${u.seq}-${u.endedAt}`;
      try {
        const { reply, roundTripMs } = await sendUtterance(u, { serverUrl, area: opts.area, language: opts.language, session: sessionRef.current, lastPosition: positionRef.current });
        const res = reply.resolution;
        const lang = langOf(reply, opts.language);
        const t = reply.timings_ms;
        const timings = `${t.stt ? `STT ${t.stt} · ` : ""}extract ${t.extract} · server ${t.total} · round trip ${roundTripMs} ms${reply.clip ? " · clip kept" : ""}`;
        const base = { id: entryId, ts: u.endedAt, callsign: u.callsign, source: u.source, scripted: opts.scripted, transcript: reply.transcript || "(no words heard)", timings };
        if (res.status === "resolved" && res.track) {
          // A report about a track, something this unit saw: this unit does not move. The
          // coordinator numbers the track, and the number is said back so it can be named later.
          const outcome = res.track.say ?? "Track marked.";
          setEntries((es) => [{ ...base, outcome, status: "resolved" }, ...es]);
          setStatus(outcome);
          if (res.track.say && !opts.quiet) await speak(res.track.say, lang);
        } else if (res.status === "resolved") {
          const name = res.candidates.find((c) => c.id === res.evidence.feature_id)?.name ?? "position";
          const pl = { pin: res.pin, radius_m: res.radius_m, heading_to: res.heading_to, estimated: res.estimated };
          const outcome = describePlacement(pl, name, positionRef.current);
          setPositionBoth(positionAfter(positionRef.current, pl, name, Date.now()));
          setEntries((es) => [{ ...base, outcome, status: "resolved" }, ...es]);
          setStatus(outcome);
        } else if (res.status === "ambiguous") {
          if (reply.report_id) reportIdsRef.current.set(entryId, reply.report_id);
          setEntries((es) => [{ ...base, outcome: "Asked back", status: "ambiguous", question: res.question, candidates: res.candidates, pending: true, reportId: reply.report_id, track: res.track?.n ?? null }, ...es]);
          setStatus(res.question ?? "Which one did you mean?");
          if (res.question && !opts.quiet) await speak(res.question, lang);
        } else {
          setEntries((es) => [{ ...base, outcome: res.question ?? "Could not place that.", status: "unresolved" }, ...es]);
          setStatus(res.question ?? "Could not place that.");
          if (res.question && !opts.quiet) await speak(res.question, lang);
        }
        return { reply, entryId, roundTripMs };
      } catch (e) {
        const msg = e instanceof Error ? (e.name === "AbortError" ? "The coordinator did not answer in time." : e.message) : "Sending failed.";
        // In the dev-server log too, so a failure on a phone can be diagnosed from the computer.
        console.log("[send-error]", JSON.stringify({ coordinator: serverUrl, error: msg }));
        // The mission ended (or was deleted) under us: offer the open ones.
        if (e instanceof CoordinatorError && sessionRef.current && (e.ended || e.status === 404)) leaveMission("The mission has ended. Join another one.");
        setEntries((es) => [{ id: entryId, ts: u.endedAt, callsign: u.callsign, source: u.source, scripted: opts.scripted, transcript: "", outcome: msg, status: "error" }, ...es]);
        setStatus(msg);
        return null;
      }
    },
    [serverUrl, leaveMission, needsConnect, needsJoin, reach],
  );

  /** Tells the receiver which choice was tapped. The phone has already applied it, so this only logs a failure. */
  const reportAnswer = useCallback(
    (entryId: string, choice: string | null) => {
      const reportId = reportIdsRef.current.get(entryId);
      const session = sessionRef.current;
      if (!reportId || !session) return; // the coordinator did not save the report (for example, the live site)
      reportIdsRef.current.delete(entryId);
      sendAnswer(serverUrl, session, reportId, choice).catch((e: unknown) => {
        console.log("[answer-error]", JSON.stringify({ coordinator: serverUrl, error: e instanceof Error ? e.message : String(e) }));
      });
    },
    [serverUrl],
  );

  const choose = useCallback(
    (entryId: string, c: Candidate, track?: number | null) => {
      stopSpeaking();
      if (c.track_placement) {
        // The question was about a track: the choice places the track on the shared map, not this unit.
        const outcome = `${track != null ? `Track ${track}` : "Track"} placed at ${c.name} (±${c.track_placement.radius_m ?? 80} m)`;
        patchEntry(entryId, { pending: false, outcome });
        setStatus(outcome);
        reportAnswer(entryId, c.id);
        return;
      }
      const outcome = describePlacement(c.placement, c.name, positionRef.current);
      setPositionBoth(positionAfter(positionRef.current, c.placement, c.name, Date.now()));
      // For a position the place is the whole story; for a movement, say where it leaves the unit.
      patchEntry(entryId, { pending: false, outcome: c.placement.heading_to ? `Chose ${c.name}. ${outcome}` : `Chose ${c.name} (±${c.placement.radius_m ?? 80} m)` });
      setStatus(outcome);
      reportAnswer(entryId, c.id);
    },
    [reportAnswer],
  );

  // ---------- source: scenario clips ----------
  const runStep = useCallback(
    async (sc: Scenario, step: ScenarioStep, manual = false): Promise<boolean> => {
      setStepResults((r) => ({ ...r, [`${sc.id}/${step.id}`]: { state: "running", note: "sending" } }));
      const now = Date.now();
      const base = { seq: ++seqRef.current, callsign: step.callsign, source: "scenario" as const, startedAt: now, endedAt: now, scenarioStepId: step.id };

      // Optional: let the room hear the clip first, as if someone had just said it.
      if (playClips) await playClipAloud(step.audio);
      const u: Utterance = { ...base, audioUri: await clipUri(step.audio), mime: "audio/mp4" };
      const out = await handleUtterance(u, { area: sc.area, language: step.lang, scripted: step.text, quiet: !speakReplies });
      if (!out) {
        setStepResults((r) => ({ ...r, [`${sc.id}/${step.id}`]: { state: "fail", note: "no answer from the coordinator" } }));
        return false;
      }
      let chosen: Candidate | undefined;
      if (out.reply.resolution.status === "ambiguous" && step.choose) {
        chosen = out.reply.resolution.candidates.find((c) => c.id === step.choose);
        // Sent on its own, the question is left open for a person to answer.
        if (chosen && !manual) choose(out.entryId, chosen, out.reply.resolution.track?.n);
      }
      const verdict = evaluate(step, out.reply, chosen);
      if (manual && verdict.pass && chosen) verdict.note = "asked a question";
      // One line per step in the dev-server log, so runs in different modes can be compared.
      console.log("[step]", JSON.stringify({ scenario: sc.id, step: step.id, mode: "coordinator", said: step.text, heard: out.reply.transcript, pass: verdict.pass, note: verdict.note, serverSttMs: out.reply.timings_ms.stt, roundTripMs: out.roundTripMs }));
      setStepResults((r) => ({ ...r, [`${sc.id}/${step.id}`]: { state: verdict.pass ? "pass" : "fail", note: verdict.note } }));
      return verdict.pass;
    },
    [handleUtterance, choose, speakReplies, playClips],
  );

  const playScenario = useCallback(async () => {
    const sc = SCENARIOS.find((s) => s.id === effectiveScenarioId);
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
    // Shown on screen so the figure can be read off a phone that is not attached to a computer.
    setStatus(cancelScenarioRef.current ? "Scenario stopped." : `${sc.title}: ${passed} of ${sc.steps.length} steps as expected.`);
    setBusyBoth("idle");
  }, [effectiveScenarioId, realTime, runStep]);

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
      const base = { seq: ++seqRef.current, callsign: callsign.trim() || "UNKNOWN", source: "mic" as const, startedAt: recordStartRef.current, endedAt };
      setStatus("Sending audio to the coordinator…");
      await handleUtterance({ ...base, audioUri: uri, mime: "audio/mp4" }, { area: effectiveArea, language, quiet: !speakReplies });
    } catch (e) {
      setStatus(e instanceof Error ? `Recording failed: ${e.message}` : "Recording failed.");
    } finally {
      setBusyBoth("idle");
    }
  }, [recorder, callsign, effectiveArea, language, handleUtterance, speakReplies]);

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
      await recorder.prepareToRecordAsync(SPEECH_RECORDING);
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

  /** None of the offered places was right: close the question and ask for a clearer report. */
  const noneOfThese = useCallback(
    (entryId: string) => {
      stopSpeaking();
      patchEntry(entryId, { pending: false, outcome: "None of the choices was right." });
      setStatus("Say it again with a street or place name.");
      reportAnswer(entryId, null);
    },
    [reportAnswer],
  );

  const reset = () => {
    stopSpeaking();
    cancelScenarioRef.current = true;
    setEntries([]);
    reportIdsRef.current.clear();
    setStepResults({});
    setPositionBoth(null);
    seqRef.current = 0;
    setStatus("Cleared.");
  };

  const coordinatorName = serverUrl.replace(/^https?:\/\//, "");
  const areaLabel = AREAS.find((a) => a.id === effectiveArea)?.label ?? effectiveArea;
  const languageLabel = LANGUAGES.find((l) => l.id === language)?.label ?? language;
  const openSetup = () => setSetupOpen(true);
  const connectTo = (host: FoundHost) => {
    if (!host.ready || busyRef.current !== "idle" || joinBusy) return;
    setJoinedBoth(null); setPositionBoth(null); autoJoinAttempt.current = { key: "", at: 0 };
    setServerUrl(host.url); setConnectedHost(host.url); setReach("ok"); setMissionList(host.missions);
    setStatus(`Connected to ${host.name}. Connecting to the newest running mission.`);
  };
  /** The newest question still waiting for an answer, if any. */
  const asking = entries.find((e) => e.pending && e.candidates?.length);
  const askingId = asking?.id;
  // A new question should never arrive off screen.
  useEffect(() => {
    if (askingId) scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [askingId]);

  // At most one notice, for the thing that would make the next report fail.
  const notice =
    needsConnect ? (
      <View style={{ marginHorizontal: space.lg, marginTop: space.md, gap: space.sm }}>
        <Text style={type.headline}>{hosts.length ? "Choose coordinator" : "Looking for coordinators…"}</Text>
        {hosts.map((host) => <View key={host.id} style={[styles.notice, styles.noticeWarn, { marginHorizontal: 0 }]}>
          <Text style={styles.noticeText}>{host.name}{host.ready ? "" : " · Starting…"}{host.missions.missions.some((m) => m.ended == null) ? "" : " · No running mission"}</Text>
          <Button label="Connect" onPress={() => connectTo(host)} disabled={!host.ready} />
        </View>)}
        {!hosts.length ? <Text style={type.footnote}>Keep the phone connected by USB or use the server’s local network. Detection retries automatically.</Text> : null}
      </View>
    ) : reach === "unreachable" ? (
      <View style={[styles.notice, styles.noticeBad]}><Text style={styles.noticeText}>Connection lost. Reports cannot be sent.</Text><Button label="Hosts" onPress={() => setConnectedHost(null)} /></View>
    ) : needsJoin ? (
      <View style={[styles.notice, styles.noticeWarn]}>
        <Text style={styles.noticeText}>{joinError ?? (newestMission ? `Connecting to ${newestMission.name}…` : "No running mission. Waiting for the server to start one.")}</Text>
        {!newestMission ? <Button label="Waiting for mission" disabled onPress={() => {}} /> : null}
      </View>
    ) : null;

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <View style={styles.column}>
        <View style={styles.header}>
          <Pressable
            style={styles.identity}
            onPress={openSetup}
            accessibilityRole="button"
            accessibilityLabel={`Call sign ${callsign || "not set"}. Area ${areaLabel}. Language ${languageLabel}. Coordinator ${coordinatorName}, ${reach === "ok" ? "answering" : reach === "unreachable" ? "not answering" : "checking"}`}
            accessibilityHint="Opens setup"
          >
            <Text style={type.title} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {callsign.trim() || "No call sign"}
            </Text>
            <View style={styles.context}>
              <Text style={type.footnote} numberOfLines={1}>
                {areaLabel} · {languageLabel}
              </Text>
              <View style={[styles.dot, { backgroundColor: reach === "ok" && !needsConnect && !needsJoin && joinedNow ? color.ok : reach === "unreachable" ? color.bad : color.warn }]} />
              <Text style={[type.footnote, styles.contextLast, reach === "unreachable" && styles.badText]} numberOfLines={1}>
                {needsConnect ? "Not connected" : joinedNow && !needsJoin ? `${coordinatorName} · Reporting` : `${coordinatorName} · Waiting for mission`}
              </Text>
            </View>
          </Pressable>
          <Pressable onPress={openSetup} style={({ pressed }) => [styles.gear, pressed && styles.gearPressed]} accessibilityRole="button" accessibilityLabel="Setup">
            <Ionicons name="settings-outline" size={22} color={color.text} />
          </Pressable>
        </View>

        {joinedNow ? (
          <View style={styles.missionBar}>
            <Ionicons name="flag" size={16} color={color.ok} />
            <Text style={[type.footnote, styles.missionName]} numberOfLines={1} accessibilityLabel={`In mission ${joinedNow.name}`}>
              {joinedNow.name} · {joinedNow.code}
            </Text>
          </View>
        ) : reach === "ok" && !missionList?.stored ? (
          <Text style={[type.footnote, styles.noRecord]}>This coordinator keeps no record, so there are no missions: reports are placed, but no receiver shows them.</Text>
        ) : null}

        {notice}

        <View style={styles.talk}>
          <TalkButton state={busy} blocked={needsConnect ? "Connect first" : reach !== "ok" ? "Coordinator offline" : needsJoin ? (newestMission ? "Connecting to mission" : "Waiting for mission") : null} onPressIn={onPressIn} onPressOut={onPressOut} />
          <View style={styles.readout}>
            <Text style={styles.status} numberOfLines={4} accessibilityLiveRegion="polite">
              {asking ? "The coordinator needs an answer." : status}
            </Text>
            <Text style={[type.footnote, tabular, styles.fix]} numberOfLines={1}>
              {position ? `${position.estimated ? "≈ " : ""}${position.label} · ±${position.radius_m} m · ${fmtTime(position.ts)}` : "No position yet"}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollBody}>
        {asking ? <QuestionCard entry={asking} onChoose={choose} onNone={noneOfThese} /> : null}
        {developer ? <Segmented
          label="Scenarios or sent reports"
          options={[
            { id: "scenarios", label: "Scenarios" },
            { id: "sent", label: entries.length ? `Sent · ${entries.length}` : "Sent" },
          ]}
          value={tab}
          onChange={setTab}
        /> : null}
        {developer && tab === "scenarios" ? (
          <ScenarioCard
            scenarios={scenarios}
            scenarioId={effectiveScenarioId}
            onSelect={setScenarioId}
            results={stepResults}
            running={busy === "scenario"}
            blocked={needsConnect || needsJoin || reach !== "ok" || (busy !== "idle" && busy !== "scenario")}
            onPlay={playScenario}
            onStop={() => (cancelScenarioRef.current = true)}
            onSendStep={sendOneStep}
          />
        ) : (
          <LogList entries={entries} onClear={reset} developer={developer} />
        )}
      </ScrollView>

      <SetupSheet
        visible={setupOpen}
        onClose={() => setSetupOpen(false)}
        locked={busy !== "idle" || joinBusy}
        callsign={callsign}
        onCallsign={setCallsign}
        languages={LANGUAGES}
        language={language}
        onLanguage={setLanguage}
        serverUrl={serverUrl}
        hosts={hosts}
        onConnectHost={connectTo}
        onServerUrl={(url) => {
          if (url !== serverUrl) { setConnectedHost(null); setJoinedBoth(null); setMissionList(null); setReach("checking"); }
          setServerUrl(url);
        }}
        reach={reach}
        developer={developer}
        onDeveloper={setDeveloper}
        speakReplies={speakReplies}
        onSpeakReplies={setSpeakReplies}
        playClips={playClips}
        onPlayClips={setPlayClips}
        realTime={realTime}
        onRealTime={setRealTime}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  /** Phone-width column: on a tablet the screen stays a column instead of stretching. */
  column: { width: "100%", maxWidth: 560, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingLeft: space.lg, paddingRight: space.sm, paddingTop: space.sm },
  identity: { flex: 1, minHeight: TOUCH, justifyContent: "center" },
  context: { flexDirection: "row", alignItems: "center", gap: space.sm },
  contextLast: { flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, marginLeft: space.xs },
  badText: { color: color.bad },
  gear: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: "center", justifyContent: "center" },
  gearPressed: { backgroundColor: color.raised },
  notice: { flexDirection: "row", alignItems: "center", gap: space.md, marginHorizontal: space.lg, marginTop: space.md, paddingLeft: space.md, paddingRight: space.xs, paddingVertical: space.xs, borderRadius: radius.control },
  noticeBad: { backgroundColor: color.badWash },
  noticeWarn: { backgroundColor: color.warnWash },
  noticeText: { ...type.footnote, color: color.text, flex: 1, paddingVertical: space.sm },
  missionBar: { flexDirection: "row", alignItems: "center", gap: space.sm, marginHorizontal: space.lg, marginTop: space.sm, paddingLeft: space.md, paddingRight: space.xs, minHeight: TOUCH, borderRadius: radius.control, backgroundColor: color.surface },
  missionName: { flex: 1, color: color.text },
  noRecord: { marginHorizontal: space.lg, marginTop: space.sm },
  talk: { alignItems: "center", gap: space.sm, paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.lg },
  readout: { alignItems: "center", gap: space.xs, alignSelf: "stretch" },
  status: { ...type.body, textAlign: "center" },
  fix: { textAlign: "center" },
  scroll: { flex: 1 },
  scrollBody: { width: "100%", maxWidth: 560, alignSelf: "center", paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.xxl + space.lg, gap: space.lg },
});
