"use client";

/**
 * The command post's replay: the state of the bar, the day's stretches, the playback clock and
 * the deep link. It was the replay section of CommandPost; the map, the decisions and the panels
 * still own their own state [276].
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { barRange, dayStretches, stepAlong, stretchAt, type ShownMission, type Stretch } from "@/lib/reports/timeline";
import type { MissionState, SessionState } from "@/lib/reports/fold";
import type { MissionSummary } from "@/lib/reports/types";

const STEP_MS = 200;

export interface UseReplayOptions {
  session: string | null;
  mission: MissionState | null;
  missions: MissionSummary[];
  full: Pick<SessionState, "first" | "last">;
  now: number;
  moment: number | null;
  deepTrack: number | null;
  onEnterMission: (code: string) => void;
  onCloseTimeline: () => void;
  onCloseUnit: () => void;
  onSetFollow: (on: boolean) => void;
  onPickTrack: (n: number | null) => void;
  /** How much replay time one clock tick adds at 1×; the map's animation uses the same step. */
  stepMs?: number;
}

export interface UseReplay {
  mode: "live" | "replay";
  replayT: number;
  playing: boolean;
  replayOpen: boolean;
  speed: number;
  barCompact: boolean;
  barZoom: boolean;
  setMode: (mode: "live" | "replay") => void;
  setReplayT: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  setReplayOpen: (open: boolean) => void;
  setSpeed: (speed: number) => void;
  setBarCompact: (compact: boolean) => void;
  setBarZoom: (zoom: boolean | ((z: boolean) => boolean)) => void;
  stretches: Stretch[];
  rangeStart: number;
  rangeEnd: number;
  shownStretch: Stretch | null;
  dayCodes: string;
  barLo: number;
  barHi: number;
  barStretches: Stretch[];
  sliderValue: number;
  barSpan: number;
  sliderMission: Stretch | null;
  goLive: () => void;
  scrub: (t: number) => void;
  togglePlay: () => void;
}

export function useReplay(o: UseReplayOptions): UseReplay {
  const { session, mission, missions, full, now, moment, deepTrack, onEnterMission, onCloseTimeline, onCloseUnit, onSetFollow, onPickTrack } = o;
  const [mode, setMode] = useState<"live" | "replay">("live");
  const [replayT, setReplayT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [barCompact, setBarCompact] = useState(true);
  const [barZoom, setBarZoom] = useState(false);
  const replayRef = useRef<{ t: number; end: number; stretches: Stretch[]; session: string | null }>({ t: 0, end: 0, stretches: [], session: null });
  const stepMs = o.stepMs ?? STEP_MS;

  // The missions opened in this area on the shown one's day, each a stretch from its start to its
  // end, gray between. Until the log of a mission moved to is read, its line in the list stands in.
  // A session from before missions has only its own entries.
  const stretches = useMemo<Stretch[]>(() => {
    if (!session) return [];
    const shown: ShownMission | undefined = mission
      ? { code: session, name: mission.name, area: mission.area, opened: mission.opened, ended: mission.ended, last: full.last ?? mission.opened }
      : missions.find((m) => m.code === session);
    if (shown) return dayStretches(missions, shown, now);
    return full.first != null && full.last != null ? [{ code: session, name: session, start: full.first, end: full.last, open: false }] : [];
  }, [session, mission, full.first, full.last, missions, now]);
  const { lo: rangeStart, hi: rangeEnd } = useMemo(() => barRange(stretches), [stretches]);
  const shownStretch = stretches.find((s) => s.code === session) ?? null;
  const dayCodes = stretches.map((s) => s.code).join(" ");

  useEffect(() => {
    replayRef.current = { t: replayT, end: rangeEnd, stretches, session: session };
  }, [replayT, rangeEnd, stretches, session]);

  const goLive = useCallback(() => {
    setPlaying(false);
    setMode("live");
    onSetFollow(true);
  }, [onSetFollow]);

  const scrub = useCallback(
    (t: number) => {
      setMode("replay");
      setReplayT(t);
      const { stretches: day, session: shown } = replayRef.current;
      const s = stretchAt(day, t, shown);
      if (s && s.code !== shown) {
        replayRef.current.session = s.code;
        onEnterMission(s.code);
      }
    },
    [onEnterMission],
  );

  // A shared link opens the mission at its moment, with the track that was open [273].
  const appliedDeepLink = useRef("");
  useEffect(() => {
    if (moment == null || !session || !stretches.length) return;
    const key = `${session}:${moment}:${deepTrack ?? ""}`;
    if (appliedDeepLink.current === key) return;
    appliedDeepLink.current = key;
    queueMicrotask(() => {
      onCloseTimeline();
      onCloseUnit();
      setBarCompact(false);
      onSetFollow(false);
      setPlaying(false);
      setReplayOpen(true);
      scrub(moment!);
      if (deepTrack != null) onPickTrack(deepTrack);
    });
  }, [moment, deepTrack, session, stretches.length, scrub, onCloseTimeline, onCloseUnit, onSetFollow, onPickTrack]);

  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // From live, or from the end, a replay starts at the beginning of the mission on screen.
    if (mode === "live" || replayRef.current.t >= replayRef.current.end) setReplayT(shownStretch?.start ?? rangeStart);
    setMode("replay");
    onSetFollow(true);
    setPlaying(true);
  }, [playing, mode, shownStretch, rangeStart, onSetFollow]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const { t, end, stretches: day, session: shown } = replayRef.current;
      if (t + stepMs * speed >= end) {
        // The replay has caught up with the present, or the day's last end: back to live.
        setPlaying(false);
        setMode("live");
        return;
      }
      // The gray between two missions is skipped: the replay goes on at the next one's start.
      const next = stepAlong(day, t, 1, stepMs * speed);
      setReplayT(next);
      const s = stretchAt(day, next, shown);
      if (s && s.code !== shown) {
        replayRef.current.session = s.code;
        onEnterMission(s.code);
      }
    }, stepMs);
    return () => clearInterval(id);
  }, [playing, speed, stepMs, onEnterMission]);

  const barLo = barZoom && shownStretch ? shownStretch.start : rangeStart;
  const barHi = barZoom && shownStretch ? shownStretch.end : rangeEnd;
  const barStretches = barZoom && shownStretch ? [shownStretch] : stretches;
  const sliderValue = mode === "live" ? (shownStretch?.end ?? rangeEnd) : Math.min(Math.max(replayT, barLo), barHi);
  const barSpan = barHi - barLo;
  const sliderMission = stretchAt(stretches, sliderValue, session);

  return {
    mode,
    replayT,
    playing,
    replayOpen,
    speed,
    barCompact,
    barZoom,
    setMode,
    setReplayT,
    setPlaying,
    setReplayOpen,
    setSpeed,
    setBarCompact,
    setBarZoom,
    stretches,
    rangeStart,
    rangeEnd,
    shownStretch,
    dayCodes,
    barLo,
    barHi,
    barStretches,
    sliderValue,
    barSpan,
    sliderMission,
    goLive,
    scrub,
    togglePlay,
  };
}
