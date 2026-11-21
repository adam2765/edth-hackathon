"use client";

/**
 * The command post: the shared map a person at the base watches and keeps. It opens and ends
 * missions, places and changes tracks by hand, and answers a unit's question when the unit cannot
 * tap. It polls the mission's log every second and rebuilds the picture with foldLog(), so the live
 * view and a replay are the same code: a replay is the log read up to a moment. What the command
 * post does goes into the same log, through the coordinator, so a replay shows it too.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ExpressionSpecification, GeoJSONSource, MapMouseEvent, Map as MLMap, Marker } from "maplibre-gl";
import { bearingDeg, destination, distanceM } from "@/lib/geo/geo";
import { AREAS, DEFAULT_AREA, isAreaId, type AreaId } from "@/lib/geo/areas";
import { AFFILIATION_COLOUR, AFFILIATION_LABEL, AFFILIATIONS, describeTrack, HEADING_DEG, TRACK_KINDS, trackSymbolCode } from "@/lib/geo/trackKinds";
import type { Affiliation, TrackKind } from "@/lib/geo/types";
import { CP_COLOUR, colourMap, describeSender, FADE_AFTER_MS, foldLog, TRACK_OLD_AFTER_MS, type FeedItem, type TrackState, type UnitState } from "@/lib/reports/fold";
import { PLOT_RADIUS_DEFAULT } from "@/lib/reports/plot";
import { barRange, dayStretches, detents, keyTarget, settle, stepAlong, stretchAt, type ShownMission, type Stretch } from "@/lib/reports/timeline";
import { COMMAND_POST, callsignGiven, callsignOf, sessionCode, type HeldEntry, type HeldReason, type HeldReply, type LogEntry, type MissionListReply, type MissionSummary, type PlacesReply, type PlotReply, type SessionLogReply, type StartPoint, type TaskReply } from "@/lib/reports/types";
import { centred, declutter, outside, textBox, type Mark, type Rect } from "./declutter";
import MissionPanel from "./MissionPanel";
import { AFFILIATION_KEY, DEFAULT_WHAT, describeWhat, DraftCard, TrackCard, TrackPalette, trackSvg, type MilSymbol, type TrackWhat } from "./TrackTools";
import { SendDrone, TrackRecon, type TaskBody } from "./ReconTools";
import styles from "./CommandPost.module.css";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const POLL_MS = 1000;
/** How often the list of missions is read: to find one with none on screen, and for the replay bar. */
const LIST_POLL_MS = 5000;
const STEP_MS = 200;
const SPEEDS = [1, 10, 30];
/** How close to a mission's start or end, in pixels on the bar, the replay is pulled onto it. */
const DETENT_PX = 8;
/** The replay bar's thumb, in CSS pixels: its middle runs from half this in from each end. */
const THUMB_PX = 16;
const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const EMPTY_LOG: LogEntry[] = [];
// The bottom leaves room for the replay bar; the right for the zoom buttons; the sides for a
// label, which is wider than its marker.
const MAP_PADDING = { top: 80, bottom: 130, left: 90, right: 90 };

type LatLon = { lat: number; lon: number };

function circleRing(c: LatLon, radiusM: number): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const p = destination(c, (i * 360) / 64, radiusM);
    ring.push([p.lon, p.lat]);
  }
  return ring;
}

function arrowFeatures(from: LatLon, to: LatLon, color: string, op: number): GeoJSON.Feature[] {
  const b = bearingDeg(from, to);
  const len = Math.max(18, Math.min(60, distanceM(from, to) * 0.25));
  const l = destination(to, b + 180 - 28, len);
  const r = destination(to, b + 180 + 28, len);
  const base = destination(to, b + 180, len * 0.8);
  return [
    { type: "Feature", properties: { part: "shaft", color, op }, geometry: { type: "LineString", coordinates: [[from.lon, from.lat], [base.lon, base.lat]] } },
    { type: "Feature", properties: { part: "head", color, op }, geometry: { type: "Polygon", coordinates: [[[to.lon, to.lat], [l.lon, l.lat], [r.lon, r.lat], [to.lon, to.lat]]] } },
  ];
}

