import { Ionicons } from "@expo/vector-icons";
import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import Constants from "expo-constants";
import { useKeepAwake } from "expo-keep-awake";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { SCENARIOS } from "./scenarios";
import { MAX_CLIP_MS, MIN_CLIP_MS, SPEECH_RECORDING, clipUri, playClipAloud } from "./src/sources";
import { CoordinatorError, loadSaved, writeSaved, type Saved } from "./src/mission";
import { positionAfter, sendUtterance } from "./src/transport";
import type { AreaId, Candidate, Lang, MissionListReply, Position, ReportReply, Resolution, Scenario, ScenarioStep, Utterance } from "./src/types";
import { Button } from "./src/ui/controls";
import { discoverHosts, serverOrigin, type FoundHost } from "./src/hosts";
import { fmtTime, type Reach, type StepResult } from "./src/ui/model";
import { ScenarioCard } from "./src/ui/ScenarioCard";
import { SetupSheet } from "./src/ui/SetupSheet";
import { TalkButton } from "./src/ui/TalkButton";
import { TOUCH, color, radius, space, type } from "./src/ui/theme";

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

/** What a send came to: the coordinator's reply, or why it did not go through. */
type Sent = { ok: true; reply: ReportReply; roundTripMs: number } | { ok: false; error: string };

/** The first thing the status line says: how a radio report starts, since the sender is read from the words [202]. */
const HOLD_TO_TALK = "Hold to talk. Start with your call sign: “Alpha 1, at the château.”";

/**
 * The status line after a send. It says only that the report went, that it waits for the
 * operator, or that it did not go and why. The coordinator's question is for the operator [178].
 */
function sentStatus(out: Sent, at: number): string {
  if (!out.ok) return `Not sent. ${out.error}`;
  if (out.reply.held === null) return "Not sent. The coordinator could not hold it for the operator.";
  const sent = `Sent at ${fmtTime(at)}.`;
  return out.reply.held ? `${sent} Held for the operator to place.` : sent;
}

/**
 * Did the coordinator answer what the scenario step expected? A question stays open for the
 * operator: a step that expects one passes when the expected choice was offered.
 */
