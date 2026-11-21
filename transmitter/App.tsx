import { Ionicons } from "@expo/vector-icons";
import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import Constants from "expo-constants";
import { useKeepAwake } from "expo-keep-awake";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState, type ComponentRef } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { SCENARIOS } from "./scenarios";
import { MAX_CLIP_MS, MIN_CLIP_MS, SPEECH_RECORDING, SPEECH_RECORDING_WAV, clipUri, playClipAloud } from "./src/sources";
import { speak, stopSpeaking } from "./src/speech";
import { startPcm, stopPcm } from "./src/pcm";
import { CoordinatorError, callsignKey, fetchMissions, joinMission, loadSaved, positionFromJoin, writeSaved, type Saved } from "./src/mission";
import { PHONE_MODELS, downloadModel, hasModel, hintPrompt, transcribeOnPhone, type PhoneMode, type SttMode } from "./src/stt";
import { describePlacement, positionAfter, sendAnswer, sendUtterance } from "./src/transport";
import type { AreaId, Candidate, Lang, MissionListReply, Position, ReportReply, Scenario, ScenarioStep, Utterance } from "./src/types";
import { Button, Segmented } from "./src/ui/controls";
import { JoinCard } from "./src/ui/JoinCard";
import { LogList, QuestionCard } from "./src/ui/LogList";
import { fmtTime, type Entry, type Reach, type StepResult } from "./src/ui/model";
import { ScenarioCard } from "./src/ui/ScenarioCard";
import { SetupSheet } from "./src/ui/SetupSheet";
import { TalkButton } from "./src/ui/TalkButton";
import { TOUCH, color, radius, space, tabular, type } from "./src/ui/theme";