/** Units within a metre of each other stand on one spot: they share one dot's place and one label. */
function spotKey(p: LatLon): string {
  return `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
}

type Spot = { lat: number; lon: number; name: string; when: string; allSilent: boolean };

/**
 * One label for each spot where units stand. Units on the same spot (often the start point) share
 * it, so call signs do not overprint. "silent" is written out, because a faded marker alone is easy
 * to miss on a projector.
 */
function unitSpots(units: UnitState[], isSilent: (u: UnitState) => boolean): Map<string, Spot> {
  const together = new Map<string, UnitState[]>();
  for (const u of units) {
    if (!u.position || u.positionTs == null) continue;
    const k = spotKey(u.position);
    together.set(k, [...(together.get(k) ?? []), u]);
  }
  const out = new Map<string, Spot>();
  for (const [k, group] of together) {
    const p = group[0].position!;
    const newest = Math.max(...group.map((x) => x.positionTs ?? 0));
    const allSilent = group.every(isSilent);
    const name = group.map((x) => (isSilent(x) && !allSilent ? `${x.callsign} (silent)` : x.callsign)).join(" · ");
    const when = `${p.estimated ? "≈ " : ""}${fmtTime(newest)}${allSilent ? " · silent" : ""}`;
    out.set(k, { lat: p.lat, lon: p.lon, name, when, allSilent });
  }
  return out;
}

// Always the 24-hour clock with seconds, whatever the browser's language is set to. Local time.
const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function fmtTime(ts: number): string {
  return CLOCK.format(ts);
}

/** The day, when it is not today's: an ended mission is often yesterday's. Null for today. */
function otherDay(ts: number, now: number): string | null {
  const d = DAY.format(ts);
  return now > 0 && d !== DAY.format(now) ? d : null;
}

/** A moment for a label: the time, with the day in front when it is not today. */
function fmtWhen(ts: number, now: number): string {
  const d = otherDay(ts, now);
  return d ? `${d}, ${fmtTime(ts)}` : fmtTime(ts);
}

function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function fmtSpan(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * A wide screen is taken for a projector or a wall screen, read from across the room: the panels
 * and the map's labels are drawn larger. The same steps as `--z` in CommandPost.module.css.
 */
function screenScale(): number {
  const w = window.innerWidth;
  return w >= 2300 ? 1.6 : w >= 1700 ? 1.25 : 1;
}

// The page's address says which mission is shown, so a projector's tab can be reloaded or shared.
const LOCATION_EVENT = "cp:location";
function subscribeLocation(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener(LOCATION_EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(LOCATION_EVENT, cb);
  };
}

function showSession(code: string | null, replace = false) {
  const q = new URLSearchParams(window.location.search);
  if (code) q.set("session", code);
  else q.delete("session");
  const qs = q.toString();
  history[replace ? "replaceState" : "pushState"](null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  window.dispatchEvent(new Event(LOCATION_EVENT));
}

type UnitTone = "placed" | "estimate" | "ask" | "none" | "silent";

/** The size of a track's symbol on the map, before the big-screen steps. The frame is about 1.5 times this. */
const TRACK_SYMBOL_SIZE = 24;

/**
 * The way a track is moving, as a bold arrow from the middle of its symbol. milsymbol's own
 * indicator is a thin black line that hardly shows past the frame, so this one is drawn on its own,
 * under the symbol: only the part outside the frame shows. In screen pixels, for a symbol of size s.
 */
function headingArrow(s: number) {
  return { len: Math.round(2.4 * s), shaft: Math.max(4, Math.round(0.22 * s)), headW: Math.round(0.95 * s), headL: Math.round(0.8 * s), halo: Math.max(2, Math.round(0.1 * s)) };
}

/** The arrow's image: pointing up, dark with a white edge, its tail at the bottom middle. */
function headingArrowImage(s: number): ImageData | null {
  const a = headingArrow(s);
  const r = 2;
  const w = a.headW + 2 * a.halo;
  const h = a.len + a.halo;
  const canvas = document.createElement("canvas");
  canvas.width = w * r;
  canvas.height = h * r;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(r, r);
  const x = w / 2;
  const tip = a.halo;
  const neck = tip + a.headL;
  ctx.beginPath();
  ctx.moveTo(x, tip);
  ctx.lineTo(x + a.headW / 2, neck);
  ctx.lineTo(x + a.shaft / 2, neck);
  ctx.lineTo(x + a.shaft / 2, h);
  ctx.lineTo(x - a.shaft / 2, h);
  ctx.lineTo(x - a.shaft / 2, neck);
  ctx.lineTo(x - a.headW / 2, neck);
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = 2 * a.halo;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#16212c";
  ctx.fill();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * A track in two lines: what it is and where, then who saw it or placed it. An open question comes
 * first, as for a unit. A track is a sighting, so the second line always names who reported it:
 * a unit, or the command post when a person placed it there.
 */
function trackStatus(t: TrackState, old: boolean): { main: string; sub: string; tone: UnitTone } {
  // "hostile vehicle ×2" without its first word: the pill beside the name already says whose it is.
  const what = describeTrack(t).replace(/^\S+\s*/, "") || "kind not said";
  const extra = `${t.changed && !t.plotted ? ` · changed by ${t.changed.by}` : ""}${t.note ? ` · ${t.note}` : ""}`;
  if (t.pendingReport) return { main: `${what} · where it is waits for an answer`, sub: `asked ${t.seenBy}`, tone: "ask" };
  const p = t.position;
  if (t.gone != null) return { main: `${what} · off the map`, sub: `marked gone by ${COMMAND_POST}`, tone: "silent" };
  if (!p) return { main: `${what} · not placed`, sub: `reported by ${t.seenBy}${extra}`, tone: "none" };
  const moving = t.heading ? ` · moving ${t.heading.replace("_", "-")}, as said` : "";
  const who = t.plotted ? `placed by ${t.seenBy}` : `seen by ${t.seenBy}`;
  return { main: `${what} · ${p.estimated ? "≈ " : ""}${p.label} · ±${p.radius_m} m`, sub: `${who}${moving}${extra}`, tone: old ? "silent" : p.estimated ? "estimate" : "placed" };
}

/**
 * What the command post is doing on the map: placing a new track, moving one, or changing what one
 * is. `at` is where the track would go, once the map was clicked or a place picked; `label` is the
 * name the coordinator will give it, filled in when the answer comes.
 */
type Draft = { lat: number; lon: number; place?: string; label: string | null; minRadius?: number };
type Tool =
  | { kind: "place"; what: TrackWhat; radius: number; at: Draft | null }
  | { kind: "move"; n: number; radius: number; at: Draft | null }
  | { kind: "edit"; n: number; what: TrackWhat };

/** An answer the command post is about to give for a unit: asked once more before it is saved. */
type Answering = { reportId: string; choice: string | null; name: string; callsign: string };

/** What the operator is about to do with a held radio report: asked once more first [203]. */
type Settling = { held: string; action: "assign" | "add" | "dismiss"; callsign: string | null };

/** Why a radio report waits, as one word on its pill. */
const HELD_TAG: Record<HeldReason, string> = { which: "Which unit?", unknown: "Not on roster", none: "No call sign", far: "Too far" };

function settleText(s: Settling, h: HeldEntry): string {
  if (s.action === "dismiss") return "Dismiss this report? Nothing moves.";
  if (s.action === "add") return `Add ${s.callsign} to the roster and give it this report?`;
  return `Give this report to ${s.callsign}? Its words are read again from where ${s.callsign} was at ${fmtTime(h.ts)}.`;
}

/**
 * A unit's state as one word (so it is never told by colour alone) and one line of detail.
 * An open question comes first, even for a silent unit: it is the one that needs the operator.
 */
function unitStatus(u: UnitState, silent: boolean, silentAtEnd: string | null): { tag: string; text: string; tone: UnitTone } {
  if (u.pending) return { tag: "Awaiting answer", text: u.pending.question, tone: "ask" };
  // On the roster, and no report from it yet [201].
  if (u.lastHeard === 0) return { tag: "On roster", text: "Not heard yet.", tone: "none" };
  const p = u.position;
  const where = p ? `${p.label} · ±${p.radius_m} m` : "";
  if (silent) {
    const last = p ? `Last at ${p.estimated ? "≈ " : ""}${where}` : "Never placed.";
    return { tag: "Silent", text: silentAtEnd ? `Silent for ${silentAtEnd} when the mission ended. ${last}` : last, tone: "silent" };
  }
  if (!p) return { tag: "Not placed", text: u.joined != null ? "Joined. Waiting for a check-in." : "Waiting for a check-in.", tone: "none" };
  return p.estimated ? { tag: "≈ Estimate", text: where, tone: "estimate" } : { tag: "Placed", text: where, tone: "placed" };
}

export default function CommandPost() {
  // ?session= picks the mission; with none, the newest open one is shown. ?area= pins the map to one area.
  const search = useSyncExternalStore(subscribeLocation, () => window.location.search, () => "");
  const { session, fixedArea } = useMemo(() => {
    const q = new URLSearchParams(search);
    const a = q.get("area");
    return { session: sessionCode(q.get("session")), fixedArea: isAreaId(a) ? a : null };
  }, [search]);

  // The logs read so far, by session. Moving the replay into another mission of the day shows its
  // log at once; the one on screen is polled for what is new.
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({});
  const logsRef = useRef(logs);
  const entries = useMemo(() => (session ? (logs[session] ?? EMPTY_LOG) : EMPTY_LOG), [logs, session]);
  /** The missions on this coordinator, for the replay bar. */
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** With no mission in the address: still looking for one, or none is open. */
  const [noMission, setNoMission] = useState(false);
  const [stored, setStored] = useState<boolean | null>(null);
  const [lastOk, setLastOk] = useState(0);
  const [now, setNow] = useState(0);
  const otherMissions = missions.filter((m) => m.code !== session && m.ended == null && m.reports > 0 && now - m.last < 120_000);
  const [mode, setMode] = useState<"live" | "replay">("live");
  const [replayT, setReplayT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [follow, setFollow] = useState(true);
  const [manualArea, setManualArea] = useState<AreaId | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  /** The map has taken long to load: with no network it never does, and the page should say so. */
  const [mapSlow, setMapSlow] = useState(false);
  /** Bumped when the map changes size, so following refits (a projector often changes the window). */
  const [mapSize, setMapSize] = useState("");
  /** Placing, moving or changing a track; null when the command post is only watching. */
  const [tool, setTool] = useState<Tool | null>(null);
  /** The track picked on the map or in the list, shown in its card. */
  const [picked, setPicked] = useState<number | null>(null);
  /** Where the information came from, typed under a draft. */
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [toolError, setToolError] = useState<string | null>(null);
  /** A short line over the map after a change was saved ("Track 7 placed"). */
  const [notice, setNotice] = useState<string | null>(null);
  const [answering, setAnswering] = useState<Answering | null>(null);
  const [settling, setSettling] = useState<Settling | null>(null);
  /** A call sign the operator types for a held report, when the words gave none [203]. */
  const [newSign, setNewSign] = useState<{ held: string; text: string }>({ held: "", text: "" });

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  /** The symbol library (milsymbol), loaded on its own so the map does not wait for it. */
  const [symbols, setSymbols] = useState<MilSymbol | null>(null);
  /**
   * For each symbol image on the map: how far it is drawn from its middle, so its anchor sits on
   * the point, and its width and height in pixels.
   */
  const trackIcons = useRef(new Map<string, [number, number, number, number]>());
  /** Bumped after every zoom or turn of the map: where track symbols are drawn is worked out again. */
  const [zoomKey, setZoomKey] = useState(0);
  const candMarkers = useRef<Marker[]>([]);
  const countRef = useRef(0);
  /** What the replay's timer and the bar's handlers read between renders. */
  const replayRef = useRef<{ t: number; end: number; stretches: Stretch[]; session: string | null }>({ t: 0, end: 0, stretches: [], session: null });
  /** Reads the log at once, after the command post changed it, rather than at the next poll. */
  const pollNow = useRef<() => void>(() => {});
  /** What a click on the map does; set below, read by the handler the map was given once. */
  const mapClick = useRef<(e: MapMouseEvent) => void>(() => {});
  /** The track symbol being placed or moved: a marker that can be dragged. */
  const draftMarker = useRef<Marker | null>(null);

  // ---------- which mission ----------
  // No mission in the address: show the newest open one, or open the missions menu.
  // It keeps looking, so a mission opened from another screen shows up here, and the connection
  // light stays true while no mission is shown.
  useEffect(() => {
    if (session) return;
    let stop = false;
    let first = true;
    const look = async () => {
      try {
        const res = await fetch("/api/sessions", { cache: "no-store" });
        if (!res.ok || stop) return;
        const data = (await res.json()) as MissionListReply;
        if (stop) return;
        setStored(data.stored);
        setLastOk(Date.now());
        setMissions(data.missions);
        const open = data.missions.find((m) => m.ended == null);
        if (open) showSession(open.code, true);
        else {
          setNoMission(true);
          if (data.stored && first) setPanelOpen(true);
        }
        first = false;
      } catch {
        // The connection light shows it.
      }
    };
    look();
    const id = setInterval(look, LIST_POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [session]);

  // With a mission on screen, the list is still read: the replay bar shows the day's other missions.
  // It does not start over when the replay moves into another mission.
  const hasSession = session != null;
  useEffect(() => {
    if (!hasSession) return;
    let stop = false;
    const look = async () => {
      try {
        const res = await fetch("/api/sessions", { cache: "no-store" });
        if (!res.ok || stop) return;
        const data = (await res.json()) as MissionListReply;
        if (!stop) setMissions(data.missions);
      } catch {
        // The bar keeps the list it has.
      }
    };
    look();
    const id = setInterval(look, LIST_POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [hasSession]);

  const pickSession = useCallback((code: string | null) => {
    setPlaying(false);
    setMode("live");
    setFollow(true);
    setConfirmEnd(false);
    setActionError(null);
    setNoMission(code == null);
    showSession(code);
  }, [setPlaying]);

  // ---------- the log ----------
  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  useEffect(() => {
    if (!session) return;
    let stop = false;
    let busy = false;
    let loaded = false;
    // A log read before (another mission of the day, visited in a replay) goes on from where it was.
    countRef.current = logsRef.current[session]?.length ?? 0;
    const poll = async () => {
      if (busy || stop) return;
      busy = true;
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(session)}?after=${countRef.current}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`log answered ${res.status}`);
        const data = (await res.json()) as SessionLogReply;
        if (stop) return;
        setStored(data.stored);
        setLastOk(Date.now());
        if (data.total < countRef.current) {
          // The log was cleared: start over.
          countRef.current = 0;
          setLogs((all) => ({ ...all, [session]: [] }));
        } else if (data.entries.length || !loaded) {
          const from = countRef.current;
          countRef.current += data.entries.length;
          setLogs((all) => ({ ...all, [session]: from > 0 ? [...(all[session] ?? []), ...data.entries] : data.entries }));
          setManualArea(null);
        }
        loaded = true;
      } catch {
        // The connection light shows it; the next poll tries again.
      } finally {
        busy = false;
      }
    };
    poll();
    pollNow.current = () => void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
      pollNow.current = () => {};
    };
  }, [session]);

  // A clock for "silent for", fading and the connection light.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  // ---------- the picture ----------
  const colours = useMemo(() => colourMap(entries), [entries]);
  const full = useMemo(() => foldLog(entries, Number.POSITIVE_INFINITY, colours), [entries, colours]);
  const view = useMemo(() => (mode === "live" ? full : foldLog(entries, replayT, colours)), [mode, full, entries, replayT, colours]);
  const mission = full.mission;
  const ended = mission?.ended ?? null;
  // The moment the picture stands for. An ended mission is shown as it was when it ended, so its
  // units do not all read as silent for the hours since.
  const effNow = mode === "live" ? (ended ?? now) : replayT;
  const area: AreaId = fixedArea ?? mission?.area ?? manualArea ?? view.area ?? DEFAULT_AREA;
  const isSilent = useCallback((u: UnitState) => effNow > 0 && effNow - u.lastHeard > FADE_AFTER_MS, [effNow]);
  /** A track nobody has reported for a while: its place is an old sighting, and the page says so. */
  const isOld = useCallback((t: TrackState) => effNow > 0 && effNow - t.seenTs > TRACK_OLD_AFTER_MS, [effNow]);

  // ---------- the replay bar ----------
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
    replayRef.current = { t: replayT, end: rangeEnd, stretches, session };
  }, [replayT, rangeEnd, stretches, session]);

  // The day's other missions are read once, so the replay moves into one without a wait.
  const fetching = useRef(new Set<string>());
  useEffect(() => {
    for (const code of dayCodes ? dayCodes.split(" ") : []) {
      if (code === session || logsRef.current[code] || fetching.current.has(code)) continue;
      fetching.current.add(code);
      fetch(`/api/sessions/${encodeURIComponent(code)}`, { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<SessionLogReply>) : null))
        .then((data) => {
          // The poll of the mission on screen may have read it first; that copy is kept.
          if (data) setLogs((all) => (all[code] ? all : { ...all, [code]: data.entries }));
        })
        .catch(() => {})
        .finally(() => fetching.current.delete(code));
    }
  }, [dayCodes, session]);

  // ---------- replay ----------
  const goLive = useCallback(() => {
    setPlaying(false);
    setMode("live");
    setFollow(true);
  }, [setPlaying]);

  /** The replay has moved into another mission of the day: show it. What was picked belongs to the old one. */
  const enterMission = useCallback((code: string) => {
    replayRef.current.session = code;
    setPicked(null);
    setTool(null);
    setAnswering(null);
    setConfirmEnd(false);
    showSession(code, true);
  }, [setPicked, setAnswering]);

  const scrub = useCallback(
    (t: number) => {
      setMode("replay");
      setReplayT(t);
      const { stretches: day, session: shown } = replayRef.current;
      const s = stretchAt(day, t, shown);
      if (s && s.code !== shown) enterMission(s.code);
    },
    [enterMission],
  );

  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // From live, or from the end, a replay starts at the beginning of the mission on screen.
    if (mode === "live" || replayRef.current.t >= replayRef.current.end) setReplayT(shownStretch?.start ?? rangeStart);
    setMode("replay");
    setFollow(true);
    setPlaying(true);
  }, [playing, mode, shownStretch, rangeStart, setPlaying]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const { t, end, stretches: day, session: shown } = replayRef.current;
      if (t + STEP_MS * speed >= end) {
        // The replay has caught up with the present, or the day's last end: back to live.
        setPlaying(false);
        setMode("live");
        return;
      }
      // The gray between two missions is skipped: the replay goes on at the next one's start.
      const next = stepAlong(day, t, 1, STEP_MS * speed);
      setReplayT(next);
      const s = stretchAt(day, next, shown);
      if (s && s.code !== shown) enterMission(s.code);
    }, STEP_MS);
    return () => clearInterval(id);
  }, [playing, speed, enterMission]);

  // ---------- map ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !mapEl.current) return;
      ml.setWorkerUrl("/maplibre-gl-worker.mjs");
      mlRef.current = ml;
      const start = AREAS[DEFAULT_AREA];
      const map = new ml.Map({
        container: mapEl.current,
        style: STYLE_URL,
        center: [start.centre.lon, start.centre.lat],
        zoom: start.zoom,
        attributionControl: { compact: false, customAttribution: "© OpenStreetMap contributors" },
      });
      map.addControl(new ml.NavigationControl({ showCompass: true }), "top-right");
      // Moving the map by hand stops it following the units until "Follow" is pressed.
      map.on("movestart", (e) => {
        if ((e as { originalEvent?: Event }).originalEvent) setFollow(false);
      });
      map.on("resize", () => {
        const c = map.getContainer();
        setMapSize(`${c.clientWidth}x${c.clientHeight}`);
      });
      // Two places 100 m apart overlap at one zoom and not at the next.
      const bump = () => setZoomKey((z) => z + 1);
      for (const ev of ["zoomend", "rotateend", "pitchend"] as const) map.on(ev, bump);
      // One handler for the life of the map; what a click does depends on what the command post is doing.
      map.on("click", (e) => mapClick.current(e));
      map.on("load", () => {
        for (const id of ["start", "trail", "accuracy", "arrow", "target", "pos", "track-acc", "track-trail", "track-sight", "track-task", "track-leader", "track", "draft"]) map.addSource(id, { type: "geojson", data: EMPTY_FC });
        // The mission's start point: a dashed grey circle with its name, under everything else.
        map.addLayer({ id: "start-fill", type: "fill", source: "start", filter: ["==", "$type", "Polygon"], paint: { "fill-color": "#475569", "fill-opacity": 0.06 } });
        map.addLayer({ id: "start-line", type: "line", source: "start", filter: ["==", "$type", "Polygon"], paint: { "line-color": "#475569", "line-width": 1.5, "line-dasharray": [1, 2] } });
        map.addLayer({
          id: "start-label",
          type: "symbol",
          source: "start",
          filter: ["==", "$type", "Point"],
          layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-anchor": "bottom", "text-allow-overlap": true },
          paint: { "text-color": "#334155", "text-halo-color": "#ffffff", "text-halo-width": 2 },
        });
        // A silent unit's features carry op 0.35, everything else 1.
        const op: ExpressionSpecification = ["get", "op"];
        map.addLayer({ id: "trail-line", type: "line", source: "trail", filter: ["==", "$type", "LineString"], paint: { "line-color": ["get", "color"], "line-width": 3, "line-dasharray": [2, 2], "line-opacity": ["*", 0.75, op] } });
        map.addLayer({ id: "trail-pts", type: "circle", source: "trail", filter: ["==", "$type", "Point"], paint: { "circle-radius": 4, "circle-color": ["get", "color"], "circle-opacity": op, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5, "circle-stroke-opacity": op } });
        map.addLayer({ id: "acc-fill", type: "fill", source: "accuracy", paint: { "fill-color": ["get", "color"], "fill-opacity": ["*", 0.16, op] } });
        map.addLayer({ id: "acc-line", type: "line", source: "accuracy", filter: ["!=", "estimated", true], paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": ["*", 0.85, op] } });
        // An estimate (from a movement) has a dashed circle, like the ≈ before its time.
        map.addLayer({ id: "acc-line-est", type: "line", source: "accuracy", filter: ["==", "estimated", true], paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [3, 2], "line-opacity": ["*", 0.85, op] } });
        // Tracks: what a unit saw. Their circles and trails lie under every unit's own markings.
        map.addLayer({ id: "track-acc-fill", type: "fill", source: "track-acc", paint: { "fill-color": ["get", "color"], "fill-opacity": ["*", 0.12, op] } });
        map.addLayer({ id: "track-acc-line", type: "line", source: "track-acc", filter: ["!=", "estimated", true], paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": ["*", 0.85, op] } });
        map.addLayer({ id: "track-acc-line-est", type: "line", source: "track-acc", filter: ["==", "estimated", true], paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [3, 2], "line-opacity": ["*", 0.85, op] } });
        map.addLayer({ id: "track-trail-line", type: "line", source: "track-trail", paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-dasharray": [2, 2], "line-opacity": ["*", 0.7, op] } });
        // The line of sight: from where the observer was to what they saw, dotted in the observer's
        // colour. It has no arrowhead: it says who saw it from where, and nothing else.
        map.addLayer({ id: "track-sight-line", type: "line", source: "track-sight", layout: { "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-dasharray": [0.1, 2.2], "line-opacity": 0.85 } });
        // Recon: a friendly drone or drone team the command post sent to look at a track [234]. A
        // solid line in the friendly colour, with no arrowhead: who is looking at what, nothing else.
        map.addLayer({ id: "track-task-line", type: "line", source: "track-task", layout: { "line-cap": "round" }, paint: { "line-color": AFFILIATION_COLOUR.friendly, "line-width": 2, "line-opacity": 0.8 } });
        map.addLayer({ id: "arrow-shaft", type: "line", source: "arrow", filter: ["==", "part", "shaft"], layout: { "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": op } });
        map.addLayer({ id: "arrow-head", type: "fill", source: "arrow", filter: ["==", "part", "head"], paint: { "fill-color": ["get", "color"], "fill-opacity": op } });
        map.addLayer({ id: "target", type: "circle", source: "target", paint: { "circle-radius": 10, "circle-color": "rgba(255,255,255,0.35)", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2, "circle-stroke-opacity": op } });
        // A symbol drawn off its point, so it hides no unit and no other track: a thin line from the
        // symbol back to the point, and a small dot in the track's colour on the point itself.
        map.addLayer({ id: "track-leader-line", type: "line", source: "track-leader", filter: ["==", "$type", "LineString"], layout: { "line-cap": "round" }, paint: { "line-color": "#16212c", "line-width": 1.5, "line-opacity": ["*", 0.7, op] } });
        map.addLayer({ id: "track-anchor", type: "circle", source: "track-leader", filter: ["==", "$type", "Point"], paint: { "circle-radius": 4, "circle-color": ["get", "color"], "circle-opacity": op, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5, "circle-stroke-opacity": op } });
        // The track picked on the map or in the list: a blue ring round its symbol.
        map.addLayer({ id: "track-picked", type: "circle", source: "track", filter: ["==", "picked", true], paint: { "circle-radius": 24, "circle-color": "rgba(44,156,255,0.12)", "circle-stroke-color": "#2c9cff", "circle-stroke-width": 3 } });
        // Where a track being placed or moved would go: a dashed circle and, for a move, a dashed
        // line from where it is now. The symbol itself is a marker that can be dragged.
        map.addLayer({ id: "draft-fill", type: "fill", source: "draft", filter: ["==", "$type", "Polygon"], paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 } });
        map.addLayer({ id: "draft-line", type: "line", source: "draft", filter: ["!=", "$type", "Point"], paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [2, 2] } });
        // The way a track is moving, under its symbol. It turns with the map, so north stays north.
        map.addLayer({
          id: "track-heading",
          type: "symbol",
          source: "track",
          filter: ["has", "heading"],
          layout: {
            "icon-image": ["get", "arrow"],
            "icon-anchor": "bottom",
            "icon-rotate": ["get", "heading"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: { "icon-opacity": op },
        });
        // A track's standard symbol, with its number, what it is, and when and by whom it was seen.
        map.addLayer({
          id: "track-sym",
          type: "symbol",
          source: "track",
          layout: {
            "icon-image": ["get", "icon"],
            "icon-offset": ["array", "number", 2, ["get", "off"]],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "text-field": ["format", ["get", "name"], { "text-font": ["literal", ["Noto Sans Bold"]] }, "\n", {}, ["get", "when"], { "font-scale": 0.9 }],
            "text-font": ["Noto Sans Regular"],
            "text-size": 14,
            "text-line-height": 1.25,
            // Above the symbol: a unit's label hangs below its dot, so the two do not overprint
            // when a unit reports something at the landmark it stands at. Higher when the track's
            // arrow points up, so the arrow does not run through it.
            "text-offset": ["array", "number", 2, ["get", "textOff"]],
            "text-anchor": "bottom",
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: { "icon-opacity": op, "text-color": "#16212c", "text-halo-color": "#ffffff", "text-halo-width": 2.5, "text-opacity": ["get", "labelOp"] },
        });
        map.addLayer({ id: "pos", type: "circle", source: "pos", paint: { "circle-radius": 9, "circle-color": ["get", "color"], "circle-opacity": op, "circle-stroke-color": "#fff", "circle-stroke-width": 3, "circle-stroke-opacity": op } });
        // Call sign and time of the last update next to each marker, as in Lysk's brief. The call
        // sign is bold; the label keeps its own opacity, so a silent unit's name stays readable.
        map.addLayer({
          id: "pos-label",
          type: "symbol",
          source: "pos",
          layout: {
            "text-field": ["format", ["get", "name"], { "text-font": ["literal", ["Noto Sans Bold"]] }, "\n", {}, ["get", "when"], { "font-scale": 0.9 }],
            "text-font": ["Noto Sans Regular"],
            "text-size": 15,
            "text-line-height": 1.25,
            "text-offset": [0, 1.1],
            "text-anchor": "top",
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: { "text-color": "#16212c", "text-halo-color": "#ffffff", "text-halo-width": 2.5, "text-opacity": ["get", "labelOp"] },
        });
        // A track's symbol can be clicked to pick it.
        map.on("mouseenter", "track-sym", () => {
          if (!map.getCanvas().style.cursor) map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "track-sym", () => {
          if (map.getCanvas().style.cursor === "pointer") map.getCanvas().style.cursor = "";
        });
        setMapReady(true);
      });
      mapRef.current = map;
      if (process.env.NODE_ENV !== "production") (window as unknown as { __map: MLMap }).__map = map;
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // The symbol library is only needed once a track is reported, so it loads beside the map.
  useEffect(() => {
    let cancelled = false;
    import("milsymbol")
      .then((m) => {
        if (!cancelled) setSymbols(() => m.default);
      })
      .catch(() => {
        // Without it tracks still show in the lists, with their circles and labels on the map.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mapReady) return;
    const t = setTimeout(() => setMapSlow(true), 12_000);
    return () => clearTimeout(t);
  }, [mapReady]);

  // Draw every unit: marker with call sign and time, circle, trail, movement arrow.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const pos: GeoJSON.Feature[] = [];
    const acc: GeoJSON.Feature[] = [];
    const trail: GeoJSON.Feature[] = [];
    const arrows: GeoJSON.Feature[] = [];
    const targets: GeoJSON.Feature[] = [];
    // Units on the same spot share one label: the first unit of the spot carries it.
    const spots = unitSpots(view.units, isSilent);
    const labelled = new Set<string>();
    for (const u of view.units) {
      const op = isSilent(u) ? 0.35 : 1;
      const color = u.colour;
      const p = u.position;
      const pts = [...u.trail, ...(p ? [p] : [])];
      if (pts.length > 1) trail.push({ type: "Feature", properties: { color, op }, geometry: { type: "LineString", coordinates: pts.map((x) => [x.lon, x.lat]) } });
      for (const t of u.trail) trail.push({ type: "Feature", properties: { color, op }, geometry: { type: "Point", coordinates: [t.lon, t.lat] } });
      if (!p || u.positionTs == null) continue;
      const k = spotKey(p);
      const spot = spots.get(k);
      const first = !labelled.has(k);
      labelled.add(k);
      const name = first ? (spot?.name ?? u.callsign) : "";
      const when = first ? (spot?.when ?? "") : "";
      pos.push({ type: "Feature", properties: { color, op, name, when, labelOp: spot?.allSilent ? 0.7 : 1 }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
      acc.push({ type: "Feature", properties: { color, op, estimated: !!p.estimated }, geometry: { type: "Polygon", coordinates: [circleRing(p, p.radius_m)] } });
      if (p.heading_to) {
        // From the marker, the middle of the circle, so the trail stays visible up to it.
        if (distanceM(p, p.heading_to) > 5) arrows.push(...arrowFeatures(p, p.heading_to, color, op));
        targets.push({ type: "Feature", properties: { color, op }, geometry: { type: "Point", coordinates: [p.heading_to.lon, p.heading_to.lat] } });
      }
    }
    const set = (id: string, features: GeoJSON.Feature[]) => (map.getSource(id) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
    set("pos", pos);
    set("accuracy", acc);
    set("trail", trail);
    set("arrow", arrows);
    set("target", targets);
  }, [view, isSilent, mapReady]);

  // Draw every track: its symbol and label, its circle, where it was seen before, and the line of
  // sight from the unit that reported it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const k = screenScale();
    const sym: GeoJSON.Feature[] = [];
    const acc: GeoJSON.Feature[] = [];
    const trail: GeoJSON.Feature[] = [];
    const sight: GeoJSON.Feature[] = [];
    const leader: GeoJSON.Feature[] = [];
    // Each drone sent to look at a track, from the drone to the track [234]. Not drawn when either is gone or not placed.
    const task: GeoJSON.Feature[] = [];
    for (const d of view.tracks) {
      const seen = d.task ? view.tracks.find((t) => t.n === d.task!.n) : undefined;
      const a = d.position;
      const b = seen?.position;
      if (!a || !b || d.gone != null || seen!.gone != null || distanceM(a, b) < 5) continue;
      task.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[a.lon, a.lat], [b.lon, b.lat]] } });
    }
    // Each track's symbol and label, before it is laid out: lower numbers first, so an older track
    // keeps its spot and a new one moves.
    const drawn: { id: string; p: LatLon; color: string; op: number; props: Record<string, unknown>; label: string[]; icon: string; lift: number; arrow: Rect | null }[] = [];
    const trackText = Math.round(14 * k);
    const size = Math.round(TRACK_SYMBOL_SIZE * k);
    const ha = headingArrow(size);
    const arrowIcon = `track-heading:${size}`;
    if (symbols && !map.hasImage(arrowIcon)) {
      const img = headingArrowImage(size);
      if (img) map.addImage(arrowIcon, img, { pixelRatio: 2 });
    }
    // The label's bottom, in pixels above the point, when no arrow is in its way.
    const liftPlain = 1.9 * trackText;
    for (const t of [...view.tracks].sort((a, b) => a.n - b.n)) {
      const p = t.position;
      // A track marked gone stays in the list, not on the map.
      if (!p || t.positionTs == null || t.gone != null) continue;
      const old = isOld(t);
      const op = old ? 0.45 : 1;
      const color = AFFILIATION_COLOUR[t.affiliation];
      const pts = [...t.trail, p];
      if (pts.length > 1) trail.push({ type: "Feature", properties: { color, op }, geometry: { type: "LineString", coordinates: pts.map((x) => [x.lon, x.lat]) } });
      acc.push({ type: "Feature", properties: { color, op, estimated: !!p.estimated }, geometry: { type: "Polygon", coordinates: [circleRing(p, p.radius_m)] } });
      if (t.from && !old && distanceM(t.from, p) > 5) {
        sight.push({ type: "Feature", properties: { color: colours.get(t.seenBy) ?? "#475569" }, geometry: { type: "LineString", coordinates: [[t.from.lon, t.from.lat], [p.lon, p.lat]] } });
      }
      // The symbol image: one per code and size. Some frames are not centred on their own anchor,
      // so the image is shifted to keep the anchor on the point.
      let icon = "";
      let off: [number, number] = [0, 0];
      if (symbols) {
        icon = `track:${trackSymbolCode(t.affiliation, t.kind)}:${size}`;
        if (!map.hasImage(icon)) {
          const s = new symbols.Symbol(trackSymbolCode(t.affiliation, t.kind), { size, civilianColor: false, outlineWidth: 3, outlineColor: "#ffffff" });
          const canvas = s.asCanvas(2);
          const ctx = canvas.getContext("2d");
          if (ctx && canvas.width && canvas.height) {
            map.addImage(icon, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: 2 });
            const { width, height } = s.getSize();
            const a = s.getAnchor();
            trackIcons.current.set(icon, [width / 2 - a.x, height / 2 - a.y, width, height]);
          }
        }
        const i = trackIcons.current.get(icon);
        if (i) off = [i[0], i[1]];
      }
      // The way it is moving, as said: an arrow from the middle of the symbol. On screen it points
      // at the heading less the map's turn. When it points up, the label goes above its tip.
      const heading = symbols && t.heading ? HEADING_DEG[t.heading] : null;
      let lift = liftPlain;
      let arrow: Rect | null = null;
      if (heading != null) {
        const rad = ((heading - map.getBearing()) * Math.PI) / 180;
        const [sin, cos] = [Math.sin(rad), Math.cos(rad)];
        const [tx, ty] = [ha.len * sin, -ha.len * cos];
        const hw = ha.headW / 2 + ha.halo;
        arrow = { x0: Math.min(0, tx) - hw, y0: Math.min(0, ty) - hw, x1: Math.max(0, tx) + hw, y1: Math.max(0, ty) + hw };
        if (cos > 0) lift = Math.max(liftPlain, ha.len * cos + hw * Math.abs(sin) + 0.3 * trackText);
      }
      const what = describeTrack(t);
      const name = `T${t.n} · ${what}`;
      const when = old ? `not seen for ${fmtAgo(effNow - t.seenTs)}` : `${p.estimated ? "≈ " : ""}${fmtTime(t.positionTs)} · ${t.seenBy}`;
      const props: Record<string, unknown> = { icon, off, op, labelOp: old ? 0.75 : 1, name, when, n: t.n, picked: t.n === picked, textOff: [0, -lift / trackText] };
      if (heading != null) Object.assign(props, { heading, arrow: arrowIcon });
      drawn.push({ id: `T${t.n}`, p, color, op, icon, label: [name, when], props, lift, arrow });
    }

    // Where each symbol is drawn: on its point, unless it would hide a unit's dot or label, or a
    // track drawn before it. Then it is drawn a little way off, in screen pixels, with a line back
    // to the point. The track's place is the same; only the drawing moves.
    // The edges of the map count as taken, and the replay bar over its lower edge, so a symbol is
    // not pushed out of sight. A track whose point is out of sight is not moved at all.
    const pad = 2;
    const grow = (r: Rect): Rect => ({ x0: r.x0 - pad, y0: r.y0 - pad, x1: r.x1 + pad, y1: r.y1 + pad });
    const box = map.getContainer();
    const [w, h] = [box.clientWidth, box.clientHeight];
    const fixed: Rect[] = outside(w, h, Math.round(80 * k));
    const dot = 2 * (Math.round(9 * k) + 3);
    const unitText = Math.round(15 * k);
    for (const s of unitSpots(view.units, isSilent).values()) {
      const { x, y } = map.project([s.lon, s.lat]);
      fixed.push(grow(centred(x, y, dot, dot)));
      const b = textBox([s.name, s.when], unitText);
      const top = y + 1.1 * unitText;
      fixed.push(grow({ x0: x - b.w / 2, y0: top, x1: x + b.w / 2, y1: top + b.h }));
    }
    const frame = TRACK_SYMBOL_SIZE * k * 1.5;
    const marks: Mark[] = drawn.map((d) => {
      const { x, y } = map.project([d.p.lon, d.p.lat]);
      const i = trackIcons.current.get(d.icon);
      const b = textBox(d.label, trackText);
      const bottom = -d.lift;
      const boxes = [grow(i ? centred(i[0], i[1], i[2], i[3]) : centred(0, 0, frame, frame)), grow({ x0: -b.w / 2, y0: bottom - b.h, x1: b.w / 2, y1: bottom })];
      if (d.arrow) boxes.push(grow(d.arrow));
      return { id: d.id, x, y, boxes };
    });
    const inSight = marks.filter((m) => m.x >= 0 && m.y >= 0 && m.x <= w && m.y <= h);
    const shifts = declutter(inSight, fixed, Math.round(40 * k));
    marks.forEach((m, n) => {
      const d = drawn[n];
      const s = shifts.get(m.id) ?? { dx: 0, dy: 0 };
      let at: [number, number] = [d.p.lon, d.p.lat];
      if (s.dx || s.dy) {
        const q = map.unproject([m.x + s.dx, m.y + s.dy]);
        at = [q.lng, q.lat];
        leader.push({ type: "Feature", properties: { op: d.op }, geometry: { type: "LineString", coordinates: [[d.p.lon, d.p.lat], at] } });
        leader.push({ type: "Feature", properties: { op: d.op, color: d.color }, geometry: { type: "Point", coordinates: [d.p.lon, d.p.lat] } });
      }
      sym.push({ type: "Feature", properties: d.props, geometry: { type: "Point", coordinates: at } });
    });

    const set = (id: string, features: GeoJSON.Feature[]) => (map.getSource(id) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
    set("track", sym);
    set("track-acc", acc);
    set("track-trail", trail);
    set("track-sight", sight);
    set("track-task", task);
    set("track-leader", leader);
    map.setLayoutProperty("track-sym", "text-size", trackText);
  }, [view, isOld, isSilent, effNow, colours, symbols, mapReady, mapSize, zoomKey, picked]);

  // On a projector or a wall screen, the map's labels and markers grow with the panels.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const k = screenScale();
    map.setLayoutProperty("pos-label", "text-size", Math.round(15 * k));
    map.setLayoutProperty("start-label", "text-size", Math.round(13 * k));
    map.setPaintProperty("pos", "circle-radius", Math.round(9 * k));
  }, [mapReady, mapSize]);

  // The start point, shown while the mission is the one on screen.
  const start = mission?.start ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const features: GeoJSON.Feature[] = start
      ? [
          { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circleRing(start, start.radius_m)] } },
          // The name sits on the circle's top edge, clear of the units placed at its centre.
          { type: "Feature", properties: { label: `Start · ${start.name}` }, geometry: { type: "Point", coordinates: (({ lat, lon }) => [lon, lat])(destination(start, 0, start.radius_m)) } },
        ]
      : [];
    (map.getSource("start") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
  }, [start, mapReady]);

  // Open questions: each choice numbered on the map, ringed in its unit's colour and named with
  // its call sign, so two units' choices are not told apart by colour alone.
  const pendings = useMemo(() => view.units.filter((u) => u.pending), [view]);
  /** Questions that are about a track, not about where the speaker is: report id to track number. */
  const trackQuestions = useMemo(() => new Map(view.tracks.filter((t) => t.pendingReport).map((t) => [t.pendingReport!, t.n])), [view]);
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    candMarkers.current.forEach((m) => m.remove());
    candMarkers.current = [];
    if (!map || !ml || !mapReady) return;
    // Two units asked about the same place share one marker with both names; drawn apart, the
    // second would hide the first.
    const spots = new Map<string, { n: number; name: string; lat: number; lon: number; units: UnitState[]; who: string[] }>();
    for (const u of pendings) {
      // "ALPHA 1?" asks where the unit is; "ALPHA 1: T3?" asks where the track it reported is.
      const about = trackQuestions.get(u.pending!.reportId);
      u.pending!.candidates.forEach((c, i) => {
        const k = `${i}|${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
        const spot = spots.get(k) ?? { n: i + 1, name: c.name, lat: c.lat, lon: c.lon, units: [], who: [] };
        spot.units.push(u);
        spot.who.push(about != null ? `${u.callsign}: T${about}?` : `${u.callsign}?`);
        spots.set(k, spot);
      });
    }
    for (const s of spots.values()) {
      const el = document.createElement("div");
      el.className = styles.candMarker;
      if (s.units.length === 1) el.style.borderColor = s.units[0].colour;
      el.textContent = String(s.n);
      el.title = `${s.units.map((u) => u.callsign).join(", ")}, choice ${s.n}: ${s.name}`;
      const who = document.createElement("span");
      who.className = styles.candWho;
      who.textContent = s.who.join(" · ");
      el.appendChild(who);
      candMarkers.current.push(new ml.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map));
    }
  }, [pendings, trackQuestions, mapReady]);

  // Follow: keep every unit and track in this area (and any open choices) in view as reports come in.
  const followPoints = useMemo(() => {
    const pts: LatLon[] = [];
    for (const u of view.units) {
      if (u.area !== area) continue;
      if (u.position) pts.push(u.position);
      if (u.position?.heading_to) pts.push(u.position.heading_to);
      u.pending?.candidates.forEach((c) => pts.push(c));
    }
    for (const t of view.tracks) {
      if (t.area === area && t.position && t.gone == null) pts.push(t.position);
    }
    return pts;
  }, [view, area]);
  const followKey = followPoints.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join("|");

  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml || !mapReady || !follow) return;
    const duration = playing ? 300 : 700;
    if (!followPoints.length && start) {
      map.easeTo({ center: [start.lon, start.lat], zoom: 15, duration });
    } else if (!followPoints.length) {
      const a = AREAS[area];
      map.easeTo({ center: [a.centre.lon, a.centre.lat], zoom: a.zoom, duration });
    } else if (followPoints.length === 1) {
      map.easeTo({ center: [followPoints[0].lon, followPoints[0].lat], zoom: 16, duration });
    } else {
      const b = new ml.LngLatBounds();
      followPoints.forEach((p) => b.extend([p.lon, p.lat]));
      map.fitBounds(b, { padding: MAP_PADDING, maxZoom: 16.5, duration });
    }
    // followKey stands for followPoints, so the camera moves only when a point moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followKey, area, follow, mapReady, mapSize, start]);

  const flyToItem = useCallback(
    (item: FeedItem) => {
      setSelected(item.id);
      const map = mapRef.current;
      const ml = mlRef.current;
      if (!map || !ml) return;
      setFollow(false);
      if (item.area !== area) setManualArea(item.area);
      if (item.position) {
        map.flyTo({ center: [item.position.lon, item.position.lat], zoom: Math.max(map.getZoom(), 16), duration: 700 });
      } else if (item.candidates.length) {
        const b = new ml.LngLatBounds();
        item.candidates.forEach((c) => b.extend([c.lon, c.lat]));
        map.fitBounds(b, { padding: MAP_PADDING, maxZoom: 16.5, duration: 700 });
      }
    },
    [area],
  );

  const flyToUnit = useCallback(
    (u: UnitState) => {
      const map = mapRef.current;
      if (!map || !u.position) return;
      setFollow(false);
      if (u.area !== area) setManualArea(u.area);
      map.flyTo({ center: [u.position.lon, u.position.lat], zoom: Math.max(map.getZoom(), 16), duration: 700 });
    },
    [area],
  );

  const flyToTrack = useCallback(
    (t: TrackState) => {
      setPicked(t.n);
      const map = mapRef.current;
      if (!map || !t.position || t.gone != null) return;
      setFollow(false);
      if (t.area !== area) setManualArea(t.area);
      map.flyTo({ center: [t.position.lon, t.position.lat], zoom: Math.max(map.getZoom(), 16), duration: 700 });
    },
    [area, setPicked],
  );

  // ---------- the command post's own changes ----------
  /** Changes are made only to the present of an open mission that this coordinator keeps. */
  const canEdit = !!session && !!mission && ended == null && mode === "live" && stored === true;
  /** In a replay or an ended mission the tools close by themselves. */
  const activeTool = canEdit ? tool : null;
  const activeAnswer = canEdit ? answering : null;
  const activeSettle = canEdit ? settling : null;
  const pickedTrack = picked != null ? (view.tracks.find((t) => t.n === picked) ?? null) : null;
  /** The number a new track will most likely get; the coordinator gives the real one. */
  const nextN = full.tracks.reduce((m, t) => Math.max(m, t.n), 0) + 1;
  const tracksUrl = session ? `/api/sessions/${encodeURIComponent(session)}/tracks` : "";

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const startPlace = useCallback(() => {
    setPicked(null);
    setToolError(null);
    setNote("");
    // The camera stays where the person is looking while they place.
    setFollow(false);
    setTool((t) => (t?.kind === "place" ? null : { kind: "place", what: { ...DEFAULT_WHAT }, radius: PLOT_RADIUS_DEFAULT, at: null }));
  }, [setPicked]);

  const startEdit = useCallback((t: TrackState) => {
    setToolError(null);
    setNote("");
    setTool({ kind: "edit", n: t.n, what: { affiliation: t.affiliation, kind: t.kind, count: t.count ?? 1 } });
  }, []);

  const startMove = useCallback((t: TrackState) => {
    setToolError(null);
    setNote("");
    setFollow(false);
    setTool({ kind: "move", n: t.n, radius: PLOT_RADIUS_DEFAULT, at: null });
  }, []);

  /** Puts the track being placed or moved at a point, and asks the coordinator how it will name it. */
  const putDraft = useCallback(
    (lat: number, lon: number) => {
      setToolError(null);
      setTool((t) => (t && t.kind !== "edit" ? { ...t, at: { lat, lon, label: null } } : t));
      void (async () => {
        try {
          const res = await fetch(`/api/places?area=${area}&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`);
          const data = (await res.json()) as PlacesReply & { error?: string };
          if (!res.ok) {
            setToolError(data.error ?? "That point cannot be named.");
            return;
          }
          setTool((t) => (t && t.kind !== "edit" && t.at?.lat === lat && t.at.lon === lon ? { ...t, at: { ...t.at, label: data.label ?? null } } : t));
        } catch {
          // The card says the point is being named; saving still works.
        }
      })();
    },
    [area],
  );

  /** Puts it at a place picked by name: the coordinator places it on the place itself. */
  const putPlace = useCallback((p: StartPoint) => {
    setToolError(null);
    setTool((t) => (t && t.kind !== "edit" ? { ...t, at: { lat: p.lat, lon: p.lon, place: p.id, label: p.name } } : t));
    const map = mapRef.current;
    map?.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 16), duration: 500 });
  }, []);

  // A click on the map: where the track goes while placing or moving; otherwise it picks a track.
  useEffect(() => {
    mapClick.current = (e) => {
      const map = mapRef.current;
      if (!map) return;
      if (activeTool && activeTool.kind !== "edit") {
        putDraft(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      if (activeTool) return;
      const n = map.queryRenderedFeatures(e.point, { layers: ["track-sym"] })[0]?.properties?.n;
      setPicked(typeof n === "number" ? n : null);
    };
  });

  // A crosshair while the next click places something.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.getCanvas().style.cursor = activeTool && activeTool.kind !== "edit" ? "crosshair" : "";
  }, [activeTool, mapReady]);

  /** What the track being placed or moved looks like, where it would go, and how sure. */
  const draft = activeTool && activeTool.kind !== "edit" ? activeTool.at : null;
  const movingTrack = activeTool?.kind === "move" ? (full.tracks.find((t) => t.n === activeTool.n) ?? null) : null;
  const draftLooks: { affiliation: Affiliation; kind: TrackKind } | null = activeTool?.kind === "place" ? activeTool.what : movingTrack;
  const draftRadius = activeTool && activeTool.kind !== "edit" ? activeTool.radius : 0;
  const draftColour = draftLooks ? AFFILIATION_COLOUR[draftLooks.affiliation] : "#475569";
  const movingFrom = movingTrack?.position ?? null;

  // The draft's circle, and for a move a dashed line from where the track is now.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const features: GeoJSON.Feature[] = [];
    if (draft) {
      features.push({ type: "Feature", properties: { color: draftColour }, geometry: { type: "Polygon", coordinates: [circleRing(draft, draftRadius)] } });
      if (movingFrom) features.push({ type: "Feature", properties: { color: draftColour }, geometry: { type: "LineString", coordinates: [[movingFrom.lon, movingFrom.lat], [draft.lon, draft.lat]] } });
    }
    (map.getSource("draft") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
  }, [draft, draftRadius, draftColour, movingFrom, mapReady]);

  // The draft's symbol: a marker that can be dragged to where the track is.
  const draftCode = draft && draftLooks ? trackSymbolCode(draftLooks.affiliation, draftLooks.kind) : "";
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml || !mapReady || !draft || !draftCode || !symbols) return;
    const s = new symbols.Symbol(draftCode, { size: Math.round(TRACK_SYMBOL_SIZE * screenScale()), civilianColor: false, outlineWidth: 3, outlineColor: "#ffffff" });
    const el = document.createElement("div");
    el.className = styles.draftMarker;
    el.innerHTML = s.asSVG();
    el.title = "Drag to where it is";
    const { width, height } = s.getSize();
    const a = s.getAnchor();
    const m = new ml.Marker({ element: el, draggable: true, offset: [width / 2 - a.x, height / 2 - a.y] }).setLngLat([draft.lon, draft.lat]).addTo(map);
    // The circle follows while dragging; the name is asked for once it is dropped.
    m.on("drag", () => {
      const q = m.getLngLat();
      (map.getSource("draft") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: { color: draftColour }, geometry: { type: "Polygon", coordinates: [circleRing({ lat: q.lat, lon: q.lng }, draftRadius)] } }] });
    });
    m.on("dragend", () => {
      const q = m.getLngLat();
      putDraft(q.lat, q.lng);
    });
    draftMarker.current = m;
    return () => {
      m.remove();
      draftMarker.current = null;
    };
  }, [draft, draftCode, draftRadius, draftColour, symbols, mapReady, putDraft]);

  /** Sends a change to the coordinator. The log is read again at once, so the map shows it. */
  const sendPlot = useCallback(async (url: string, method: "POST" | "PATCH", body: unknown): Promise<PlotReply | null> => {
    setBusy(true);
    setToolError(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as PlotReply & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `The coordinator answered ${res.status}.`);
      pollNow.current();
      return data;
    } catch (e) {
      setToolError(e instanceof Error ? e.message : "Saving failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const confirmDraft = useCallback(async () => {
    if (!activeTool || activeTool.kind === "edit" || !activeTool.at || busy) return;
    const at = activeTool.at;
    const where = at.place ? { place: at.place } : { lat: at.lat, lon: at.lon };
    if (activeTool.kind === "place") {
      const w = activeTool.what;
      const r = await sendPlot(tracksUrl, "POST", { affiliation: w.affiliation, kind: w.kind, count: w.count > 1 ? w.count : null, ...where, radius_m: activeTool.radius, note: note || null });
      if (r) {
        setNotice(`Track ${r.entry.n} placed: ${describeWhat(w)}, ${r.entry.position?.label ?? ""}`);
        setNote("");
        // Ready for the next one, with the same choices.
        setTool({ ...activeTool, at: null });
      }
    } else {
      const r = await sendPlot(`${tracksUrl}/${activeTool.n}`, "PATCH", { action: "move", ...where, radius_m: activeTool.radius, note: note || null });
      if (r) {
        setNotice(`Track ${activeTool.n} moved: ${r.entry.position?.label ?? ""}`);
        setNote("");
        setTool(null);
        setPicked(activeTool.n);
      }
    }
  }, [activeTool, busy, note, sendPlot, tracksUrl, setPicked]);

  const saveEdit = useCallback(async () => {
    if (activeTool?.kind !== "edit" || busy) return;
    const w = activeTool.what;
    const r = await sendPlot(`${tracksUrl}/${activeTool.n}`, "PATCH", { action: "edit", affiliation: w.affiliation, kind: w.kind, count: w.count > 1 ? w.count : null, note: note || null });
    if (r) {
      setNotice(`Track ${activeTool.n} is now: ${describeWhat(w)}`);
      setNote("");
      setTool(null);
    }
  }, [activeTool, busy, note, sendPlot, tracksUrl]);

  const markGone = useCallback(
    async (n: number, gone: boolean) => {
      const r = await sendPlot(`${tracksUrl}/${n}`, "PATCH", { action: gone ? "gone" : "restore" });
      if (r) setNotice(gone ? `Track ${n} marked gone` : `Track ${n} back on the map`);
    },
    [sendPlot, tracksUrl],
  );

  /** The command post answers a unit's question, as when the unit has only a radio. */
  const sendAnswer = useCallback(
    async (a: Answering) => {
      if (!session) return;
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch("/api/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session, report: a.reportId, choice: a.choice, by: COMMAND_POST }) });
        const data = (await res.json().catch(() => ({}))) as { error?: string; by?: string | null };
        if (!res.ok) throw new Error(data.error ?? `The coordinator answered ${res.status}.`);
        setNotice(data.by !== COMMAND_POST ? `${a.callsign} had answered already` : a.choice ? `Chose ${a.name} for ${a.callsign}` : `None of the choices, for ${a.callsign}`);
        pollNow.current();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Saving the answer failed.");
      } finally {
        setBusy(false);
        setAnswering(null);
      }
    },
    [session],
  );

  /** The operator sends a drone to look at a track, ends its recon, or turns a request down [234]. */
  const sendTask = useCallback(
    async (body: TaskBody, done: string) => {
      if (!session) return;
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(session)}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = (await res.json().catch(() => ({}))) as Partial<TaskReply> & { error?: string };
        if (!res.ok) throw new Error(data.error ?? `The coordinator answered ${res.status}.`);
        setNotice(data.already ? "Someone had answered this request already" : done);
        pollNow.current();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Saving that failed.");
      } finally {
        setBusy(false);
      }
    },
    [session],
  );

  /** The operator gives a held radio report to a unit, adds its call sign, or dismisses it [203]. */
  const sendHeld = useCallback(
    async (st: Settling) => {
      if (!session) return;
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(session)}/held/${encodeURIComponent(st.held)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: st.action, callsign: st.callsign }),
        });
        const data = (await res.json().catch(() => ({}))) as Partial<HeldReply> & { error?: string };
        if (!res.ok) throw new Error(data.error ?? `The coordinator answered ${res.status}.`);
        setNotice(
          data.already
            ? "Someone had settled this report already"
            : st.action === "dismiss"
              ? "Dismissed the report"
              : st.action === "add"
                ? `Added ${st.callsign} and gave it the report`
                : `Gave the report to ${st.callsign}`,
        );
        setNewSign({ held: "", text: "" });
        pollNow.current();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Settling the report failed.");
      } finally {
        setBusy(false);
        setSettling(null);
      }
    },
    [session, setNewSign],
  );

  // Keys, while no field has the cursor: P to place, H S U C F and 1 to 9 in the palette, Esc to step back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) {
        if (e.key === "Escape") el.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (activeAnswer) setAnswering(null);
        else if (activeTool && activeTool.kind !== "edit" && activeTool.at) setTool({ ...activeTool, at: null });
        else if (activeTool) setTool(null);
        else setPicked(null);
        return;
      }
      if (!canEdit) return;
      if (!activeTool && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        startPlace();
        return;
      }
      if (!activeTool || activeTool.kind === "move") return;
      const aff = AFFILIATIONS.find((a) => AFFILIATION_KEY[a] === e.key.toUpperCase());
      const kind = /^[1-9]$/.test(e.key) ? TRACK_KINDS[Number(e.key) - 1] : undefined;
      if (aff) setTool({ ...activeTool, what: { ...activeTool.what, affiliation: aff } });
      else if (kind) setTool({ ...activeTool, what: { ...activeTool.what, kind } });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTool, activeAnswer, canEdit, startPlace]);

  // ---------- mission actions ----------
  const endMission = useCallback(async () => {
    if (!session) return;
    setConfirmEnd(false);
    setActionError(null);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(session)}/end`, { method: "POST" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `The coordinator answered ${res.status}.`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Ending the mission failed.");
    }
  }, [session]);

  const closePanel = useCallback(() => setPanelOpen(false), []);

  // ---------- page ----------
  const connected = now > 0 && now - lastOk < (session ? 3500 : LIST_POLL_MS * 2.5);
  /** The coordinator answered before and has stopped: what is on screen may be out of date. */
  const lost = !!session && lastOk > 0 && now > 0 && !connected;
  const latest = view.feed[0];
  /** An ended mission shown as it ended, not replayed. */
  const atEnd = mode === "live" && ended != null;
  // Live, the bar stands at the shown mission's end: now while it is open.
  const sliderValue = mode === "live" ? (shownStretch?.end ?? rangeEnd) : Math.min(Math.max(replayT, rangeStart), rangeEnd);
  const barSpan = rangeEnd - rangeStart;
  /** Where a time sits along the bar, in per cent. */
  const barPct = (t: number) => (barSpan > 0 ? ((t - rangeStart) / barSpan) * 100 : 0);
  const sliderMission = stretchAt(stretches, sliderValue, session);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true" />
          Voice-to-Map <span className={styles.brandSub}>Command post</span>
        </h1>
        {mission ? (
          <div className={styles.missionHead}>
            <span className={styles.missionTitle} title={mission.name}>
              {mission.name}
            </span>
            <span className={styles.chip} title="Phones join this mission by picking it from the list on the coordinator">
              code <strong>{session}</strong>
            </span>
            {/* What is on screen, in words: an ended mission, a replay, or the present. */}
            {ended != null ? (
              <span className={styles.stateChip} data-state="ended">
                Ended {fmtWhen(ended, now)}
              </span>
            ) : mode === "replay" ? (
              <span className={styles.stateChip} data-state="replay">
                Replay
              </span>
            ) : lost ? (
              <span className={styles.stateChip} data-state="lost">
                No contact
              </span>
            ) : (
              <span className={styles.stateChip} data-state="live">
                <span className={styles.stateDot} aria-hidden="true" />
                Live
              </span>
            )}
          </div>
        ) : session ? (
          <div className={styles.chip} title="A session from before missions">
            Session <strong>{session}</strong>
          </div>
        ) : (
          <div className={styles.chip}>No mission</div>
        )}
        {mission && ended == null ? (
          confirmEnd ? (
            <span className={styles.confirm} role="group" aria-label="End this mission?">
              <span className={styles.confirmText}>Stop this mission? Reports stop. It stays here for replay.</span>
              <button type="button" className={styles.dangerBtn} onClick={endMission}>
                Stop mission
              </button>
              <button type="button" className={styles.linkBtn} onClick={() => setConfirmEnd(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className={styles.ghostBtn} onClick={() => setConfirmEnd(true)}>
              Stop mission
            </button>
          )
        ) : null}
        {canEdit ? (
          <button
            type="button"
            className={activeTool?.kind === "place" ? styles.primaryBtn : styles.ghostBtn}
            aria-pressed={activeTool?.kind === "place"}
            onClick={startPlace}
            title="Place a track by hand: friend, foe or unknown (P)"
          >
            Place track
          </button>
        ) : null}
        {actionError ? (
          <span className={styles.error} role="alert">
            {actionError}
          </span>
        ) : null}
        <div className={styles.spacer} />
        {!mission || ended != null ? <button type="button" className={styles.ghostBtn} onClick={() => setPanelOpen(true)}>Start mission</button> : null}
        <div className={styles.conn} data-state={stored === false ? "off" : connected ? "on" : "wait"} role="status">
          <span className={styles.connDot} aria-hidden="true" />
          {stored === false ? "This coordinator keeps no record" : connected ? "Connected" : lastOk ? `No contact since ${fmtTime(lastOk)}` : "Connecting…"}
        </div>
        <button type="button" className={styles.menuBtn} aria-expanded={panelOpen} aria-haspopup="dialog" onClick={() => setPanelOpen((o) => !o)}>
          Missions ▾
        </button>
        {panelOpen ? <MissionPanel current={session} defaultArea={mission?.area ?? area} onPick={pickSession} onClose={closePanel} /> : null}
      </header>

      <main className={styles.mapCol}>
        <div ref={mapEl} className={styles.map} aria-label="Map of all units and tracks" />
        {/* Top left of the map: "Follow units", then the palette or the picked track's card. */}
        <div className={styles.dock}>
          {!follow ? (
            <button type="button" className={styles.followBtn} onClick={() => setFollow(true)}>
              Follow units
            </button>
          ) : null}
          {activeTool?.kind === "place" ? (
            <TrackPalette
              title={`Place Track ${nextN}`}
              what={activeTool.what}
              onWhat={(what) => setTool({ ...activeTool, what })}
              radius={activeTool.radius}
              onRadius={(radius) => setTool({ ...activeTool, radius })}
              area={area}
              onPlace={putPlace}
              symbols={symbols}
              onClose={() => setTool(null)}
              hint={activeTool.at ? null : "Click the map where it is, or find a place. Keys: H S U C F for whose, 1 to 9 for what, Esc to stop."}
              footer={
                activeTool.at ? (
                  <DraftCard
                    symbols={symbols}
                    what={activeTool.what}
                    title={`Track ${nextN} · ${describeWhat(activeTool.what)}`}
                    detail={`${activeTool.at.label ?? "Naming the point…"} · ±${activeTool.radius} m${activeTool.at.place ? " or the place's size" : ""} · placed by ${COMMAND_POST}`}
                    note={note}
                    onNote={setNote}
                    confirmLabel="Place"
                    onConfirm={confirmDraft}
                    onCancel={() => setTool({ ...activeTool, at: null })}
                    busy={busy}
                    error={toolError}
                  />
                ) : toolError ? (
                  <p className={styles.error} role="alert">
                    {toolError}
                  </p>
                ) : null
              }
            />
          ) : activeTool?.kind === "move" && movingTrack ? (
            <TrackPalette
              title={`Move Track ${activeTool.n}`}
              what={{ affiliation: movingTrack.affiliation, kind: movingTrack.kind, count: movingTrack.count ?? 1 }}
              onWhat={() => {}}
              showWhat={false}
              radius={activeTool.radius}
              onRadius={(radius) => setTool({ ...activeTool, radius })}
              area={area}
              onPlace={putPlace}
              symbols={symbols}
              onClose={() => setTool(null)}
              hint={activeTool.at ? null : `Click the map where Track ${activeTool.n} is now, or find a place. Esc to stop.`}
              footer={
                activeTool.at ? (
                  <DraftCard
                    symbols={symbols}
                    what={movingTrack}
                    title={`Move Track ${activeTool.n} · ${describeTrack(movingTrack)}`}
                    detail={`to ${activeTool.at.label ?? "naming the point…"} · ±${activeTool.radius} m`}
                    note={note}
                    onNote={setNote}
                    confirmLabel="Move"
                    onConfirm={confirmDraft}
                    onCancel={() => setTool({ ...activeTool, at: null })}
                    busy={busy}
                    error={toolError}
                  />
                ) : toolError ? (
                  <p className={styles.error} role="alert">
                    {toolError}
                  </p>
                ) : null
              }
            />
          ) : activeTool?.kind === "edit" ? (
            <TrackPalette
              title={`Change Track ${activeTool.n}`}
              what={activeTool.what}
              onWhat={(what) => setTool({ ...activeTool, what })}
              symbols={symbols}
              onClose={() => setTool(null)}
              footer={
                <div className={styles.draft}>
                  <input className={styles.input} value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEdit()} placeholder="Source, if any: confirmed by drone" aria-label="Where this came from" maxLength={120} />
                  {toolError ? (
                    <p className={styles.error} role="alert">
                      {toolError}
                    </p>
                  ) : null}
                  <div className={styles.draftButtons}>
                    <button type="button" className={styles.linkBtn} onClick={() => setTool(null)}>
                      Cancel
                    </button>
                    <button type="button" className={styles.primaryBtn} onClick={saveEdit} disabled={busy}>
                      {busy ? "Saving…" : `Save: ${describeWhat(activeTool.what)}`}
                    </button>
                  </div>
                </div>
              }
            />
          ) : pickedTrack ? (
            <TrackCard
              key={pickedTrack.n}
              track={pickedTrack}
              symbols={symbols}
              canEdit={canEdit}
              busy={busy}
              error={toolError}
              onChange={() => startEdit(pickedTrack)}
              onMove={() => startMove(pickedTrack)}
              onGone={() => markGone(pickedTrack.n, true)}
              onRestore={() => markGone(pickedTrack.n, false)}
              onClose={() => setPicked(null)}
            >
              <TrackRecon track={pickedTrack} tracks={view.tracks} requests={view.requests} canEdit={canEdit} busy={busy} fmt={fmtTime} onTask={sendTask} />
            </TrackCard>
          ) : null}
        </div>
        {/* A frame round the map says "this is a replay" from across the room. */}
        {mode === "replay" ? <div className={styles.replayFrame} aria-hidden="true" /> : null}
        <div className={styles.mapNotes}>
          {otherMissions.map((other) => <div key={other.code} className={styles.mapNote} style={{ pointerEvents: "auto" }}>
            Reports received in {other.name} · {other.code}. <button type="button" className={styles.linkBtn} onClick={() => pickSession(other.code)}>Show mission</button>
          </div>)}
          {!mapReady ? (
            <div className={styles.mapNote} role="status">
              {mapSlow ? "The map has not loaded yet. It needs the network for its tiles. Units and reports still show in the lists." : "Loading the map…"}
            </div>
          ) : null}
          {lost ? (
            <div className={styles.lostBanner} role="alert">
              No answer from the coordinator since {fmtTime(lastOk)}. The map may be out of date.
            </div>
          ) : null}
          {notice ? (
            <div className={styles.mapNote} role="status">
              {notice}
            </div>
          ) : null}
          {mode === "replay" ? (
            <div className={styles.replayBadge}>Replay · {fmtWhen(replayT, now)}</div>
          ) : ended != null ? (
            <div className={styles.endedBanner}>
              Mission ended {otherDay(ended, now) ? `on ${otherDay(ended, now)} ` : ""}at {fmtTime(ended)}. Press ▶ to replay it.
            </div>
          ) : null}
        </div>

        <div className={styles.replayBar}>
          <button type="button" className={styles.liveBtn} aria-expanded={replayOpen} disabled={!entries.length} onClick={() => {
            if (replayOpen) goLive();
            setReplayOpen(!replayOpen);
          }}>{replayOpen ? "Close replay" : "Replay"}</button>
          {replayOpen ? <>
          <button
            type="button"
            className={styles.liveBtn}
            aria-pressed={mode === "live" && !!session}
            disabled={!session}
            data-stale={ended != null ? "ended" : lost ? "lost" : undefined}
            onClick={goLive}
            title={ended != null ? "Show the mission as it ended" : "Show the present and follow the units"}
          >
            <span className={styles.liveDot} aria-hidden="true" /> {ended != null ? "At end" : "Live"}
          </button>
          <button
            type="button"
            className={styles.playBtn}
            onClick={togglePlay}
            disabled={!stretches.length}
            aria-label={playing ? "Pause replay" : "Play replay"}
            title={playing ? "Pause the replay" : "Replay from the start of this mission"}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          {/* The day's missions in this area: a stretch for each, gray where none was running, and
              a detent at every start and end. The replay never rests in the gray. */}
          <div className={styles.timeline}>
            <div className={styles.rail} aria-hidden="true">
              {stretches.map((s) => (
                <span
                  key={s.code}
                  className={styles.stretch}
                  data-shown={s.code === session ? "" : undefined}
                  style={{ left: `${barPct(s.start)}%`, width: `${barPct(s.end) - barPct(s.start)}%` }}
                />
              ))}
              {detents(stretches).map((d) => (
                <span key={d} className={styles.detent} style={{ left: `${barPct(d)}%` }} />
              ))}
            </div>
            <input
              className={styles.slider}
              type="range"
              min={rangeStart}
              max={rangeEnd}
              step="any"
              value={sliderValue}
              disabled={!stretches.length}
              onChange={(e) => {
                setPlaying(false);
                // A start or end within a few pixels pulls the replay onto it.
                const width = e.currentTarget.getBoundingClientRect().width - THUMB_PX;
                const pull = width > 0 ? (barSpan * DETENT_PX) / width : 0;
                scrub(Math.round(settle(stretches, Number(e.currentTarget.value), pull)));
              }}
              onKeyDown={(e) => {
                const to = keyTarget(stretches, sliderValue, e.key);
                if (to == null) return;
                e.preventDefault();
                setPlaying(false);
                scrub(to);
              }}
              aria-label="Replay time"
              title="The day's missions in this area; gray where none was running. Page Up and Page Down jump between starts and ends."
              // No time before the first entry: the server's locale would not match the browser's.
              aria-valuetext={stretches.length ? `${fmtTime(sliderValue)}${sliderMission ? `, ${sliderMission.name}` : ""}` : undefined}
            />
          </div>
          <div className={styles.time}>
            {mode === "replay" ? (
              <>
                {fmtTime(replayT)} <span className={styles.muted}>{fmtSpan(Math.max(0, (shownStretch?.end ?? rangeEnd) - replayT))} left</span>
              </>
            ) : ended != null ? (
              <>Ended · {fmtTime(ended)}</>
            ) : !session ? (
              // No mission on screen, so nothing is live: only the clock.
              <>{now ? fmtTime(now) : ""}</>
            ) : (
              <>
                {lost ? "No contact" : "Live"}
                {now ? ` · ${fmtTime(now)}` : ""}
              </>
            )}
          </div>
          <div className={styles.segmentedSmall} role="group" aria-label="Replay speed" title="Replay speed">
            {SPEEDS.map((s) => (
              <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                {s}×
              </button>
            ))}
          </div>
          </> : <div className={styles.time}>{lost ? "No contact" : ended != null ? "Mission ended" : "Live"}</div>}
        </div>
      </main>

      <aside className={styles.side} data-tracks={view.tracks.length ? "" : undefined}>
        {/* Radio reports the coordinator was not sure of: they wait here for the operator, and
            nothing moves until the operator gives one to a unit [203]. */}
        {view.held.length ? (
          <section className={styles.section} aria-labelledby="held-h">
            <h2 id="held-h" className={styles.h2}>
              Unassigned <span className={styles.count}>{view.held.length}</span>
            </h2>
            <ol className={styles.held}>
              {view.held.map((h) => {
                const st = activeSettle?.held === h.id ? activeSettle : null;
                const onRoster = (c: string) => view.roster.includes(c);
                const give = [...new Set([...h.candidates, ...(h.read ? [h.read] : [])])].filter(onRoster);
                const addable = h.read && !onRoster(h.read) ? h.read : null;
                const others = view.roster.filter((c) => !give.includes(c));
                const typed = newSign.held === h.id ? newSign.text : "";
                const typedSign = callsignGiven(typed) ? callsignOf(typed) : null;
                return (
                  <li key={h.id} className={styles.heldItem}>
                    <span className={styles.itemHead}>
                      <span className={styles.itemTime}>{fmtTime(h.ts)}</span>
                      <span className={styles.itemCall}>{h.heard ? `“${h.heard}”` : "Radio"}</span>
                      <span className={styles.pill} data-status="ask">
                        {HELD_TAG[h.reason]}
                      </span>
                    </span>
                    <span className={styles.said}>{h.transcript ? `“${h.transcript}”` : "(no words heard)"}</span>
                    <span className={styles.heldQuestion}>{h.question}</span>
                    {h.audio && session ? (
                      <audio className={styles.heldAudio} controls preload="none" src={`/api/sessions/${encodeURIComponent(session)}/audio/${encodeURIComponent(h.audio)}`}>
                        The recording.
                      </audio>
                    ) : null}
                    {!canEdit ? null : st ? (
                      <div className={styles.confirm} role="group" aria-label="Confirm">
                        <span className={styles.confirmText}>{settleText(st, h)}</span>
                        <button type="button" className={st.action === "dismiss" ? styles.dangerBtn : styles.primaryBtn} onClick={() => sendHeld(st)} disabled={busy}>
                          {st.action === "dismiss" ? "Dismiss" : st.action === "add" ? "Add and give" : "Give"}
                        </button>
                        <button type="button" className={styles.linkBtn} onClick={() => setSettling(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className={styles.heldActions}>
                        {give.map((c) => (
                          <button key={c} type="button" className={styles.giveBtn} onClick={() => setSettling({ held: h.id, action: "assign", callsign: c })}>
                            Give to {c}
                          </button>
                        ))}
                        {addable ? (
                          <button type="button" className={styles.giveBtn} onClick={() => setSettling({ held: h.id, action: "add", callsign: addable })}>
                            Add {addable}
                          </button>
                        ) : null}
                        {others.length ? (
                          <select
                            className={styles.giveSelect}
                            value=""
                            onChange={(e) => {
                              if (e.target.value) setSettling({ held: h.id, action: "assign", callsign: e.target.value });
                            }}
                            aria-label="Give this report to a unit"
                          >
                            <option value="">{give.length ? "Another unit…" : "Give to…"}</option>
                            {others.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <form
                          className={styles.giveForm}
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (typedSign) setSettling({ held: h.id, action: onRoster(typedSign) ? "assign" : "add", callsign: typedSign });
                          }}
                        >
                          <input
                            className={styles.giveInput}
                            value={typed}
                            onChange={(e) => setNewSign({ held: h.id, text: e.target.value })}
                            placeholder="New call sign"
                            maxLength={24}
                            autoCapitalize="characters"
                            spellCheck={false}
                            aria-label="A call sign to add to the roster"
                          />
                          <button type="submit" className={styles.linkBtn} disabled={!typedSign}>
                            Add
                          </button>
                        </form>
                        <button type="button" className={styles.linkBtn} onClick={() => setSettling({ held: h.id, action: "dismiss", callsign: null })}>
                          Dismiss
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}

        {/* Units that asked for a drone to look at a track: nothing is sent until the operator
            picks a drone and confirms [234]. */}
        {view.requests.length ? (
          <section className={styles.section} aria-labelledby="requests-h">
            <h2 id="requests-h" className={styles.h2}>
              Recon requests <span className={styles.count}>{view.requests.length}</span>
            </h2>
            <ol className={styles.held}>
              {view.requests.map((r) => {
                const t = r.n != null ? view.tracks.find((x) => x.n === r.n) : undefined;
                return (
                  <li key={r.id} className={styles.heldItem}>
                    <span className={styles.itemHead}>
                      <span className={styles.itemTime}>{fmtTime(r.ts)}</span>
                      <span className={styles.itemCall}>
                        <span className={styles.itemDot} style={{ background: r.colour }} aria-hidden="true" />
                        {r.callsign}
                      </span>
                      <span className={styles.pill} data-status="ask">
                        Recon
                      </span>
                    </span>
                    <span className={styles.said}>“{r.words}”</span>
                    {t ? (
                      <button type="button" className={styles.linkBtn} onClick={() => flyToTrack(t)}>
                        Track {t.n} · {describeTrack(t)}
                        {t.position ? ` · ${t.position.label}` : " · not placed yet"}
                      </button>
                    ) : (
                      <span className={styles.heldQuestion}>No track named. Pick the track to look at.</span>
                    )}
                    {canEdit ? <SendDrone key={`${r.id}:${r.n}`} n={t ? t.n : null} tracks={view.tracks} request={r} busy={busy} onTask={sendTask} /> : null}
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}

        <section className={styles.section} aria-labelledby="units-h">
          <h2 id="units-h" className={styles.h2}>
            Units <span className={styles.count}>{view.units.length}</span>
          </h2>
          {view.units.length === 0 ? (
            <p className={styles.empty}>
              {stored === false
                ? "Reports sent to this coordinator are not kept, so there is nothing to show. Run the coordinator on the Mac and point the transmitter at it."
                : !session
                  ? noMission
                    ? "No mission is open. Open one from Missions, then join it from the phones."
                    : "Looking for an open mission…"
                  : mission
                    ? mode === "replay"
                      ? "No unit had joined at this time."
                      : ended != null
                        ? "Nobody joined this mission."
                        : `Waiting for units to join “${mission.name}”. On each phone: pick this mission, enter a call sign, and join.`
                    : entries.length
                      ? "Nobody has reported yet."
                      : `No mission with the code “${session}”. Pick one from Missions.`}
            </p>
          ) : (
            <ul className={styles.units}>
              {view.units.map((u) => {
                const silent = isSilent(u);
                const st = unitStatus(u, silent, atEnd ? fmtAgo(effNow - u.lastHeard) : null);
                return (
                  <li key={u.callsign}>
                    <button type="button" className={styles.unit} data-tone={st.tone} onClick={() => flyToUnit(u)} disabled={!u.position} title={u.position ? "Show on the map" : undefined}>
                      <span className={styles.unitDot} style={{ background: u.colour }} aria-hidden="true" />
                      <span className={styles.unitMain}>
                        <span className={styles.unitTop}>
                          <span className={styles.unitName}>{u.callsign}</span>
                          <span className={styles.pill} data-status={st.tone}>
                            {st.tag}
                          </span>
                        </span>
                        <span className={styles.unitStatus}>{st.text}</span>
                      </span>
                      {/* How long since it was last heard, then the time itself. An ended mission
                          has no "ago": the picture is the one at its end. */}
                      {u.lastHeard && effNow ? (
                        <span className={styles.unitTime}>
                          {atEnd ? null : <span className={styles.unitAge}>{fmtAgo(effNow - u.lastHeard)} ago</span>}
                          <span>{fmtTime(u.lastHeard)}</span>
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Tracks: what the units have seen. Shown only once there is one, so a mission without
            them looks as it always did. */}
        {view.tracks.length ? (
          <section className={styles.section} aria-labelledby="tracks-h">
            <h2 id="tracks-h" className={styles.h2}>
              Tracks <span className={styles.count}>{view.tracks.length}</span>
            </h2>
            <ul className={`${styles.units} ${styles.tracks}`}>
              {/* Tracks marked gone go last: they are off the map and kept for the record. */}
              {[...view.tracks].sort((a, b) => Number(a.gone != null) - Number(b.gone != null) || a.n - b.n).map((t) => {
                const old = isOld(t);
                const st = trackStatus(t, old);
                return (
                  <li key={t.n}>
                    <button
                      type="button"
                      className={styles.unit}
                      data-tone={st.tone}
                      data-selected={picked === t.n || undefined}
                      onClick={() => flyToTrack(t)}
                      title={t.position && t.gone == null ? "Show on the map" : "Show its card"}
                    >
                      {/* The same standard symbol as on the map. Drawn by milsymbol from a code this page builds. */}
                      <span className={styles.trackSym} aria-hidden="true" dangerouslySetInnerHTML={symbols ? { __html: trackSvg(symbols, t, 18) } : undefined} />
                      <span className={styles.unitMain}>
                        <span className={styles.unitTop}>
                          <span className={styles.unitName}>Track {t.n}</span>
                          <span className={styles.pill} data-status={t.affiliation}>
                            {AFFILIATION_LABEL[t.affiliation]}
                          </span>
                          {t.gone != null ? (
                            <span className={styles.pill} data-status="silent">
                              Gone
                            </span>
                          ) : t.pendingReport ? (
                            <span className={styles.pill} data-status="ask">
                              Awaiting answer
                            </span>
                          ) : old ? (
                            <span className={styles.pill} data-status="silent">
                              Old sighting
                            </span>
                          ) : null}
                        </span>
                        <span className={styles.unitStatus}>{st.main}</span>
                        <span className={styles.trackWhere}>{st.sub}</span>
                      </span>
                      {t.seenTs && effNow ? (
                        <span className={styles.unitTime}>
                          {atEnd ? null : <span className={styles.unitAge}>{fmtAgo(effNow - t.seenTs)} ago</span>}
                          <span>{fmtTime(t.seenTs)}</span>
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className={`${styles.section} ${styles.feedSection}`} aria-labelledby="feed-h">
          <h2 id="feed-h" className={styles.h2}>
            Reports <span className={styles.count}>{view.feed.filter((f) => f.kind === "report").length}</span>
          </h2>
          {session && view.feed.length === 0 ? <p className={styles.empty}>{mode === "replay" ? "No reports at this time." : "No reports yet. Each one appears here with its time, call sign and outcome."}</p> : null}
          <ol className={styles.feed}>
            {view.feed.map((f) => {
              if (f.kind === "plot" || f.kind === "note" || f.kind === "request" || f.kind === "task") {
                // Something the command post did to a track or a held report, or a request for recon
                // and what was done about it [234]: one line, like a join.
                const t = f.track != null ? view.tracks.find((x) => x.n === f.track) : undefined;
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      className={styles.joinItem}
                      data-plot=""
                      data-selected={selected === f.id || undefined}
                      onClick={() => {
                        flyToItem(f);
                        if (t && !f.position) flyToTrack(t);
                        else if (f.track != null) setPicked(f.track);
                      }}
                    >
                      <span className={styles.itemTime}>{fmtTime(f.ts)}</span>
                      <span className={styles.itemCall}>
                        <span className={styles.itemDot} style={{ background: f.kind === "request" ? f.colour : CP_COLOUR }} aria-hidden="true" />
                        {f.callsign}
                      </span>
                      <span className={styles.joinText}>{f.outcome}</span>
                    </button>
                  </li>
                );
              }
              if (f.kind === "join") {
                return (
                  <li key={f.id}>
                    <button type="button" className={styles.joinItem} data-selected={selected === f.id || undefined} onClick={() => flyToItem(f)} disabled={!f.position}>
                      <span className={styles.itemTime}>{fmtTime(f.ts)}</span>
                      <span className={styles.itemCall}>
                        <span className={styles.itemDot} style={{ background: f.colour }} aria-hidden="true" />
                        {f.callsign}
                      </span>
                      <span className={styles.joinText}>{f.outcome}</span>
                    </button>
                  </li>
                );
              }
              const open = f.status === "ambiguous" && !f.answer && !f.expired;
              // The same words as the units list, so a state has one name on the page.
              const estimate = f.status === "resolved" && !!f.position?.estimated;
              const pill = open
                ? { tone: "ask", tag: "Awaiting answer" }
                : f.expired
                  ? { tone: "none", tag: "Not answered" }
                  : f.status === "ambiguous"
                    ? { tone: "answered", tag: f.answer?.by ? `${f.answer.by} answered` : "Answered" }
                    : f.track != null && f.status === "resolved"
                      ? // A report about a track: it placed or changed the track, not the speaker.
                        { tone: "track", tag: `Track ${f.track}` }
                      : estimate
                      ? { tone: "estimate", tag: "≈ Estimate" }
                      : f.status === "resolved" && f.position
                        ? { tone: "placed", tag: "Placed" }
                        : { tone: "none", tag: "Not placed" };
              return (
                <li key={f.id}>
                  <button type="button" className={styles.item} data-selected={selected === f.id || undefined} data-open={open || undefined} onClick={() => flyToItem(f)}>
                    <span className={styles.itemHead}>
                      <span className={styles.itemTime}>{fmtTime(f.ts)}</span>
                      <span className={styles.itemCall}>
                        <span className={styles.itemDot} style={{ background: f.colour }} aria-hidden="true" />
                        {f.callsign}
                      </span>
                      <span className={styles.pill} data-status={pill.tone}>
                        {pill.tag}
                      </span>
                    </span>
                    <span className={styles.said}>{f.transcript ? `“${f.transcript}”` : "(no words heard)"}</span>
                    <span className={styles.outcome}>{f.outcome}</span>
                    {f.sender ? <span className={styles.heardLine}>{describeSender(f.sender)}</span> : null}
                    {open && f.candidates.length ? (
                      <ol className={styles.choices}>
                        {f.candidates.map((c, i) => (
                          <li key={c.id}>
                            <span className={styles.choiceN} style={{ borderColor: f.colour }}>
                              {i + 1}
                            </span>
                            <span>
                              {c.name}
                              {c.town ? ` (${c.town})` : ""} <span className={styles.muted}>· {c.category.replace("_", " ")}</span>
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </button>
                  {/* The command post can answer for the unit, as when it has only a radio. Asked once more first. */}
                  {open && canEdit && f.candidates.length ? (
                    <div className={styles.answerBar}>
                      {activeAnswer?.reportId === f.id ? (
                        <div className={styles.confirm} role="group" aria-label="Confirm the answer">
                          <span className={styles.confirmText}>
                            {activeAnswer.choice ? `Choose ${activeAnswer.name} for ${f.callsign}?` : `None of these, for ${f.callsign}? The question closes and nothing moves.`}
                          </span>
                          <button type="button" className={styles.primaryBtn} onClick={() => sendAnswer(activeAnswer)} disabled={busy}>
                            {activeAnswer.choice ? "Choose" : "None of these"}
                          </button>
                          <button type="button" className={styles.linkBtn} onClick={() => setAnswering(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className={styles.answerLabel}>Answer for {f.callsign}:</span>
                          {f.candidates.map((c, i) => (
                            <button
                              key={c.id}
                              type="button"
                              className={styles.answerBtn}
                              style={{ borderColor: f.colour }}
                              onClick={() => setAnswering({ reportId: f.id, choice: c.id, name: c.name, callsign: f.callsign })}
                              aria-label={`Choose ${i + 1}, ${c.name}, for ${f.callsign}`}
                              title={c.name}
                            >
                              {i + 1}
                            </button>
                          ))}
                          <button type="button" className={styles.linkBtn} onClick={() => setAnswering({ reportId: f.id, choice: null, name: "", callsign: f.callsign })}>
                            None of these
                          </button>
                        </>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      </aside>

      <div className={styles.srOnly} aria-live="polite">
        {mode === "live" && latest ? `${latest.callsign}: ${latest.outcome}` : ""}
      </div>
    </div>
  );
}