function evaluate(step: ScenarioStep, r: Resolution, offered?: Candidate): { pass: boolean; note: string } {
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
  if (step.choose && !offered) return { pass: false, note: `choice ${step.choose} was not offered` };
  const about = r.track?.n != null ? `Track ${r.track.n}, ` : "";
  return { pass: true, note: offered ? `${about}asked, ${offered.name} offered` : `${about}${r.status}` };
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
  // The mission this phone is on, kept between launches.
  const [saved, setSaved] = useState<Saved>(() => loadSaved());
  const [area, setArea] = useState<AreaId>("vincennes");
  const [language, setLanguage] = useState<Lang>("en");
  const [serverUrl, setServerUrl] = useState(() => serverOrigin(saved.server) || DEFAULT_SERVER);
  const [hosts, setHosts] = useState<FoundHost[]>([]);
  const [connectedHost, setConnectedHost] = useState<string | null>(null);
  const needsConnect = connectedHost !== serverUrl;
  const [developer, setDeveloper] = useState(false);
  const [reach, setReach] = useState<Reach>("checking");
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>("idle");
  const [status, setStatus] = useState(HOLD_TO_TALK);
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0]?.id ?? "");
  const [stepResults, setStepResults] = useState<Record<string, StepResult>>({});
  /** The last run of a scenario in a line: how many steps came back as expected, and the phone's speech-to-text times. */
  const [scenarioSummary, setScenarioSummary] = useState<{ scenario: string; text: string } | null>(null);
  const [realTime, setRealTime] = useState(false);
  const [playClips, setPlayClips] = useState(false);
  /**
   * The coordinator's missions, with the address they came from, so a list from the last address
   * is never read as this one's. The list is null when it has none to offer (an older deployment).
   */
  const [listed, setListed] = useState<{ server: string; list: MissionListReply | null } | null>(null);
  const missionList = listed && listed.server === serverUrl ? listed.list : null;
  /** Why the phone came off its mission ("Patrol 2 has ended."), until another is picked. */
  const [missionNote, setMissionNote] = useState<string | null>(null);

  const openMissions = missionList?.missions.filter((m) => m.ended == null) ?? [];
  const newest = openMissions.reduce<(typeof openMissions)[number] | null>((latest, m) => !latest || m.opened > latest.opened || (m.opened === latest.opened && m.code > latest.code) ? m : latest, null);
  const previousMission = useRef<typeof newest>(null);
  // Finish an in-flight report/scenario before following a newer mission.
  const mission = needsConnect ? null : busy !== "idle" && previousMission.current && openMissions.some(m => m.code === previousMission.current?.code) ? previousMission.current : newest;
  useEffect(() => { previousMission.current = mission; }, [mission]);
  const needsMission = !mission;
  /** In a mission, its area; the coordinator uses it whatever the phone sends. */
  const effectiveArea: AreaId = mission?.area ?? area;
  const scenarios = mission ? SCENARIOS.filter((s) => s.area === mission.area) : SCENARIOS;
  const effectiveScenarioId = scenarios.some((s) => s.id === scenarioId) ? scenarioId : (scenarios[0]?.id ?? "");

  /** Where the phone was last placed, kept quietly and sent only with no mission. */
  const positionRef = useRef<Position | null>(null);
  /** The mission's code, for the send path; null with no mission. */
  const sessionRef = useRef<string | null>(null);
  const seqRef = useRef(0);
  const busyRef = useRef<Busy>("idle");
  const recordStartRef = useRef(0);
  const releasedRef = useRef(false);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelScenarioRef = useRef(false);
  const recorder = useAudioRecorder(SPEECH_RECORDING);

  useEffect(() => { writeSaved({ ...saved, server: serverUrl }); }, [saved, serverUrl]);
  useEffect(() => {
    let stopped = false;
    const scan = async () => {
      const found = await discoverHosts([DEFAULT_SERVER, LOCAL_COORDINATOR, serverUrl, saved.server, saved.mission?.server, "http://127.0.0.1:3117"]);
      if (stopped) return;
      setHosts(found);
      const active = found.find(h => h.url === serverUrl);
      setReach(active ? active.ready ? "ok" : "checking" : "unreachable");
      setListed(active ? { server: serverUrl, list: active.missions } : null);
    };
    void scan();
    const timer = setInterval(scan, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [serverUrl, saved.server, saved.mission?.server]);
  const connectTo = (host: FoundHost) => {
    if (!host.ready || busyRef.current !== "idle") return;
    setServerUrl(host.url); setConnectedHost(host.url); setReach("ok");
    setListed({ server: host.url, list: host.missions }); setMissionNote(null);
    setSaved({ server: host.url });
    setStatus("Connected. Following the newest running mission.");
  };

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

  const dropMission = useCallback((note: string | null) => {
    setMissionNote(note); setListed(null); sessionRef.current = null;
    cancelScenarioRef.current = true;
  }, []);

  // The send path reads the mission from here, so a scenario that is running follows a change.
  // Setup shows the mission's area, as the coordinator uses it whatever the phone sends [108].
  const missionArea = mission?.area ?? null;
  useEffect(() => {
    sessionRef.current = mission?.code ?? null;
  }, [mission?.code]);
  useEffect(() => {
    if (missionArea) setArea(missionArea);
  }, [missionArea]);

  /**
   * The one path every utterance takes, whatever produced it: send it to the coordinator and say
   * on the status line whether it went. The phone does not answer or speak questions; the operator
   * does that on the command post [178].
   */
  const handleUtterance = useCallback(
    async (u: Utterance, opts: { area: AreaId; language: Lang }): Promise<Sent> => {
      const session = sessionRef.current;
      let out: Sent;
      try {
        if (!session) throw new Error("Waiting for connection to the newest running mission.");
        const { reply, roundTripMs } = await sendUtterance(u, { serverUrl, area: opts.area, language: opts.language, session, lastPosition: positionRef.current });
        const res = reply.resolution;
        // With no mission the phone keeps its own position, so the next report's "north of me" has
        // a start. In a mission the coordinator keeps each unit's position itself [108].
        if (!session && res?.status === "resolved" && !res.track) {
          const name = res.candidates?.find((c) => c.id === res.evidence?.feature_id)?.name ?? "position";
          positionRef.current = positionAfter(positionRef.current, { pin: res.pin, radius_m: res.radius_m, heading_to: res.heading_to, estimated: res.estimated }, name, Date.now());
        }
        out = { ok: true, reply, roundTripMs };
      } catch (e) {
        const error = e instanceof Error ? (e.name === "AbortError" ? "The coordinator did not answer in time." : e.message) : "Sending failed.";
        // In the dev-server log too, so a failure on a phone can be diagnosed from the computer.
        console.log("[send-error]", JSON.stringify({ coordinator: serverUrl, error }));
        // The mission ended (or was deleted) under us: offer the open ones.
        if (e instanceof CoordinatorError && session && (e.ended || e.status === 404)) dropMission("The mission has ended.");
        out = { ok: false, error };
      }
      setStatus(sentStatus(out, u.endedAt));
      return out;
    },
    [serverUrl, dropMission],
  );

  // ---------- source: scenario clips ----------
  /** Sends one step and checks the answer. A question stays open for the operator [178]. */
  const runStep = useCallback(
    async (sc: Scenario, step: ScenarioStep): Promise<boolean> => {
      const key = `${sc.id}/${step.id}`;
      const result = (r: StepResult) => setStepResults((rs) => ({ ...rs, [key]: r }));
      result({ state: "running", note: "sending" });
      const now = Date.now();
      // A script speaks for several units, so each step names its own call sign.
      const base = { seq: ++seqRef.current, callsign: step.callsign, source: "scenario" as const, startedAt: now, endedAt: now, scenarioStepId: step.id };
      if (playClips) await playClipAloud(step.audio);
      const u: Utterance = { ...base, audioUri: await clipUri(step.audio), mime: "audio/mp4" };
      setStatus("Sending…");
      const out = await handleUtterance(u, { area: sc.area, language: step.lang });
      if (!out.ok) {
        result({ state: "fail", note: out.error });
        return false;
      }
      const res = out.reply.resolution;
      if (!res) {
        result({ state: "fail", note: out.reply.held ? "held for the operator" : "no answer to the report" });
        return false;
      }
      const offered = res.status === "ambiguous" && step.choose ? res.candidates.find((c) => c.id === step.choose) : undefined;
      const verdict = evaluate(step, res, offered);
      // One line per step in the dev-server log, so runs in different modes can be compared.
      console.log("[step]", JSON.stringify({ scenario: sc.id, step: step.id, mode: "coordinator", said: step.text, heard: out.reply.transcript, pass: verdict.pass, note: verdict.note, serverSttMs: out.reply.timings_ms?.stt, roundTripMs: out.roundTripMs }));
      result({ state: verdict.pass ? "pass" : "fail", note: verdict.note });
      return verdict.pass;
    },
    [handleUtterance, playClips],
  );

  const playScenario = useCallback(async () => {
    const sc = SCENARIOS.find((s) => s.id === effectiveScenarioId);
    if (!sc || busyRef.current !== "idle") return;
    setBusyBoth("scenario");
    cancelScenarioRef.current = false;
    setArea(sc.area);
    positionRef.current = null; // a scenario starts from a clean slate, like a fresh page
    setStepResults((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith(`${sc.id}/`))));
    setScenarioSummary(null);
    const started = Date.now();
    let passed = 0;
    for (const step of sc.steps) {
      if (cancelScenarioRef.current) break;
      if (realTime) {
        const wait = started + step.t * 1000 - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      if (await runStep(sc, step)) passed++;
    }
    // Shown on the card so the figure can be read off a phone that is not attached to a computer.
    setScenarioSummary({ scenario: sc.id, text: cancelScenarioRef.current ? "Stopped." : `${passed} of ${sc.steps.length} steps as expected.` });
    setBusyBoth("idle");
  }, [effectiveScenarioId, realTime, runStep]);

  /** Sends one step on its own, from wherever the unit is now. */
  const sendOneStep = useCallback(
    async (sc: Scenario, step: ScenarioStep) => {
      if (busyRef.current !== "idle") return;
      setBusyBoth("scenario");
      setArea(sc.area);
      await runStep(sc, step);
      setBusyBoth("idle");
    },
    [runStep],
  );

  // ---------- source: microphone, hold to talk ----------
  const stopAndSend = useCallback(async () => {
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    if (busyRef.current !== "recording") return;
    setBusyBoth("sending");
    setStatus("Sending…");
    const endedAt = Date.now();
    try {
      await recorder.stop();
      // Hand the audio session back to playback, on the loudspeaker.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!uri || endedAt - recordStartRef.current < MIN_CLIP_MS) {
        setStatus("Not sent. Too short: hold the button while you speak.");
        return;
      }
      // No call sign: like a radio, the phone says who it is in its words, and the coordinator reads it [202].
      const base = { seq: ++seqRef.current, source: "mic" as const, startedAt: recordStartRef.current, endedAt };
      await handleUtterance({ ...base, audioUri: uri, mime: "audio/mp4" }, { area: effectiveArea, language });
    } catch (e) {
      setStatus(e instanceof Error ? `Not sent. Recording failed: ${e.message}` : "Not sent. Recording failed.");
    } finally {
      setBusyBoth("idle");
    }
  }, [recorder, effectiveArea, language, handleUtterance]);

  const onPressIn = useCallback(async () => {
    if (busyRef.current !== "idle") return;
    releasedRef.current = false;
    setBusyBoth("starting");
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setStatus("Not sent. Microphone access was refused: allow it in Settings, or use a scenario.");
        setBusyBoth("idle");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync(SPEECH_RECORDING);
      recorder.record();
      recordStartRef.current = Date.now();
      setBusyBoth("recording");
      setStatus("Listening… release to send.");
      // At 15 seconds the report is sent as it is.
      maxTimerRef.current = setTimeout(stopAndSend, MAX_CLIP_MS);
      if (releasedRef.current) stopAndSend(); // released while the microphone was still opening
    } catch (e) {
      setStatus(e instanceof Error ? `Not sent. Could not open the microphone: ${e.message}` : "Not sent. Could not open the microphone.");
      setBusyBoth("idle");
    }
  }, [recorder, stopAndSend]);

  const onPressOut = useCallback(() => {
    releasedRef.current = true;
    stopAndSend();
  }, [stopAndSend]);

  const coordinatorName = serverUrl.replace(/^https?:\/\//, "");
  const areaLabel = AREAS.find((a) => a.id === area)?.label ?? area;
  const languageLabel = LANGUAGES.find((l) => l.id === language)?.label ?? language;
  const openSetup = () => setSetupOpen(true);
  const title = mission?.name ?? "No mission";

  // At most one notice, for the thing that would make the next report fail.
  const notice = needsConnect ? (
    <View style={{ marginHorizontal: space.lg, marginTop: space.md, gap: space.sm }}>
      <Text style={type.headline}>{hosts.length ? "Choose coordinator" : "Looking for coordinators…"}</Text>
      {hosts.map(host => <View key={host.id} style={[styles.notice, styles.noticeWarn]}>
        <Text style={styles.noticeText}>{host.name}{host.ready ? "" : " · Starting…"}{host.missions.missions.some(m => m.ended == null) ? "" : " · No running mission"}</Text>
        <Button label="Connect" disabled={!host.ready} onPress={() => connectTo(host)} />
      </View>)}
    </View>
  ) : reach !== "ok" ? (
    <View style={[styles.notice, styles.noticeBad]}><Text style={styles.noticeText}>Coordinator offline.</Text><Button label="Hosts" onPress={() => setConnectedHost(null)} /></View>
  ) : needsMission ? (
    <View style={[styles.notice, styles.noticeWarn]}><Text style={styles.noticeText}>{missionNote ?? "No running mission. Waiting for the command post to start one."}</Text><Button label="Waiting for mission" disabled onPress={() => {}} /></View>
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
            accessibilityLabel={`${mission ? `Mission ${mission.name}` : title}. Area ${areaLabel}. Language ${languageLabel}. Coordinator ${coordinatorName}, ${reach === "ok" ? "answering" : reach === "unreachable" ? "not answering" : "checking"}`}
            accessibilityHint="Opens setup"
          >
            <Text style={type.title} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {title}
            </Text>
            <View style={styles.context}>
              <Text style={type.footnote} numberOfLines={1}>
                {areaLabel} · {languageLabel}
              </Text>
              <View style={[styles.dot, { backgroundColor: reach === "ok" && !needsConnect && mission ? color.ok : reach === "unreachable" ? color.bad : color.textDim }]} />
              <Text style={[type.footnote, styles.contextLast, reach === "unreachable" && styles.badText]} numberOfLines={1}>
                {needsConnect ? "Not connected" : `${coordinatorName} · ${mission ? "Reporting" : "Waiting for mission"}`}
              </Text>
            </View>
          </Pressable>
          <Pressable onPress={openSetup} style={({ pressed }) => [styles.gear, pressed && styles.gearPressed]} accessibilityRole="button" accessibilityLabel="Setup">
            <Ionicons name="settings-outline" size={22} color={color.text} />
          </Pressable>
        </View>

        {notice}

        <View style={styles.talk}>
          <TalkButton state={busy} blocked={needsConnect ? "Connect first" : reach !== "ok" ? "Coordinator offline" : needsMission ? "Waiting for mission" : null} onPressIn={onPressIn} onPressOut={onPressOut} />
          <Text style={styles.status} numberOfLines={4} accessibilityLiveRegion="polite">
            {status}
          </Text>
        </View>
      </View>

      {developer ? <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
        <ScenarioCard
          scenarios={scenarios}
          scenarioId={effectiveScenarioId}
          onSelect={setScenarioId}
          results={stepResults}
          summary={scenarioSummary?.scenario === effectiveScenarioId ? scenarioSummary.text : null}
          running={busy === "scenario"}
          blocked={needsConnect || reach !== "ok" || needsMission || (busy !== "idle" && busy !== "scenario")}
          onPlay={playScenario}
          onStop={() => (cancelScenarioRef.current = true)}
          onSendStep={sendOneStep}
        />
      </ScrollView> : null}

      <SetupSheet
        visible={setupOpen}
        onClose={() => setSetupOpen(false)}
        locked={busy !== "idle"}
        languages={LANGUAGES}
        language={language}
        onLanguage={setLanguage}
        serverUrl={serverUrl}
        hosts={hosts}
        onConnectHost={connectTo}
        onServerUrl={(url) => { setConnectedHost(null); setListed(null); setServerUrl(url); }}
        reach={reach}
        developer={developer}
        onDeveloper={setDeveloper}
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
  missionMore: { flex: 1 },
  noRecord: { marginHorizontal: space.lg, marginTop: space.sm },
  talk: { alignItems: "center", gap: space.sm, paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.lg },
  status: { ...type.body, textAlign: "center", alignSelf: "stretch" },
  scroll: { flex: 1 },
  scrollBody: { width: "100%", maxWidth: 560, alignSelf: "center", paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.xxl + space.lg, gap: space.lg },
});