const LIVE_SITE = "https://edth-hackathon.vercel.app";
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
const DEFAULT_SERVER = process.env.EXPO_PUBLIC_SERVER_URL ?? LOCAL_COORDINATOR ?? LIVE_SITE;
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
  // The phone's own id and the mission it joined, kept between launches.
  const [saved, setSaved] = useState<Saved>(() => loadSaved());
  const [callsign, setCallsign] = useState(() => saved.joined?.callsign ?? "ALPHA 1");
  const [area, setArea] = useState<AreaId>("vincennes");
  const [language, setLanguage] = useState<Lang>("en");
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [reach, setReach] = useState<Reach>("checking");
  const [setupOpen, setSetupOpen] = useState(false);
  const [tab, setTab] = useState<"scenarios" | "sent">("scenarios");
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const [busy, setBusy] = useState<Busy>("idle");
  const [status, setStatus] = useState("Hold the button and say where you are, or play a scenario.");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [position, setPosition] = useState<Position | null>(null);
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0]?.id ?? "");
  const [stepResults, setStepResults] = useState<Record<string, StepResult>>({});
  const [realTime, setRealTime] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [playClips, setPlayClips] = useState(false);
  const [sttMode, setSttMode] = useState<SttMode>("server");
  const [useHints, setUseHints] = useState(true);
  // Tests only: send each recording beside the phone's words, for the coordinator to keep (KEEP_CLIPS=1).
  const [sendClips, setSendClips] = useState(false);
  const [modelReady, setModelReady] = useState<Record<PhoneMode, boolean>>(() => ({ "phone-base": hasModel("phone-base"), "phone-small": hasModel("phone-small") }));
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  /** The coordinator's missions; null when it has none to offer (an older deployment). */
  const [missionList, setMissionList] = useState<MissionListReply | null>(null);
  const [joined, setJoined] = useState<{ code: string; name: string; area: AreaId; callsign: string } | null>(null);
  const [pickedMission, setPickedMission] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  /** In a mission as the call sign shown. A changed call sign has to join again. */
  const joinedNow = joined && joined.callsign === callsignKey(callsign) ? joined : null;
  /** A coordinator that keeps missions takes reports only from a phone that joined one. */
  const needsJoin = reach === "ok" && !!missionList?.stored && !joinedNow;
  /** In a mission, its area; the coordinator uses it whatever the phone sends. */
  const effectiveArea: AreaId = joinedNow?.area ?? area;
  const scenarios = joinedNow ? SCENARIOS.filter((s) => s.area === joinedNow.area) : SCENARIOS;
  const effectiveScenarioId = scenarios.some((s) => s.id === scenarioId) ? scenarioId : (scenarios[0]?.id ?? "");

  const positionRef = useRef<Position | null>(null);
  /** The mission's code, for the send path; null with no mission. */
  const sessionRef = useRef<string | null>(null);
  const triedRejoinRef = useRef(false);
  /** The coordinator's report id for each question asked, by log entry, to send back with the answer. */
  const reportIdsRef = useRef(new Map<string, string>());
  const seqRef = useRef(0);
  const busyRef = useRef<Busy>("idle");
  const recordStartRef = useRef(0);
  const releasedRef = useRef(false);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelScenarioRef = useRef(false);
  /** Phone speech-to-text times of the current scenario run, for the summary line. */
  const phoneTimesRef = useRef<number[]>([]);
  const recorder = useAudioRecorder(SPEECH_RECORDING);

  // Is the coordinator answering at this address, and which missions are open? Any HTTP answer
  // counts as answering; only silence does not. Checked when the address changes and then every
  // 5 seconds, so the light follows the network and a newly opened or ended mission shows up.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const list = await fetchMissions(serverUrl);
        if (cancelled) return;
        setReach("ok");
        setMissionList(list);
      } catch {
        if (!cancelled) setReach("unreachable");
      }
    };
    const first = setTimeout(() => {
      if (cancelled) return;
      setReach("checking");
      check();
    }, 500);
    const again = setInterval(check, 5_000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(again);
    };
  }, [serverUrl]);

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
      const next = { device: s.device };
      writeSaved(next);
      return next;
    });
    setStatus(why);
  }, []);

  const join = useCallback(
    async (code: string, cs: string, rejoining = false) => {
      setJoinBusy(true);
      setJoinError(null);
      try {
        const r = await joinMission(serverUrl, code, callsignKey(cs), saved.device);
        setJoinedBoth({ code, name: r.mission.name, area: r.mission.area, callsign: r.callsign });
        setArea(r.mission.area);
        setCallsign(r.callsign);
        setPositionBoth(positionFromJoin(r));
        const next = { device: saved.device, joined: { server: serverUrl, code, callsign: r.callsign } };
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
        if (rejoining && e instanceof CoordinatorError && e.ended) leaveMission("Your last mission has ended. Join another one.");
        else setJoinError(msg);
      } finally {
        setJoinBusy(false);
      }
    },
    [serverUrl, saved.device, language, speakReplies, leaveMission],
  );

  // On start, rejoin the mission this phone was in; while in one, notice when it ends.
  useEffect(() => {
    if (!missionList?.stored) return;
    const open = missionList.missions.filter((m) => m.ended == null);
    if (joined) {
      if (!open.some((m) => m.code === joined.code)) leaveMission(`${joined.name} has ended. Join another mission.`);
      return;
    }
    const last = saved.joined;
    if (!triedRejoinRef.current && last && last.server === serverUrl) {
      triedRejoinRef.current = true;
      if (open.some((m) => m.code === last.code)) join(last.code, last.callsign, true);
      else leaveMission("Your last mission has ended. Join another one.");
    }
  }, [missionList, joined, saved.joined, serverUrl, join, leaveMission]);

  /**
   * The one path every utterance takes, whatever produced it: send to the coordinator,
   * apply the reply, speak a question back. Returns the reply and the log entry id.
   */
  const handleUtterance = useCallback(
    async (u: Utterance, opts: { area: AreaId; language: Lang; scripted?: string; quiet?: boolean; phoneMs?: number }): Promise<{ reply: ReportReply; entryId: string; roundTripMs: number } | null> => {
      const entryId = `${u.callsign}-${u.seq}-${u.endedAt}`;
      try {
        const { reply, roundTripMs } = await sendUtterance(u, { serverUrl, area: opts.area, language: opts.language, session: sessionRef.current, lastPosition: positionRef.current });
        const res = reply.resolution;
        const lang = langOf(reply, opts.language);
        const t = reply.timings_ms;
        const timings = `${opts.phoneMs != null ? `phone STT ${opts.phoneMs} · ` : ""}${t.stt ? `STT ${t.stt} · ` : ""}extract ${t.extract} · server ${t.total} · round trip ${roundTripMs} ms${reply.clip ? " · clip kept" : ""}`;
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
          setEntries((es) => [{ ...base, outcome: "Asked back", status: "ambiguous", question: res.question, candidates: res.candidates, pending: true, reportId: reply.report_id }, ...es]);
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
    [serverUrl, leaveMission],
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
    (entryId: string, c: Candidate) => {
      stopSpeaking();
      if (c.track_placement) {
        // The question was about a track: the choice places the track on the shared map, not this unit.
        const outcome = `Track placed at ${c.name} (±${c.track_placement.radius_m ?? 80} m)`;
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
      let u: Utterance;
      let phoneMs: number | undefined;
      // Optional: let the room hear the clip first, as if someone had just said it.
      if (playClips) await playClipAloud(step.audio);
      if (sttMode === "server") {
        u = { ...base, audioUri: await clipUri(step.audio), mime: "audio/mp4" };
      } else {
        // Speech-to-text on the phone: only the words travel. Each step says its own language.
        const heard = await transcribeOnPhone(sttMode, await clipUri(step.wav), { prompt: useHints ? hintPrompt(sc.area) : undefined, language: step.lang });
        phoneMs = heard.ms;
        phoneTimesRef.current.push(heard.ms);
        if (!heard.text) {
          console.log("[step]", JSON.stringify({ scenario: sc.id, step: step.id, mode: sttMode, hints: useHints, said: step.text, heard: "", pass: false, note: "phone heard nothing", phoneMs }));
          setStepResults((r) => ({ ...r, [`${sc.id}/${step.id}`]: { state: "fail", note: "the phone heard nothing" } }));
          return false;
        }
        u = { ...base, text: heard.text, endedAt: Date.now() };
      }
      const out = await handleUtterance(u, { area: sc.area, language: step.lang, scripted: step.text, quiet: !speakReplies, phoneMs });
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
      if (manual && verdict.pass && chosen) verdict.note = "asked a question";
      // One line per step in the dev-server log, so runs in different modes can be compared.
      console.log("[step]", JSON.stringify({ scenario: sc.id, step: step.id, mode: sttMode, hints: sttMode === "server" ? null : useHints, said: step.text, heard: out.reply.transcript, pass: verdict.pass, note: verdict.note, phoneMs, serverSttMs: out.reply.timings_ms.stt, roundTripMs: out.roundTripMs }));
      setStepResults((r) => ({ ...r, [`${sc.id}/${step.id}`]: { state: verdict.pass ? "pass" : "fail", note: verdict.note } }));
      return verdict.pass;
    },
    [handleUtterance, choose, speakReplies, sttMode, useHints, playClips],
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
    phoneTimesRef.current = [];
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
    const times = [...phoneTimesRef.current].sort((a, b) => a - b);
    const speed = times.length ? ` Phone speech-to-text: median ${times[Math.floor(times.length / 2)]} ms, slowest ${times[times.length - 1]} ms.` : "";
    setStatus(cancelScenarioRef.current ? "Scenario stopped." : `${sc.title}: ${passed} of ${sc.steps.length} steps as expected.${speed}`);
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

  // ---------- speech-to-text on the phone ----------
  const modelMissing = sttMode !== "server" && !modelReady[sttMode];
  // Both phones give Whisper a PCM WAV; Android uses our AudioRecord module.
  const phoneStt = sttMode !== "server";
  const androidPcm = phoneStt && Platform.OS === "android";

  const fetchModel = useCallback(async () => {
    if (sttMode === "server" || downloadPct !== null) return;
    const mode = sttMode;
    setDownloadPct(0);
    setStatus(`Downloading ${PHONE_MODELS[mode].file} (${PHONE_MODELS[mode].mb} MB)…`);
    try {
      await downloadModel(mode, (f) => setDownloadPct(Math.round(f * 100)));
      setModelReady((m) => ({ ...m, [mode]: hasModel(mode) }));
      setStatus(hasModel(mode) ? "Model ready. Speech-to-text now runs on the phone." : "The download did not complete. Try again.");
    } catch (e) {
      setStatus(e instanceof Error ? `Download failed: ${e.message}` : "Download failed.");
    } finally {
      setDownloadPct(null);
    }
  }, [sttMode, downloadPct]);

  // ---------- source: microphone, hold to talk ----------
  const stopAndSend = useCallback(async () => {
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    if (busyRef.current !== "recording") return;
    setBusyBoth("sending");
    const endedAt = Date.now();
    try {
      const pcmUri = androidPcm ? await stopPcm() : null;
      if (!androidPcm) await recorder.stop();
      // Hand the audio session back so the spoken question uses the loudspeaker, not the earpiece.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = androidPcm ? pcmUri : recorder.uri;
      if (!uri || endedAt - recordStartRef.current < MIN_CLIP_MS) {
        setStatus("Too short. Hold the button while you speak.");
        return;
      }
      const base = { seq: ++seqRef.current, callsign: callsign.trim() || "UNKNOWN", source: "mic" as const, startedAt: recordStartRef.current, endedAt };
      if (phoneStt) {
        setStatus("Transcribing on the phone…");
        const heard = await transcribeOnPhone(sttMode as PhoneMode, uri, { prompt: useHints ? hintPrompt(effectiveArea) : undefined, language });
        // With "Send clips" on, a clip the phone heard no words in still goes: a missed whisper is a result.
        if (!heard.text && !sendClips) {
          setStatus("The phone heard nothing. Try again.");
          return;
        }
        setStatus("Sending…");
        const clip = sendClips ? { clipUri: uri, segments: heard.segments } : {};
        await handleUtterance({ ...base, text: heard.text || undefined, ...clip }, { area: effectiveArea, language, quiet: !speakReplies, phoneMs: heard.ms });
      } else {
        setStatus("Sending…");
        await handleUtterance({ ...base, audioUri: uri, mime: "audio/mp4" }, { area: effectiveArea, language, quiet: !speakReplies });
      }
    } catch (e) {
      setStatus(e instanceof Error ? `Recording failed: ${e.message}` : "Recording failed.");
    } finally {
      setBusyBoth("idle");
    }
  }, [recorder, callsign, effectiveArea, language, handleUtterance, speakReplies, phoneStt, androidPcm, sttMode, useHints, sendClips]);

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
      if (androidPcm) {
        await startPcm();
      } else {
        await recorder.prepareToRecordAsync(phoneStt ? SPEECH_RECORDING_WAV : SPEECH_RECORDING);
        recorder.record();
      }
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
  }, [recorder, stopAndSend, phoneStt, androidPcm]);

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

  const coordinatorName = serverUrl === LOCAL_COORDINATOR ? "This Mac" : serverUrl === LIVE_SITE ? "Live site" : serverUrl.replace(/^https?:\/\//, "");
  const areaLabel = AREAS.find((a) => a.id === area)?.label ?? area;
  const languageLabel = LANGUAGES.find((l) => l.id === language)?.label ?? language;
  const openSetup = () => setSetupOpen(true);
  /** The newest question still waiting for an answer, if any. */
  const asking = entries.find((e) => e.pending && e.candidates?.length);
  const askingId = asking?.id;
  // A new question should never arrive off screen.
  useEffect(() => {
    if (askingId) scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [askingId]);

  const openMissions = missionList?.missions.filter((m) => m.ended == null) ?? [];
  // The one picked, or the only one open.
  const selectedMission = openMissions.find((m) => m.code === pickedMission)?.code ?? (openMissions.length === 1 ? openMissions[0].code : null);

  // At most one notice, for the thing that would make the next report fail.
  const notice =
    reach === "unreachable" ? (
      <View style={[styles.notice, styles.noticeBad]} accessibilityRole="alert">
        <Ionicons name="alert-circle" size={20} color={color.bad} />
        <Text style={styles.noticeText}>Can’t reach the coordinator ({coordinatorName}). Reports will not go through.</Text>
        <Button label="Setup" kind="quiet" onPress={openSetup} />
      </View>
    ) : needsJoin ? (
      <JoinCard
        missions={openMissions}
        selected={selectedMission}
        onSelect={setPickedMission}
        callsign={callsign}
        onCallsign={setCallsign}
        onJoin={() => {
          if (selectedMission) join(selectedMission, callsign);
        }}
        busy={joinBusy}
        error={joinError}
        receiverUrl={`${serverUrl.replace(/\/+$/, "")}/receiver`}
      />
    ) : modelMissing ? (
      <View style={[styles.notice, styles.noticeWarn]} accessibilityRole="alert">
        <Ionicons name="cloud-download-outline" size={20} color={color.warn} />
        <Text style={styles.noticeText}>Speech-to-text is set to run on this phone, and its model is not downloaded yet.</Text>
        <Button label={downloadPct === null ? `Get ${PHONE_MODELS[sttMode].mb} MB` : `${downloadPct}%`} kind="quiet" busy={downloadPct !== null} onPress={fetchModel} />
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
              <View style={[styles.dot, { backgroundColor: reach === "ok" ? color.ok : reach === "unreachable" ? color.bad : color.textDim }]} />
              <Text style={[type.footnote, styles.contextLast, reach === "unreachable" && styles.badText]} numberOfLines={1}>
                {coordinatorName}
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
              {joinedNow.name}
            </Text>
            <Button label="Leave" kind="quiet" muted onPress={() => leaveMission(`Left ${joinedNow.name}.`)} />
          </View>
        ) : reach === "ok" && !missionList?.stored ? (
          <Text style={[type.footnote, styles.noRecord]}>This coordinator keeps no record, so there are no missions: reports are placed, but no receiver shows them.</Text>
        ) : null}

        {notice}

        <View style={styles.talk}>
          <TalkButton state={busy} blocked={modelMissing ? "Model needed" : needsJoin ? "Join first" : null} onPressIn={onPressIn} onPressOut={onPressOut} />
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
        <Segmented
          label="Scenarios or sent reports"
          options={[
            { id: "scenarios", label: "Scenarios" },
            { id: "sent", label: entries.length ? `Sent · ${entries.length}` : "Sent" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "scenarios" ? (
          <ScenarioCard
            scenarios={scenarios}
            scenarioId={effectiveScenarioId}
            onSelect={setScenarioId}
            results={stepResults}
            running={busy === "scenario"}
            blocked={modelMissing || needsJoin || (busy !== "idle" && busy !== "scenario")}
            onPlay={playScenario}
            onStop={() => (cancelScenarioRef.current = true)}
            onSendStep={sendOneStep}
          />
        ) : (
          <LogList entries={entries} onClear={reset} />
        )}
      </ScrollView>

      <SetupSheet
        visible={setupOpen}
        onClose={() => setSetupOpen(false)}
        locked={busy !== "idle"}
        callsign={callsign}
        onCallsign={setCallsign}
        areas={AREAS}
        area={area}
        onArea={setArea}
        languages={LANGUAGES}
        language={language}
        onLanguage={setLanguage}
        serverUrl={serverUrl}
        onServerUrl={setServerUrl}
        localCoordinator={LOCAL_COORDINATOR}
        liveSite={LIVE_SITE}
        reach={reach}
        sttMode={sttMode}
        onSttMode={setSttMode}
        modelReady={modelReady}
        downloadPct={downloadPct}
        onDownload={fetchModel}
        useHints={useHints}
        onUseHints={setUseHints}
        sendClips={sendClips}
        onSendClips={setSendClips}
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
