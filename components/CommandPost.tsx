"use client";

/**
 * The command post: the shared map a person at the base watches and keeps. It opens and ends
 * missions, places and changes tracks by hand, places a unit by hand when the app did not or got it
 * wrong [243], and answers a unit's question when the unit cannot tap. It polls the mission's log every second and rebuilds the picture with foldLog(), so the live
 * view and a replay are the same code: a replay is the log read up to a moment. What the command
 * post does goes into the same log, through the coordinator, so a replay shows it too.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { ExpressionSpecification, GeoJSONSource, MapMouseEvent, Map as MLMap, Marker } from "maplibre-gl";
import { bearingDeg, destination, distanceM } from "@/lib/geo/geo";
import { shortGrid, type GridRead } from "@/lib/geo/grid";
import { AREAS, DEFAULT_AREA, isAreaId, type AreaId } from "@/lib/geo/areas";
import { AFFILIATION_COLOUR, AFFILIATION_LABEL, AFFILIATIONS, describeTrack, HEADING_DEG, TRACK_KIND_NAME, TRACK_KINDS, trackSymbolCode } from "@/lib/geo/trackKinds";
import type { Affiliation, TrackKind } from "@/lib/geo/types";
import { CP_COLOUR, colourMap, describeSender, FADE_AFTER_MS, foldLog, knownAt, TRACK_OLD_AFTER_MS, type FeedItem, type TrackState, type UnitState } from "@/lib/reports/fold";
import { PLOT_RADII, PLOT_RADIUS_DEFAULT } from "@/lib/reports/plot";
import { barRange, dayStretches, detents, keyTarget, settle, stepAlong, stretchAt, type ShownMission, type Stretch } from "@/lib/reports/timeline";
import { decisionsOf, optionsOf, type Decision, type DecisionOption } from "@/lib/reports/decisions";
import { handover } from "@/lib/reports/handover";
import { anchorFor, arrangeTracks, moveNextTo, parseOrders, parseTrackView, previewMove, TRACK_GROUPS, TRACK_HIDES, TRACK_SORTS, withSaved, type LaneOrders, type TrackHide, type TrackView } from "@/lib/reports/lanes";
import { COMMAND_POST, DEMO_SESSION, sessionCode, type FixReply, type HeldReply, type LogEntry, type MissionListReply, type MissionSummary, type PlacesReply, type PlotReply, type SessionLogReply, type StartPoint, type TaskReply, type UnitReply } from "@/lib/reports/types";
import { centred, declutter, outside, textBox, type Mark, type Rect } from "./declutter";
import DecisionQueue from "./DecisionQueue";
import { FLOW_STEPS, FLOW_TICK_MS, flowDots, NEW_TRACK_MS, SLIDE_MS, SLIDE_MS_REPLAY, Slides, steppedOn, type Scene } from "./motion";
import MapTools from "./MapTools";
import MissionPanel from "./MissionPanel";
import { AFFILIATION_KEY, DEFAULT_WHAT, describeWhat, DraftCard, GridTag, TrackCard, TrackPalette, trackSvg, type MilSymbol, type TrackWhat } from "./TrackTools";
import { TrackRecon, type TaskBody } from "./ReconTools";
import { UnitPanel } from "./UnitTools";
import { ReportInspector } from "./ReportInspector";
import styles from "./CommandPost.module.css";

import { loadBaseMap } from "@/lib/map/baseMap";
import { addSatelliteLayers, setSatelliteVisible } from "@/lib/map/satellite";
const POLL_MS = 1000;
/** How often the list of missions is read: to find one with none on screen, and for the replay bar. */
const LIST_POLL_MS = 5000;
const STEP_MS = 200;
const SPEEDS = [1, 10, 30];
/** The timeline's filters: what kind of event to show [271]. */
const TIMELINE_FILTERS = [
  ["all", "All"],
  ["reports", "Reports"],
  ["tracks", "Tracks"],
  ["units", "Units"],
  ["tasks", "Tasks"],
] as const;
type TimelineFilter = (typeof TIMELINE_FILTERS)[number][0];
/** How close to a mission's start or end, in pixels on the bar, the replay is pulled onto it. */
const DETENT_PX = 8;
/** The replay bar's thumb, in CSS pixels: its middle runs from half this in from each end. */
const THUMB_PX = 16;
const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const EMPTY_LOG: LogEntry[] = [];
// The bottom leaves room for the replay bar; the right for the zoom buttons; the sides for a
// label, which is wider than its marker.
const MAP_PADDING = { top: 80, bottom: 130, left: 90, right: 90 };
/** The Decisions card's width before the big-screen zoom, and its share of the map at most; the same as .deck in CommandPost.module.css. */
const DECK_W = 360;
const DECK_SHARE = 0.48;

/** The Decisions card's width on screen, over a map this wide. */
function deckWidth(mapWidth: number): number {
  return Math.min(DECK_W * screenScale(), mapWidth * DECK_SHARE);
}

/** A phone or a narrow window: the map on top and the card across its bottom; the same 900 px as CommandPost.module.css. */
function phoneLayout(): boolean {
  return window.matchMedia("(max-width: 900px)").matches;
}

type LatLon = { lat: number; lon: number };
type DeckSide = "left" | "right";
type Padding = { top: number; bottom: number; left: number; right: number };

/** Shrinks two paddings that face each other so at least `room` pixels are left between them. */
function leaveRoom(pad: Padding, a: keyof Padding, b: keyof Padding, size: number, room: number): void {
  const over = pad[a] + pad[b] + room - size;
  if (over <= 0) return;
  const k = Math.max(0, (size - room) / (pad[a] + pad[b]));
  pad[a] = Math.round(pad[a] * k);
  pad[b] = Math.round(pad[b] * k);
}

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
function unitSpots(units: UnitState[], isSilent: (u: UnitState) => boolean, drawnAt?: (u: UnitState) => LatLon | null): Map<string, Spot> {
  const together = new Map<string, UnitState[]>();
  for (const u of units) {
    if (!u.position || u.positionTs == null) continue;
    const k = spotKey(u.position);
    together.set(k, [...(together.get(k) ?? []), u]);
  }
  const out = new Map<string, Spot>();
  for (const [k, group] of together) {
    const p = group[0].position!;
    // Where the dot is drawn: its place, or a point on the way there while it slides [238].
    const at = drawnAt?.(group[0]) ?? p;
    const newest = Math.max(...group.map((x) => x.positionTs ?? 0));
    const allSilent = group.every(isSilent);
    const name = group.map((x) => (isSilent(x) && !allSilent ? `${x.callsign} (silent)` : x.callsign)).join(" · ");
    const when = allSilent ? `Last known ${p.estimated ? "≈ " : ""}${fmtTime(newest)}` : `${p.estimated ? "≈ " : ""}${fmtTime(newest)}`;
    out.set(k, { lat: at.lat, lon: at.lon, name, when, allSilent });
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
  // The short demo link belongs to the demo only.
  if (code !== DEMO_SESSION) q.delete("demo");
  // A moment and a track belong to the mission that was on screen.
  q.delete("t");
  q.delete("track");
  const qs = q.toString();
  history[replace ? "replaceState" : "pushState"](null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  window.dispatchEvent(new Event(LOCATION_EVENT));
}

/** Copies text, with a hidden textarea for a browser that refuses the clipboard API [273]. */
async function copyText(text: string): Promise<boolean> {
  try {
    const write = navigator.clipboard?.writeText(text);
    if (write) {
      // A permission prompt can leave the promise pending; fall back after a moment.
      const copied = await Promise.race([
        write.then(() => true, () => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 800)),
      ]);
      if (copied) return true;
    }
  } catch {
    // A LAN page on plain HTTP, or a browser without the permission.
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.top = "0";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const copied = document.execCommand("copy");
    el.remove();
    return copied;
  } catch {
    return false;
  }
}

type UnitTone = "placed" | "estimate" | "ask" | "none" | "silent";

/** The size of a track's symbol on the map, before the big-screen steps. The frame is about 1.5 times this. */
const TRACK_SYMBOL_SIZE = 24;

/** The dots that flow along a unit's arrow [238]: pixels from one to the next, and how far from the unit's marker the first one shows. */
const FLOW_DOT_GAP = 14;
const FLOW_DOT_SKIP = 12;

/**
 * The lanes' order and the tracks' sort, groups and filter, kept in this browser only [259]: two
 * operators can each keep their own, and nothing goes into the mission's log. The order is kept for
 * each mission; the sort, groups and filter for every mission.
 */
const LANES_EVENT = "v2m-cp-lanes";
const TRACK_VIEW_KEY = "v2m-cp-tracks";
const orderKey = (session: string) => `v2m-cp-order:${session}`;
const lanesStore = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value == null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {}
    window.dispatchEvent(new Event(LANES_EVENT));
  },
  subscribe(cb: () => void) {
    window.addEventListener(LANES_EVENT, cb);
    window.addEventListener("storage", cb);
    return () => {
      window.removeEventListener(LANES_EVENT, cb);
      window.removeEventListener("storage", cb);
    };
  },
};

/** A strip being dragged within its own list [259]: the lane, its key, its list, and where it would land. */
type LaneDrag = { lane: "units" | "tracks"; key: string; list: string; to: number };

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
/** The computer is set to show less motion: then nothing on the map moves by itself [238]. */
function subscribeReducedMotion(cb: () => void) {
  const q = window.matchMedia(REDUCED_MOTION);
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
}

/**
 * The way a track is moving, as a bold arrow from the middle of its symbol. milsymbol's own
 * indicator is a thin black line that hardly shows past the frame, so this one is drawn on its own,
 * under the symbol: only the part outside the frame shows. In screen pixels, for a symbol of size s.
 */
function headingArrow(s: number) {
  return { len: Math.round(2.4 * s), shaft: Math.max(4, Math.round(0.22 * s)), headW: Math.round(0.95 * s), headL: Math.round(0.8 * s), halo: Math.max(2, Math.round(0.1 * s)) };
}

/**
 * The arrow's images: pointing up, dark with a white edge, its tail at the bottom middle. The
 * first is the still arrow. The rest are the steps of the flow [238]: the same arrow with light
 * bands across it, each step a little nearer the tip, so shown in turn the bands run the way the
 * track was said to be moving. The arrow itself never moves, fades or changes shape.
 */
function headingArrowImages(s: number): { still: ImageData; flow: ImageData[] } | null {
  const a = headingArrow(s);
  const r = 2;
  const w = a.headW + 2 * a.halo;
  const h = a.len + a.halo;
  const canvas = document.createElement("canvas");
  canvas.width = w * r;
  canvas.height = h * r;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.scale(r, r);
  const x = w / 2;
  const tip = a.halo;
  const neck = tip + a.headL;
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(x, tip);
    ctx.lineTo(x + a.headW / 2, neck);
    ctx.lineTo(x + a.shaft / 2, neck);
    ctx.lineTo(x + a.shaft / 2, h);
    ctx.lineTo(x - a.shaft / 2, h);
    ctx.lineTo(x - a.shaft / 2, neck);
    ctx.lineTo(x - a.headW / 2, neck);
    ctx.closePath();
  };
  const gap = Math.round(0.58 * s);
  const rise = 0.85 * x;
  const draw = (phase: number | null): ImageData => {
    ctx.clearRect(0, 0, w, h);
    trace();
    ctx.lineJoin = "round";
    ctx.lineWidth = 2 * a.halo;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.fillStyle = "#16212c";
    ctx.fill();
    if (phase != null) {
      // Bands shaped like the arrow's head, cut to the dark part so the white edge stays whole.
      ctx.save();
      trace();
      ctx.clip();
      ctx.lineJoin = "miter";
      ctx.lineWidth = Math.max(3, 0.14 * s);
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      for (let y = tip - rise - phase * gap; y < h + gap; y += gap) {
        ctx.beginPath();
        ctx.moveTo(0, y + rise);
        ctx.lineTo(x, y);
        ctx.lineTo(w, y + rise);
        ctx.stroke();
      }
      ctx.restore();
    }
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  };
  return { still: draw(null), flow: Array.from({ length: FLOW_STEPS }, (_, i) => draw(i / FLOW_STEPS)) };
}

/**
 * A track in one line beside its name: what it is and where, and a tone for the strip. Who saw it
 * or placed it, its grid and its last known time stay in the card and its history.
 */
function trackStatus(t: TrackState, old: boolean): { main: string; tone: UnitTone } {
  // "hostile vehicle ×2" without its first word: the pill beside the name already says whose it is.
  const what = describeTrack(t).replace(/^\S+\s*/, "") || "kind not said";
  if (t.pendingReport) return { main: `${what} · where it is waits for an answer`, tone: "ask" };
  const p = t.position;
  if (t.gone != null) return { main: `${what} · off the map`, tone: "silent" };
  if (!p) return { main: `${what} · not placed`, tone: "none" };
  const moving = t.heading ? ` · moving ${t.heading.replace("_", "-")}, as said` : "";
  return { main: `${what} · ${p.estimated ? "≈ " : ""}${p.label} · ±${p.radius_m} m${moving}`, tone: old ? "silent" : p.estimated ? "estimate" : "placed" };
}

/**
 * What the command post is doing on the map: placing a new track, moving one, changing what one
 * is, or placing a unit. `at` is where the track or unit would go, once the map was clicked or a
 * place picked; `label` is the name the coordinator will give it, filled in when the answer comes.
 */
type Draft = { lat: number; lon: number; place?: string; label: string | null; minRadius?: number };
type Tool =
  | { kind: "place"; what: TrackWhat; radius: number; at: Draft | null }
  | { kind: "move"; n: number; radius: number; at: Draft | null }
  | { kind: "edit"; n: number; what: TrackWhat }
  /** A unit placed by hand: the app did not place it, or placed it wrongly [243]. */
  | { kind: "unit"; callsign: string; radius: number; at: Draft | null };

/**
 * The decision open in the Decisions list [240]: by id, and where it stood in the list, so that
 * when it is settled (here or on another screen) the one that takes its place opens next.
 */
type Focus = { id: string; index: number };

/** An option picked in the open decision, waiting for its confirm. */
type Selection = { id: string; option: DecisionOption };

/**
 * A unit's state as one word (so it is never told by colour alone) and one line of detail.
 * An open question comes first, even for a silent unit: it is the one that needs the operator.
 */
function unitStatus(u: UnitState, silent: boolean, silentAtEnd: string | null): { tag: string; text: string; tone: UnitTone } {
  if (u.pending) return { tag: "Awaiting answer", text: u.pending.question, tone: "ask" };
  // A question with no choices waits for the operator too [242].
  if (u.prompt) return { tag: "Awaiting answer", text: u.prompt.question, tone: "ask" };
  const p = u.position;
  // On the roster, and no report from it yet [201]. One a person placed by hand has a place to show [243].
  if (u.lastHeard === 0 && !p) return { tag: "On roster", text: "Not heard yet.", tone: "none" };
  const where = p ? `${p.label} · ±${p.radius_m} m${u.placedBy ? ` · placed by ${u.placedBy}` : ""}` : "";
  const looking = u.task ? ` · looking at T${u.task.n}` : "";
  if (silent) {
    const last = p ? `Last known at ${p.estimated ? "≈ " : ""}${where}` : "Never placed.";
    return { tag: "Silent", text: silentAtEnd ? `Silent for ${silentAtEnd} when the mission ended. ${last}${looking}` : `${last}${looking}`, tone: "silent" };
  }
  if (!p) return { tag: "Not placed", text: u.joined != null ? "Joined. Waiting for a check-in." : "Waiting for a check-in.", tone: "none" };
  return p.estimated ? { tag: "≈ Estimate", text: `${where}${looking}`, tone: "estimate" } : { tag: "Placed", text: `${where}${looking}`, tone: "placed" };
}

export default function CommandPost() {
  // ?session= picks the mission; with none, the newest open one is shown. ?area= pins the map to one area.
  const search = useSyncExternalStore(subscribeLocation, () => window.location.search, () => "");
  const { session, fixedArea, moment, deepTrack } = useMemo(() => {
    const q = new URLSearchParams(search);
    const a = q.get("area");
    const t = Number(q.get("t"));
    const tr = Number(q.get("track"));
    return {
      // ?demo=1 is the short link for the recorded mission; with a session too, the demo wins.
      session: q.get("demo") === "1" ? DEMO_SESSION : sessionCode(q.get("session")),
      fixedArea: isAreaId(a) ? a : null,
      moment: Number.isFinite(t) && t > 0 ? Math.round(t) : null,
      deepTrack: Number.isInteger(tr) && tr > 0 ? tr : null,
    };
  }, [search]);
  /** A shared moment is opened once per URL, not on every poll. */
  const appliedDeepLink = useRef("");
  /** When this operator last had this mission open: what the Timeline calls new [273]. */
  const [seenBefore, setSeenBefore] = useState<number | null>(null);

  // What was new since this operator last opened the mission; kept in this browser only [273].
  useEffect(() => {
    if (!session) {
      queueMicrotask(() => setSeenBefore(null));
      return;
    }
    const key = `cp-seen:${session}`;
    let previous: number | null = null;
    try {
      const raw = localStorage.getItem(key);
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) previous = n;
      localStorage.setItem(key, String(Date.now()));
    } catch {
      // A private window can refuse storage; then there is no "new since".
    }
    queueMicrotask(() => setSeenBefore(previous));
  }, [session]);

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
  const otherMissions = session === DEMO_SESSION ? [] : missions.filter((m) => m.code !== session && m.ended == null && m.reports > 0 && now - m.last < 120_000);
  const [mode, setMode] = useState<"live" | "replay">("live");
  const [replayT, setReplayT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [follow, setFollow] = useState(true);
  const [manualArea, setManualArea] = useState<AreaId | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** The report or event opened in the inspector: its words, intent, rule and timings. */
  const [inspected, setInspected] = useState<FeedItem | null>(null);
  /** A first visit's short card. It never returns once dismissed in this browser. */
  const [welcome, setWelcome] = useState(false);
  /** The fix that put a unit back at its last report, so the one-click is not offered twice. */
  const [undoAt, setUndoAt] = useState<Record<string, number>>({});
  /** The feed or timeline row under the pointer, shown as a halo on the map [273]. */
  const [hoverEvent, setHoverEvent] = useState<FeedItem | null>(null);
  const hoverMarker = useRef<Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [satellite, setSatellite] = useState(false);
  /** On a narrow screen the lists below the map can fold away, so the map takes the height [262]. */
  const [listsOpen, setListsOpen] = useState(true);
  /** The lists were folded by an entity panel, not by the operator: restore them when it closes. */
  const autoFoldedLists = useRef(false);
  /** The lists' height while open, in pixels: dragged by the grip above them [263]. null is the default. */
  const [listsHeight, setListsHeight] = useState<number | null>(null);
  /** The pointer's place during a drag of the lists' grip. */
  const listsDrag = useRef<{ y: number; h: number } | null>(null);
  /** The Decisions card can fold to its heading, and the replay bar to one button, to clear the map [263]. */
  const [deckCollapsed, setDeckCollapsed] = useState(false);
  const [barCompact, setBarCompact] = useState(true);
  /** The replay bar shows the whole day, or only this mission [271]. */
  const [barZoom, setBarZoom] = useState(false);
  /** The command post's lock [266]: viewing is open, changing needs the PIN when CP_PIN is set. */
  const [auth, setAuth] = useState<"checking" | "open" | "locked">("checking");
  const [pin, setPin] = useState("");
  const [authError, setAuthError] = useState("");
  /** Find a unit, a track or a place from the keyboard [268]. */
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState("");
  const [findAt, setFindAt] = useState(0);
  const [placeResults, setPlaceResults] = useState<StartPoint[]>([]);
  /** The mission's events, newest first, to jump back to a moment [271]. */
  const [timelineOpen, setTimelineOpen] = useState(false);
  /** What the timeline shows, and what to look for in it [271]. */
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const [timelineQuery, setTimelineQuery] = useState("");
  /** The timeline's time window, in minutes; 0 is all of it [273]. */
  const [timelineWindow, setTimelineWindow] = useState<0 | 5 | 15 | 60>(0);
  /** The keyboard and click help [271]. */
  const [helpOpen, setHelpOpen] = useState(false);
  /** The header's More menu: Brief, Help and Stop mission [274]. */
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  /** The screen wake lock, for a tablet at the post [273]. */
  const [awake, setAwake] = useState(false);
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);
  /** The map has taken long to load: with no network it never does, and the page should say so. */
  const [mapSlow, setMapSlow] = useState(false);
  /** Bumped when the map changes size, so following refits (a projector often changes the window). */
  const [mapSize, setMapSize] = useState("");
  /** Too short for the full card and bar beside the dock and the tools: those fold, or the map is lost [263]. */
  const mapShort = useMemo(() => {
    const [, h] = (mapSize || "").split("x").map(Number);
    return h > 0 && h < 260;
  }, [mapSize]);
  const barShut = barCompact || mapShort;
  const cardShut = deckCollapsed || mapShort;
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
  const [focus, setFocus] = useState<Focus | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  /** The unit whose strip is open: its whole line, what it is and "Move" [258]. */
  const [openUnit, setOpenUnit] = useState<string | null>(null);
  /** The reports under the tracks: folded to the newest one, or the whole history [258]. */
  const [reportsOpen, setReportsOpen] = useState(false);
  /** On a phone the lists share one place under the map, one at a time [258]. */
  const [tab, setTab] = useState<"units" | "tracks" | "reports">("units");
  // The lanes' order on this screen, and the tracks' sort, groups and filter [259].
  const ordersRaw = useSyncExternalStore(lanesStore.subscribe, () => (session ? lanesStore.get(orderKey(session)) : null), () => null);
  const orders = useMemo(() => parseOrders(ordersRaw), [ordersRaw]);
  const trackViewRaw = useSyncExternalStore(lanesStore.subscribe, () => lanesStore.get(TRACK_VIEW_KEY), () => null);
  const trackView = useMemo(() => parseTrackView(trackViewRaw), [trackViewRaw]);
  /** Changes part of the view, from what is saved now: two changes in one moment both hold. */
  const updateTrackView = useCallback((change: (v: TrackView) => Partial<TrackView>) => {
    const now = parseTrackView(lanesStore.get(TRACK_VIEW_KEY));
    lanesStore.set(TRACK_VIEW_KEY, JSON.stringify({ ...now, ...change(now) }));
  }, []);
  const saveOrders = useCallback(
    (o: LaneOrders) => {
      if (session) lanesStore.set(orderKey(session), o.units.length || o.tracks.length ? JSON.stringify(o) : null);
    },
    [session],
  );
  /** The tracks' sort, groups and filter, open under their one-line summary. */
  const [viewOpen, setViewOpen] = useState(false);
  /** The track groups folded under their headings, as "group:id". */
  const [folded, setFolded] = useState<string[]>([]);
  const [drag, setDrag] = useState<LaneDrag | null>(null);
  /** Where a press on a strip started, until it moves far enough to be a drag or ends as a click. */
  const press = useRef<{ lane: LaneDrag["lane"]; key: string; list: string; y: number; ul: HTMLUListElement; scroller: HTMLElement; started: boolean; cancelled: boolean; to: number } | null>(null);
  /** A drag just ended: the click that follows it is not a click on the strip. */
  const swallowClick = useRef(false);
  /** The strip moved with the keys: it keeps the cursor after the list is drawn again. */
  const refocus = useRef<string | null>(null);
  /**
   * The Decisions card's side of the map, chosen away from each decision as it opens, or the place
   * the operator dragged it to, in pixels from the map's top left, with the map's size then [258].
   */
  const [deckSide, setDeckSide] = useState<DeckSide>("right");
  const deckSideRef = useRef<DeckSide>("right");
  const [deckPin, setDeckPin] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const deckEl = useRef<HTMLDivElement>(null);
  /** The decision the card's side was chosen for: it does not move again for the same one. */
  const deckFor = useRef<string | null>(null);
  /** Set when the operator moves to a decision, or settles one: the map frames the next one. */
  const frameNext = useRef(false);

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
  /** True while the grid tools' ruler is on: a click then measures, and places or picks nothing [245]. */
  const measuring = useRef(false);
  const setMeasuring = useCallback((on: boolean) => {
    measuring.current = on;
  }, []);
  /** "Go to grid" moves the map away from the units: it stays there until "Follow units" [245]. */
  const stopFollowing = useCallback(() => setFollow(false), []);

  // The lists' grip on a narrow screen [263]. Dragging up grows the lists and shrinks the map;
  // 40 px or less shuts them, leaving the tabs. The arrow keys do the same without a pointer.
  const listsMax = useCallback(() => Math.max(0, window.innerHeight - 380), []);
  const startListsDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      // The bar's bottom is the lists' top: the grip sits on the bar's top edge [263].
      const bar = e.currentTarget.parentElement?.getBoundingClientRect().bottom;
      const bottom = bar ?? e.currentTarget.getBoundingClientRect().bottom;
      listsDrag.current = { y: e.clientY, h: listsOpen ? Math.max(0, window.innerHeight - bottom) : 0 };
    },
    [listsOpen],
  );
  const moveListsDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = listsDrag.current;
    if (!drag) return;
    const next = Math.max(0, Math.min(listsMax(), drag.h + drag.y - e.clientY));
    setListsOpen(next >= 40);
    setListsHeight(next);
  }, [listsMax]);
  const endListsDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      listsDrag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (listsHeight != null && listsHeight < 40) {
        setListsOpen(false);
        setListsHeight(0);
      }
    },
    [listsHeight],
  );
  const nudgeLists = useCallback(
    (delta: number) => {
      const now = listsHeight ?? Math.round(window.innerHeight * 0.18);
      const next = Math.max(0, Math.min(listsMax(), now + delta));
      setListsOpen(next >= 40);
      setListsHeight(next);
    },
    [listsHeight, listsMax],
  );
  // A taller window keeps the dragged height; a shorter one gives the map its floor back.
  useEffect(() => {
    const onResize = () => setListsHeight((h) => (h == null ? h : Math.min(h, Math.max(0, window.innerHeight - 380))));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // The lock, read once: with CP_PIN unset the coordinator says it needs no PIN [266].
  useEffect(() => {
    let cancelled = false;
    fetch("/api/cp/login", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((said: { required?: boolean; signedIn?: boolean } | null) => {
        if (!cancelled) setAuth(said?.required && !said.signedIn ? "locked" : "open");
      })
      .catch(() => {
        if (!cancelled) setAuth("open");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      const r = await fetch("/api/cp/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (r.ok) {
        setPin("");
        setAuth("open");
        return;
      }
      const said = (await r.json().catch(() => null)) as { error?: string } | null;
      setAuthError(said?.error ?? "Wrong PIN.");
    } catch {
      setAuthError("The coordinator did not answer.");
    }
  };
  // Ctrl+K (or Cmd+K) opens the find box wherever the operator is [268].
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  /** The replay bar lies over the bottom of the map, with the map's credits above it: the grid's figures stay above both [245]. */
  const replayEl = useRef<HTMLDivElement>(null);
  const coveredBelow = useCallback(() => {
    const m = mapEl.current?.getBoundingClientRect();
    if (!m) return 0;
    const tops = [replayEl.current, mapEl.current?.querySelector(".maplibregl-ctrl-attrib")].map((el) => el?.getBoundingClientRect().top ?? m.bottom);
    return Math.max(0, m.bottom - Math.min(...tops));
  }, []);
  /** The track symbol being placed or moved: a marker that can be dragged. */
  const draftMarker = useRef<Marker | null>(null);
  // Motion on the map [238]. Where each unit and track is drawn while it slides to a new place,
  // the picture each was last drawn for, and the two drawings, so a slide can run them every frame.
  const unitSlides = useRef(new Slides());
  const trackSlides = useRef(new Slides());
  const unitScene = useRef<Scene | null>(null);
  const trackScene = useRef<Scene | null>(null);
  const drawUnits = useRef<(t: number) => void>(() => {});
  const drawTracks = useRef<(t: number) => void>(() => {});
  const slideFrame = useRef(0);
  /** The arrows whose reports are fresh: each unit's shaft from its marker, and the image the tracks' arrows share. */
  const flowShafts = useRef<{ from: LatLon; to: LatLon }[]>([]);
  const flowArrow = useRef<{ id: string; frames: ImageData[] } | null>(null);
  /** The steps of the flowing arrow, by image: one set for each size of symbol. */
  const flowFrames = useRef(new Map<string, ImageData[]>());
  /** The tracks on the map at the last drawing, by picture and number: one not among them is new. */
  const onMapBefore = useRef(new Set<string>());
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => false);

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
  /** The recorded mission the public site shows: everything that writes is hidden. */
  const demo = session === DEMO_SESSION;
  // The moment the picture stands for. An ended mission is shown as it was when it ended, so its
  // units do not all read as silent for the hours since. The demo is frozen at its last line, so
  // a page left open all afternoon still shows a fresh patrol.
  const effNow = mode === "live" ? (ended ?? (demo ? (full.last ?? now) : now)) : replayT;
  const area: AreaId = fixedArea ?? mission?.area ?? manualArea ?? view.area ?? DEFAULT_AREA;
  // Place names from the area's gazetteer, beside the call signs and tracks [268].
  useEffect(() => {
    const q = find.trim();
    if (!findOpen || q.length < 2) return;
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/places?area=${area}&q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!r.ok) return;
        const said = (await r.json()) as { places?: StartPoint[] };
        setPlaceResults(said.places ?? []);
      } catch {}
    }, 180);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [find, findOpen, area]);
  // From when it was last heard, or placed by hand if that is later [243].
  const isSilent = useCallback((u: UnitState) => effNow > 0 && effNow - knownAt(u) > FADE_AFTER_MS, [effNow]);
  /** A track nobody has reported for a while: its place is an old sighting, and the page says so. */
  const isOld = useCallback((t: TrackState) => effNow > 0 && effNow - t.seenTs > TRACK_OLD_AFTER_MS, [effNow]);

  // ---------- the lanes: units and tracks in the order this screen keeps [259] ----------
  const unitKeys = useMemo(() => withSaved(view.units.map((u) => u.callsign), orders.units), [view.units, orders.units]);
  const arranged = useMemo(() => arrangeTracks(view.tracks, trackView, orders.tracks, isOld), [view.tracks, trackView, orders.tracks, isOld]);
  /** Moves a strip next to a neighbour in its own list and keeps that order. A track moved by hand puts the list in "My order". */
  const moveStrip = useCallback(
    (lane: LaneDrag["lane"], key: string, anchor: string, side: "before" | "after") => {
      if (lane === "units") saveOrders({ ...orders, units: moveNextTo(unitKeys, key, anchor, side) });
      else {
        saveOrders({ ...orders, tracks: moveNextTo(arranged.order, Number(key), Number(anchor), side) });
        updateTrackView(() => ({ sort: "mine" }));
      }
    },
    [orders, unitKeys, arranged.order, saveOrders, updateTrackView],
  );
  /** Alt+↑ and Alt+↓ move the strip with the cursor one place within its list. */
  const moveByKey = (e: ReactKeyboardEvent, lane: LaneDrag["lane"], key: string, list: string[]) => {
    if (!e.altKey || e.metaKey || e.ctrlKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const i = list.indexOf(key);
    const next = list[e.key === "ArrowUp" ? i - 1 : i + 1];
    if (i < 0 || next == null) return;
    refocus.current = `${lane}:${key}`;
    moveStrip(lane, key, next, e.key === "ArrowUp" ? "before" : "after");
  };
  useEffect(() => {
    if (!refocus.current) return;
    const el = document.querySelector<HTMLElement>(`[data-lane-key="${CSS.escape(refocus.current)}"] > button`);
    refocus.current = null;
    if (el && document.activeElement !== el) el.focus();
  }, [unitKeys, arranged]);
  /** A press on a strip with a mouse or pen: it becomes a drag once it moves 6 px up or down. Touch scrolls the list instead. */
  const pressStrip = (e: ReactPointerEvent<HTMLElement>, lane: LaneDrag["lane"], key: string, list: string) => {
    const ul = e.currentTarget.closest("ul");
    if (e.button !== 0 || e.pointerType === "touch" || !ul) return;
    press.current = { lane, key, list, y: e.clientY, ul, scroller: ul.closest<HTMLElement>("[data-lane-scroll]") ?? ul, started: false, cancelled: false, to: -1 };
  };
  // The lists a drag can land in, and the move it makes, for the listeners below.
  const listKeys = useRef<Map<string, string[]>>(new Map());
  const moveRef = useRef(moveStrip);
  useEffect(() => {
    const lists = new Map<string, string[]>([["units", unitKeys]]);
    for (const s of arranged.sections) lists.set(s.id, s.tracks.map((t) => String(t.n)));
    listKeys.current = lists;
    moveRef.current = moveStrip;
  }, [unitKeys, arranged, moveStrip]);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = press.current;
      if (!p || p.cancelled) return;
      if (!p.started) {
        if (Math.abs(e.clientY - p.y) < 6) return;
        p.started = true;
      }
      // Where it lands: past the middle of each other strip in its list.
      const self = `${p.lane}:${p.key}`;
      let to = 0;
      for (const li of p.ul.querySelectorAll<HTMLElement>(":scope > li[data-lane-key]")) {
        if (li.dataset.laneKey === self) continue;
        const r = li.getBoundingClientRect();
        if (e.clientY > r.top + r.height / 2) to++;
      }
      // Near the top or bottom of a long list, it scrolls.
      const box = p.scroller.getBoundingClientRect();
      if (e.clientY < box.top + 24) p.scroller.scrollBy(0, -12);
      else if (e.clientY > box.bottom - 24) p.scroller.scrollBy(0, 12);
      if (to !== p.to) {
        p.to = to;
        setDrag({ lane: p.lane, key: p.key, list: p.list, to });
      }
    };
    const onUp = () => {
      const p = press.current;
      press.current = null;
      if (!p?.started) return;
      swallowClick.current = true;
      window.setTimeout(() => (swallowClick.current = false), 0);
      setDrag(null);
      if (p.cancelled) return;
      const landing = anchorFor(listKeys.current.get(p.list) ?? [], p.key, p.to);
      if (landing) moveRef.current(p.lane, p.key, landing.anchor, landing.side);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !press.current?.started) return;
      // Escape only drops the strip back: it does not also step back on the map.
      e.preventDefault();
      e.stopPropagation();
      press.current.cancelled = true;
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
  /** A list's keys as drawn: with the dragged strip where it would land. */
  const asDrawn = (list: string, keys: string[]) => (drag && drag.list === list ? previewMove(keys, drag.key, drag.to) : keys);
  /** The click at the end of a drag lands on the strip: it is not a click on it. */
  const swallowDragClick = (e: { stopPropagation(): void; preventDefault(): void }) => {
    if (!swallowClick.current) return;
    e.stopPropagation();
    e.preventDefault();
  };
  const toggleHide = (h: TrackHide) => updateTrackView((v) => ({ hide: v.hide.includes(h) ? v.hide.filter((x) => x !== h) : [...v.hide, h] }));
  // Things on the map move only while the clock on screen runs [238]: a live mission that has not
  // ended, or a replay that is playing. A paused replay and an ended mission are one moment, held.
  const motion = !reducedMotion && (mode === "live" ? ended == null : playing);
  /** The picture on screen, for telling a step of its clock from a jump, and the longest step. */
  const sceneKey = `${session ?? ""}:${mode}`;
  const maxStepMs = Math.max(2500, 3 * STEP_MS * speed);
  /** A fresh report gave a way of moving: a track's heading, or the place a unit is heading to. */
  const flowTracks = useMemo(() => view.tracks.some((t) => t.heading && t.position && t.gone == null && !isOld(t)), [view, isOld]);
  const flowUnits = useMemo(() => view.units.some((u) => u.position?.heading_to && !isSilent(u)), [view, isSilent]);

  /** Changes are made only to the present of an open mission that this coordinator keeps. */
  const canEdit = !!session && !!mission && ended == null && mode === "live" && stored === true && !demo;

  // ---------- the Decisions list [240] ----------
  const decisions = useMemo(() => decisionsOf(view), [view]);
  /** Report id (or held or request id) to its place in the list. */
  const decisionAt = useMemo(() => new Map(decisions.map((d, i) => [d.id, i])), [decisions]);
  /** The open decision: the one the operator moved to, or the one that took its place, or the oldest. */
  const focusedAt = useMemo(() => {
    if (!decisions.length) return -1;
    const i = focus ? (decisionAt.get(focus.id) ?? -1) : -1;
    return i >= 0 ? i : Math.min(focus?.index ?? 0, decisions.length - 1);
  }, [decisions, decisionAt, focus]);
  const focused: Decision | null = focusedAt >= 0 ? decisions[focusedAt] : null;
  /**
   * An answer the coordinator heard for the open question [251]: its choice is picked already, and
   * waits for the confirm like any other pick. Nothing is saved until the operator confirms.
   */
  const heardFor = focused?.kind === "question" ? (focused.item.heard ?? null) : null;
  const heardKey = focused && heardFor ? `${focused.id}:${heardFor.ts}` : null;
  /** The answer heard that the operator stepped back from: it is not picked again by itself. */
  const [heardOff, setHeardOff] = useState<string | null>(null);
  const heardChoice = heardFor?.choice ?? null;
  const heardName = heardFor?.name ?? "";
  const heardOption = useMemo<DecisionOption | null>(() => (heardChoice ? { kind: "choice", choice: heardChoice, name: heardName } : null), [heardChoice, heardName]);
  const ownPick = selection && focused && selection.id === focused.id ? selection.option : null;
  /** The option picked in the open decision, waiting for its confirm: the operator's, or the answer heard. */
  const picking = ownPick ?? (canEdit && heardKey !== heardOff ? heardOption : null);
  /** Steps back from a pick; an answer heard then stays unpicked. */
  const unpick = useCallback(() => {
    setSelection(null);
    if (heardKey) setHeardOff(heardKey);
  }, [heardKey]);

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
    setSelection(null);
    setFocus(null);
    setConfirmEnd(false);
    showSession(code, true);
  }, [setPicked, setSelection, setFocus]);

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

  // A shared link opens the mission at its moment, with the track that was open [273].
  useEffect(() => {
    if (moment == null || !session || !stretches.length) return;
    const key = `${session}:${moment}:${deepTrack ?? ""}`;
    if (appliedDeepLink.current === key) return;
    appliedDeepLink.current = key;
    queueMicrotask(() => {
      setTimelineOpen(false);
      setOpenUnit(null);
      setBarCompact(false);
      setFollow(false);
      setPlaying(false);
      setReplayOpen(true);
      scrub(moment);
      if (deepTrack != null) setPicked(deepTrack);
    });
  }, [moment, deepTrack, session, stretches.length, scrub]);

  // A short card for a first visit with no mission on screen: on the public site, the way in.
  useEffect(() => {
    if (session) return;
    try {
      if (window.localStorage.getItem("vtm-welcome-1")) return;
    } catch {
      return;
    }
    const t = setTimeout(() => setWelcome(true), 1200);
    return () => clearTimeout(t);
  }, [session]);
  const closeWelcome = useCallback(() => {
    setWelcome(false);
    try {
      window.localStorage.setItem("vtm-welcome-1", "1");
    } catch {
      // A private window that refuses storage still closes the card.
    }
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      const el = moreRef.current;
      if (el && !el.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [moreOpen]);

  /** Copies a link that opens this replay at this moment, and the picked track [273]. */
  const copyMoment = async () => {
    const url = new URL(window.location.href);
    if (session) url.searchParams.set("session", session);
    url.searchParams.set("t", String(Math.round(replayT)));
    if (picked != null) url.searchParams.set("track", String(picked));
    else url.searchParams.delete("track");
    if (await copyText(url.toString())) setNotice("Link to this moment copied.");
    else setNotice("Could not copy the link.");
  };
  /** Copies a plain-text handover of the mission, built from the view [273]. */
  const copySituation = async () => {
    const text = handover(view, {
      session,
      now: effNow > 0 ? effNow : Date.now(),
      mode: ended != null ? "ended" : mode,
      format: fmtTime,
    });
    if (await copyText(text)) setNotice("Situation copied.");
    else setNotice("Could not copy the situation.");
  };
  /** Keeps a tablet's screen on while the operator is at the radio [273]. */
  const toggleAwake = async () => {
    if (awake) {
      try {
        await wakeRef.current?.release();
      } catch {
        // The browser may have released it already.
      }
      wakeRef.current = null;
      setAwake(false);
      return;
    }
    try {
      type Sentinel = { release: () => Promise<void>; addEventListener: (type: "release", cb: () => void) => void };
      const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<Sentinel> } };
      if (!nav.wakeLock) throw new Error("no wake lock");
      const sentinel = await nav.wakeLock.request("screen");
      wakeRef.current = sentinel;
      sentinel.addEventListener("release", () => setAwake(false));
      setAwake(true);
      setNotice("The screen stays awake.");
    } catch {
      setNotice("This browser would not keep the screen awake.");
    }
  };
  useEffect(() => () => {
    void wakeRef.current?.release();
  }, []);

  // A row under the pointer lights its place on the map, without moving the replay [273].
  useEffect(() => {
    if (timelineOpen) return;
    queueMicrotask(() => setHoverEvent(null));
  }, [timelineOpen]);

  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    hoverMarker.current?.remove();
    hoverMarker.current = null;
    if (!map || !ml || !mapReady || !hoverEvent?.position) return;
    const el = document.createElement("div");
    el.className = styles.hoverHalo;
    el.setAttribute("aria-hidden", "true");
    const marker = new ml.Marker({ element: el, anchor: "center" })
      .setLngLat([hoverEvent.position.lon, hoverEvent.position.lat])
      .addTo(map);
    hoverMarker.current = marker;
    return () => {
      marker.remove();
      if (hoverMarker.current === marker) hoverMarker.current = null;
    };
  }, [hoverEvent, mapReady]);

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
      const [ml, base] = await Promise.all([import("maplibre-gl"), loadBaseMap()]);
      if (cancelled || !mapEl.current) return;
      ml.setWorkerUrl("/maplibre-gl-worker.mjs");
      mlRef.current = ml;
      const start = AREAS[DEFAULT_AREA];
      const map = new ml.Map({
        container: mapEl.current,
        style: base.style,
        center: [start.centre.lon, start.centre.lat],
        zoom: start.zoom,
        // The credits are long now that the photos add IGN and EOX: behind the "i" they no longer
        // run under the Decisions card or the grid's figures [261, 262].
        attributionControl: { compact: true, customAttribution: base.attribution },
      });
      map.addControl(new ml.NavigationControl({ showCompass: true }), "top-right");
      // MapLibre starts a compact attribution expanded: close it, so the long list of sources,
      // IGN and Sentinel included, waits behind the "i" [261].
      map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
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
        for (const id of ["start", "trail", "accuracy", "unit-last", "arrow", "arrow-flow", "target", "pos", "track-acc", "track-last", "track-trail", "track-sight", "track-task", "track-leader", "track", "draft"]) map.addSource(id, { type: "geojson", data: EMPTY_FC });
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
        // A silent unit's last known place, ringed so it is not lost among the live ones [265].
        map.addLayer({
          id: "unit-last-ring",
          type: "circle",
          source: "unit-last",
          paint: {
            "circle-radius": ["get", "radius"],
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": 2,
            "circle-stroke-opacity": 0.9,
          },
        });
        // Tracks: what a unit saw. Their circles and trails lie under every unit's own markings.
        map.addLayer({ id: "track-acc-fill", type: "fill", source: "track-acc", paint: { "fill-color": ["get", "color"], "fill-opacity": ["*", 0.12, op] } });
        map.addLayer({ id: "track-acc-line", type: "line", source: "track-acc", filter: ["!=", "estimated", true], paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": ["*", 0.85, op] } });
        map.addLayer({ id: "track-acc-line-est", type: "line", source: "track-acc", filter: ["==", "estimated", true], paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [3, 2], "line-opacity": ["*", 0.85, op] } });
        // A track nobody has seen for a while keeps a ring on its last known place [265].
        map.addLayer({
          id: "track-last-ring",
          type: "circle",
          source: "track-last",
          paint: {
            "circle-radius": ["get", "radius"],
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": 2,
            "circle-stroke-opacity": 0.9,
          },
        });
        map.addLayer({ id: "track-trail-line", type: "line", source: "track-trail", paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-dasharray": [2, 2], "line-opacity": ["*", 0.7, op] } });
        // The line of sight: from where the observer was to what they saw, dotted in the observer's
        // colour. It has no arrowhead: it says who saw it from where, and nothing else.
        map.addLayer({ id: "track-sight-line", type: "line", source: "track-sight", layout: { "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-dasharray": [0.1, 2.2], "line-opacity": 0.85 } });
        // Recon: a friendly drone or drone team the command post sent to look at a track [234]. A
        // solid line in the friendly colour, with no arrowhead: who is looking at what, nothing else.
        map.addLayer({ id: "track-task-line", type: "line", source: "track-task", layout: { "line-cap": "round" }, paint: { "line-color": AFFILIATION_COLOUR.friendly, "line-width": 2, "line-opacity": 0.8 } });
        map.addLayer({ id: "arrow-shaft", type: "line", source: "arrow", filter: ["==", "part", "shaft"], layout: { "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": op } });
        map.addLayer({ id: "arrow-head", type: "fill", source: "arrow", filter: ["==", "part", "head"], paint: { "fill-color": ["get", "color"], "fill-opacity": op } });
        // White dots that run along the shaft to the place a unit said it is heading to, while
        // its report is fresh [238]. They say the report is live, not how fast the unit goes.
        map.addLayer({ id: "arrow-flow", type: "circle", source: "arrow-flow", paint: { "circle-radius": 1.7, "circle-color": "#ffffff", "circle-opacity": 0.95 } });
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
            "text-field": ["get", "trackLabel"],
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
        // A unit's marker is a click away from its panel too.
        map.on("mouseenter", "pos", () => {
          if (!map.getCanvas().style.cursor) map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "pos", () => {
          if (map.getCanvas().style.cursor === "pointer") map.getCanvas().style.cursor = "";
        });
        // The photo view [260]: added under the units and tracks, hidden until the operator asks.
        // With the saved map, it reads the photos saved beside it too, so it works with no internet [261].
        addSatelliteLayers(map, base.source === "hosted" ? "online" : "saved");
        // The style's own sources may have added the compact attribution expanded; keep it shut [262].
        map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
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

  // The photo view follows the button. The layers were added with the map's own, so showing them
  // only changes their visibility [260].
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    setSatelliteVisible(map, satellite);
  }, [satellite, mapReady]);

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

  // A marker slides to its new place [238]: both drawings run every frame until all have arrived.
  const runSlides = useCallback(() => {
    if (slideFrame.current) return;
    const step = () => {
      const t = performance.now();
      drawUnits.current(t);
      drawTracks.current(t);
      slideFrame.current = unitSlides.current.active(t) || trackSlides.current.active(t) ? requestAnimationFrame(step) : 0;
    };
    slideFrame.current = requestAnimationFrame(step);
  }, []);
  useEffect(() => () => cancelAnimationFrame(slideFrame.current), []);

  // Draw every unit: marker with call sign and time, circle, trail, movement arrow.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    // A unit whose place changed with a step of the clock slides there. After a jump (another
    // mission, live to replay, a drag along the bar) it is drawn where it is.
    const scene = { key: sceneKey, t: effNow };
    const slideMs = motion && steppedOn(unitScene.current, scene, maxStepMs) ? (mode === "live" ? SLIDE_MS : SLIDE_MS_REPLAY) : 0;
    unitScene.current = scene;
    const places = new Map<string, LatLon>();
    for (const u of view.units) if (u.position && u.positionTs != null) places.set(u.callsign, u.position);
    const sliding = unitSlides.current.retarget(places, performance.now(), slideMs);
    const draw = (now: number) => {
      const pos: GeoJSON.Feature[] = [];
      const acc: GeoJSON.Feature[] = [];
      const trail: GeoJSON.Feature[] = [];
      const arrows: GeoJSON.Feature[] = [];
      const targets: GeoJSON.Feature[] = [];
      const shafts: { from: LatLon; to: LatLon }[] = [];
      const last: GeoJSON.Feature[] = [];
      // Units on the same spot share one label: the first unit of the spot carries it.
      const spots = unitSpots(view.units, isSilent);
      const labelled = new Set<string>();
      for (const u of view.units) {
        const silent = isSilent(u);
        const op = silent ? 0.35 : 1;
        const color = u.colour;
        const p = u.position;
        // Where the marker is drawn: its place, or a point on the way there while it slides.
        const q = p ? (unitSlides.current.at(u.callsign, now) ?? p) : null;
        const pts = [...u.trail, ...(q ? [q] : [])];
        if (pts.length > 1) trail.push({ type: "Feature", properties: { color, op }, geometry: { type: "LineString", coordinates: pts.map((x) => [x.lon, x.lat]) } });
        for (const t of u.trail) trail.push({ type: "Feature", properties: { color, op }, geometry: { type: "Point", coordinates: [t.lon, t.lat] } });
        if (!p || !q || u.positionTs == null) continue;
        const k = spotKey(p);
        const spot = spots.get(k);
        const first = !labelled.has(k);
        labelled.add(k);
        const name = first ? (spot?.name ?? u.callsign) : "";
        // A place a person at the command post put there says so on the map too [243].
        const when = first ? [spot?.when, u.placedBy ? "CP" : null].filter(Boolean).join(" · ") : "";
        pos.push({ type: "Feature", properties: { color, op, name, when, callsign: u.callsign, labelOp: spot?.allSilent ? 0.7 : 1 }, geometry: { type: "Point", coordinates: [q.lon, q.lat] } });
        // A silent unit is drawn where it was last known, with a ring saying the place is old [265].
        if (silent) last.push({ type: "Feature", properties: { color, radius: 16 }, geometry: { type: "Point", coordinates: [q.lon, q.lat] } });
        acc.push({ type: "Feature", properties: { color, op, estimated: !!p.estimated }, geometry: { type: "Polygon", coordinates: [circleRing(q, p.radius_m)] } });
        if (p.heading_to) {
          // From the marker, the middle of the circle, so the trail stays visible up to it.
          if (distanceM(q, p.heading_to) > 5) {
            const arrow = arrowFeatures(q, p.heading_to, color, op);
            arrows.push(...arrow);
            // The dots run along the shaft, from the marker to the arrowhead, while the unit is heard.
            const [, end] = (arrow[0].geometry as GeoJSON.LineString).coordinates;
            if (!silent) shafts.push({ from: q, to: { lat: end[1], lon: end[0] } });
          }
          targets.push({ type: "Feature", properties: { color, op }, geometry: { type: "Point", coordinates: [p.heading_to.lon, p.heading_to.lat] } });
        }
      }
      flowShafts.current = shafts;
      const set = (id: string, features: GeoJSON.Feature[]) => (map.getSource(id) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
      set("pos", pos);
      set("unit-last", last);
      set("accuracy", acc);
      set("trail", trail);
      set("arrow", arrows);
      set("target", targets);
    };
    drawUnits.current = draw;
    draw(performance.now());
    if (sliding) runSlides();
  }, [view, isSilent, mapReady, motion, sceneKey, effNow, maxStepMs, mode, runSlides]);

  // Draw every track: its symbol and label, its circle, where it was seen before, and the line of
  // sight from the unit that reported it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const k = screenScale();
    const trackText = Math.round(14 * k);
    const size = Math.round(TRACK_SYMBOL_SIZE * k);
    const ha = headingArrow(size);
    // The arrow for the way a track is moving: one still image, and one whose bands flow [238].
    const arrowIcon = `track-heading:${size}`;
    const flowIcon = `track-heading-flow:${size}`;
    if (symbols && !map.hasImage(arrowIcon)) {
      const imgs = headingArrowImages(size);
      if (imgs) {
        map.addImage(arrowIcon, imgs.still, { pixelRatio: 2 });
        map.addImage(flowIcon, imgs.flow[0], { pixelRatio: 2 });
        flowFrames.current.set(flowIcon, imgs.flow);
      }
    }
    const frames = flowFrames.current.get(flowIcon);
    const canFlow = motion && frames != null && map.hasImage(flowIcon);
    flowArrow.current = canFlow ? { id: flowIcon, frames } : null;
    // A track whose place changed with a step of the clock slides there, as a unit does.
    const scene = { key: sceneKey, t: effNow };
    const stepped = steppedOn(trackScene.current, scene, maxStepMs);
    trackScene.current = scene;
    const places = new Map<string, LatLon>();
    for (const t of view.tracks) if (t.position && t.positionTs != null && t.gone == null) places.set(String(t.n), t.position);
    const sliding = trackSlides.current.retarget(places, performance.now(), motion && stepped ? (mode === "live" ? SLIDE_MS : SLIDE_MS_REPLAY) : 0);
    // The label's bottom, in pixels above the point, when no arrow is in its way.
    const liftPlain = 1.9 * trackText;
    /** Draws every track as it is at this moment of a slide. Gives where each symbol was drawn, by number. */
    const draw = (now: number): Map<number, [number, number]> => {
      const sym: GeoJSON.Feature[] = [];
      const acc: GeoJSON.Feature[] = [];
      const trail: GeoJSON.Feature[] = [];
      const last: GeoJSON.Feature[] = [];
      const sight: GeoJSON.Feature[] = [];
      const leader: GeoJSON.Feature[] = [];
      // Where a unit or a track is drawn: its place, or a point on the way there while it slides.
      const unitAt = (u: UnitState): LatLon | null => (u.position ? (unitSlides.current.at(u.callsign, now) ?? u.position) : null);
      const trackAt = (t: TrackState | undefined): LatLon | null => (t?.position ? (trackSlides.current.at(String(t.n), now) ?? t.position) : null);
      // Each drone sent to look at a track, from the drone to the track [234]. Not drawn when either is gone or not placed.
      const task: GeoJSON.Feature[] = [];
      for (const d of view.tracks) {
        const seen = d.task ? view.tracks.find((t) => t.n === d.task!.n) : undefined;
        const a = trackAt(d);
        const b = trackAt(seen);
        if (!a || !b || d.gone != null || seen!.gone != null || distanceM(a, b) < 5) continue;
        task.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[a.lon, a.lat], [b.lon, b.lat]] } });
      }
      // And from a drone unit on the net, from where it last was [235].
      for (const u of view.units) {
        const seen = u.task ? view.tracks.find((t) => t.n === u.task!.n) : undefined;
        const a = unitAt(u);
        const b = trackAt(seen);
        if (!a || !b || seen!.gone != null || distanceM(a, b) < 5) continue;
        task.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[a.lon, a.lat], [b.lon, b.lat]] } });
      }
      // Each track's symbol and label, before it is laid out: lower numbers first, so an older track
      // keeps its spot and a new one moves.
      const drawn: { n: number; id: string; p: LatLon; color: string; op: number; props: Record<string, unknown>; label: string[]; icon: string; lift: number; arrow: Rect | null }[] = [];
      for (const t of [...view.tracks].sort((a, b) => a.n - b.n)) {
        const p = t.position;
        // A track marked gone stays in the list, not on the map.
        if (!p || t.positionTs == null || t.gone != null) continue;
        const q = trackAt(t) ?? p;
        const old = isOld(t);
        const op = old ? 0.45 : 1;
        const color = AFFILIATION_COLOUR[t.affiliation];
        const pts = [...t.trail, q];
        if (pts.length > 1) trail.push({ type: "Feature", properties: { color, op }, geometry: { type: "LineString", coordinates: pts.map((x) => [x.lon, x.lat]) } });
        acc.push({ type: "Feature", properties: { color, op, estimated: !!p.estimated }, geometry: { type: "Polygon", coordinates: [circleRing(q, p.radius_m)] } });
        if (t.from && !old && distanceM(t.from, q) > 5) {
          sight.push({ type: "Feature", properties: { color: colours.get(t.seenBy) ?? "#475569" }, geometry: { type: "LineString", coordinates: [[t.from.lon, t.from.lat], [q.lon, q.lat]] } });
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
        const when = old ? `Last known ${fmtTime(t.positionTs)}` : `${p.estimated ? "≈ " : ""}${fmtTime(t.positionTs)} · ${t.seenBy}`;
        const pickedNow = t.n === picked;
        const label = [`T${t.n}`];
        const props: Record<string, unknown> = { icon, off, op, labelOp: old ? 0.75 : 1, name, when, trackLabel: `T${t.n}`, n: t.n, picked: pickedNow, textOff: [0, -lift / trackText] };
        // The bands flow while the sighting is fresh. On an old one the arrow is still: the way it
        // was moving is what was said then, not what is known now.
        if (heading != null) Object.assign(props, { heading, arrow: canFlow && !old ? flowIcon : arrowIcon });
        drawn.push({ n: t.n, id: `T${t.n}`, p: q, color, op, icon, label, props, lift, arrow });
        // A track not seen for a while keeps a ring on where it was last known [265].
        if (old) last.push({ type: "Feature", properties: { color, radius: 22 }, geometry: { type: "Point", coordinates: [q.lon, q.lat] } });
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
      for (const s of unitSpots(view.units, isSilent, unitAt).values()) {
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
      const where = new Map<number, [number, number]>();
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
        where.set(d.n, at);
      });

      const set = (id: string, features: GeoJSON.Feature[]) => (map.getSource(id) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
      set("track", sym);
      set("track-last", last);
      set("track-acc", acc);
      set("track-trail", trail);
      set("track-sight", sight);
      set("track-task", task);
      set("track-leader", leader);
      return where;
    };
    drawTracks.current = draw;
    const where = draw(performance.now());
    map.setLayoutProperty("track-sym", "text-size", trackText);
    if (sliding) runSlides();

    // A track that has just come onto the map gets one ring, so the eye finds it [238]. Not for
    // the tracks already there when the page opens, and not after a jump to another moment.
    const ml = mlRef.current;
    const onMap = new Set<string>();
    for (const t of view.tracks) {
      const at = where.get(t.n);
      if (!at || t.positionTs == null) continue;
      const id = `${sceneKey}:${t.n}`;
      onMap.add(id);
      if (!ml || !motion || !stepped || onMapBefore.current.has(id) || Math.abs(effNow - t.positionTs) > NEW_TRACK_MS) continue;
      const el = document.createElement("div");
      el.className = styles.newTrack;
      el.style.setProperty("--ring", AFFILIATION_COLOUR[t.affiliation]);
      el.style.setProperty("--d", `${Math.round(44 * k)}px`);
      el.appendChild(document.createElement("span"));
      const ring = new ml.Marker({ element: el }).setLngLat(at).addTo(map);
      setTimeout(() => ring.remove(), 2200);
    }
    onMapBefore.current = onMap;
  }, [view, isOld, isSilent, effNow, colours, symbols, mapReady, mapSize, zoomKey, picked, motion, sceneKey, maxStepMs, mode, runSlides]);

  // The flow [238]: while a fresh report gave a way of moving and the clock runs, the bands on the
  // tracks' arrows and the dots on the units' arrows take one step every 50 ms. One image serves
  // every track's arrow, so they all step together. With nothing fresh, nothing ticks.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !motion || !(flowTracks || flowUnits)) return;
    let step = 0;
    const tick = () => {
      step = (step + 1) % FLOW_STEPS;
      const f = flowArrow.current;
      if (f && map.hasImage(f.id)) map.updateImage(f.id, f.frames[step]);
      const box = map.getContainer();
      const dots: GeoJSON.Feature[] = [];
      for (const s of flowShafts.current) {
        const from = map.project([s.from.lon, s.from.lat]);
        const to = map.project([s.to.lon, s.to.lat]);
        for (const d of flowDots(from, to, FLOW_DOT_GAP, step / FLOW_STEPS, FLOW_DOT_SKIP)) {
          if (d.x < 0 || d.y < 0 || d.x > box.clientWidth || d.y > box.clientHeight) continue;
          const q = map.unproject([d.x, d.y]);
          dots.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [q.lng, q.lat] } });
        }
      }
      (map.getSource("arrow-flow") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: dots });
    };
    const id = setInterval(tick, FLOW_TICK_MS);
    return () => {
      clearInterval(id);
      // Not when the page is closing: the map is gone by then.
      if (mapRef.current === map) (map.getSource("arrow-flow") as GeoJSONSource | undefined)?.setData(EMPTY_FC);
    };
  }, [mapReady, motion, flowTracks, flowUnits]);

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

  /**
   * A decision's points on the map: the unit and its choices, the unit alone, where a held report
   * would put a unit and the units it may be from, or the unit asking for recon and the track.
   */
  const pointsOf = useCallback(
    (d: Decision): LatLon[] => {
      const unitAt = (c: string) => view.units.find((u) => u.callsign === c)?.position ?? null;
      const pts: LatLon[] = [];
      const add = (p: LatLon | null | undefined) => {
        if (p) pts.push(p);
      };
      if (d.kind === "question") {
        add(unitAt(d.callsign));
        d.item.candidates.forEach(add);
      } else if (d.kind === "prompt") {
        add(unitAt(d.callsign));
      } else if (d.kind === "held") {
        add(d.held.position);
        d.held.candidates.forEach((c) => add(unitAt(c)));
      } else {
        add(unitAt(d.callsign));
        add(d.request.n != null ? view.tracks.find((t) => t.n === d.request.n)?.position : null);
      }
      return pts;
    },
    [view],
  );

  /** The top left of the map holds a palette or a track's card: the Decisions card keeps to the right. */
  const dockBusy = (canEdit && tool != null) || picked != null;
  /**
   * Puts the Decisions card on the side of the map that hides fewer of a decision's points, as the
   * map shows them now, once for each decision that opens [258]. On a tie it goes away from where
   * the points lean, and near the middle it stays, so it does not hop from side to side. Not on a
   * phone, where the card lies across the bottom, nor once the operator has dragged it.
   */
  const placeDeck = useCallback(
    (map: MLMap, pts: LatLon[], id: string): DeckSide => {
      const kept = deckSideRef.current;
      if (deckPin || deckFor.current === id) return kept;
      const box = mapEl.current?.getBoundingClientRect();
      if (!box?.width || !box.height) return kept;
      deckFor.current = id;
      if (phoneLayout()) return kept;
      const width = deckWidth(box.width);
      let side = kept;
      if (dockBusy) side = "right";
      else if (pts.length) {
        const xy = pts.map((p) => map.project([p.lon, p.lat]));
        // The card's box on each side: above the replay bar, as tall as an open decision usually is.
        const bottom = box.height - coveredBelow() - 12;
        const height = Math.min(bottom - 120, 340 * screenScale());
        const hidden = (s: DeckSide) => {
          const x0 = s === "left" ? 12 : box.width - 12 - width;
          return xy.filter((q) => q.x > x0 - 24 && q.x < x0 + width + 24 && q.y > bottom - height - 24 && q.y < bottom + 24).length;
        };
        const left = hidden("left");
        const right = hidden("right");
        const cx = xy.reduce((a, q) => a + q.x, 0) / xy.length;
        if (left !== right) side = left < right ? "left" : "right";
        else if (Math.abs(cx - box.width / 2) > box.width * 0.1) side = cx < box.width / 2 ? "right" : "left";
      }
      deckSideRef.current = side;
      setDeckSide(side);
      return side;
    },
    [deckPin, dockBusy, coveredBelow],
  );

  /**
   * The camera's padding for a decision, clear of the Decisions card [258]: the map frames the
   * points in the room the card leaves. On a phone the card lies across the bottom of the map, so
   * the room is above it; a card the operator dragged keeps the room on its nearer side.
   */
  const clearOfDeck = useCallback(
    (map: MLMap, pts: LatLon[], id: string): Padding => {
      const pad = { ...MAP_PADDING };
      const box = mapEl.current?.getBoundingClientRect();
      if (!box?.width || !box.height) return pad;
      const deck = deckEl.current?.getBoundingClientRect();
      if (deckPin) {
        if (deck?.width) {
          if (deck.width > box.width / 2) {
            if (deck.top - box.top < box.bottom - deck.bottom) pad.top = Math.max(pad.top, deck.bottom - box.top + 16);
            else pad.bottom = Math.max(pad.bottom, box.bottom - deck.top + 16);
          } else if (deck.left - box.left < box.right - deck.right) pad.left = Math.max(pad.left, deck.right - box.left + 16);
          else pad.right = Math.max(pad.right, box.right - deck.left + 16);
        }
      } else {
        if (phoneLayout()) {
          pad.bottom += Math.round(Math.min(box.height * 0.45, Math.max(deck?.height ?? 0, 220)));
        } else {
          const side = placeDeck(map, pts, id);
          // The card, its 12 px from the edge, and room for a label beside it: a label is wider than its marker.
          pad[side] = Math.max(pad[side], Math.round(deckWidth(box.width)) + 12 + 60);
        }
      }
      leaveRoom(pad, "left", "right", box.width, 160);
      leaveRoom(pad, "top", "bottom", box.height, 120);
      return pad;
    },
    [deckPin, placeDeck],
  );

  /** Moves the map to a decision's points, clear of the Decisions card [258]. */
  const moveMapTo = useCallback(
    (d: Decision) => {
      const map = mapRef.current;
      const ml = mlRef.current;
      if (!map || !ml) return;
      const pts = pointsOf(d);
      if (!pts.length) return;
      const padding = clearOfDeck(map, pts, d.id);
      const b = new ml.LngLatBounds();
      pts.forEach((p) => b.extend([p.lon, p.lat]));
      // One point is shown at street level, or closer if the operator was closer already.
      map.fitBounds(b, { padding, maxZoom: pts.length === 1 ? Math.max(map.getZoom(), 16) : 16.5, duration: 600 });
    },
    [pointsOf, clearOfDeck],
  );

  // A decision that opens by itself (the first to arrive, or the one after a decision settled on
  // another screen) moves the card off its points as the map shows them; the map stays put [258].
  useEffect(() => {
    const map = mapRef.current;
    if (focused && map && mapReady) placeDeck(map, pointsOf(focused), focused.id);
  }, [focused, mapReady, placeDeck, pointsOf]);

  /** The operator opens a decision: by a click, the arrow keys, or its line in the feed or the units. */
  const focusOn = useCallback(
    (d: Decision, index: number) => {
      setFocus({ id: d.id, index });
      setSelection(null);
      setFollow(false);
      const a = d.kind === "held" ? d.held.area : d.kind === "request" ? null : d.item.area;
      if (a && a !== area) setManualArea(a);
      moveMapTo(d);
    },
    [area, moveMapTo, setFocus, setSelection],
  );

  /** The operator picks an option in the open decision, by a click, a key or a choice on the map. */
  const pick = useCallback(
    (o: DecisionOption) => {
      if (!focused) return;
      // Pinned, so that settling it opens the one after it, not the first in the list.
      setFocus({ id: focused.id, index: focusedAt });
      setSelection({ id: focused.id, option: o });
      setFollow(false);
      moveMapTo(focused);
    },
    [focused, focusedAt, moveMapTo, setFocus, setSelection],
  );

  // Open questions: each choice numbered on the map, ringed in its unit's colour and named with
  // its call sign, so two units' choices are not told apart by colour alone. The open decision's
  // choices stand out and can be clicked; the others fade [240].
  const pendings = useMemo(() => view.units.filter((u) => u.pending), [view]);
  const focusedQuestion = focused?.kind === "question" ? focused : null;
  const pickedChoice = picking?.kind === "choice" ? picking.choice : null;
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
    const spots = new Map<string, { n: number; name: string; lat: number; lon: number; units: UnitState[]; who: string[]; reports: string[]; ids: string[] }>();
    for (const u of pendings) {
      // "ALPHA 1?" asks where the unit is; "ALPHA 1: T3?" asks where the track it reported is.
      const about = trackQuestions.get(u.pending!.reportId);
      u.pending!.candidates.forEach((c, i) => {
        const k = `${i}|${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
        const spot = spots.get(k) ?? { n: i + 1, name: c.name, lat: c.lat, lon: c.lon, units: [], who: [], reports: [], ids: [] };
        spot.units.push(u);
        spot.reports.push(u.pending!.reportId);
        spot.ids.push(c.id);
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
      const mine = focusedQuestion ? s.reports.indexOf(focusedQuestion.id) : -1;
      if (focusedQuestion && mine < 0) el.dataset.dim = "";
      if (mine >= 0) {
        el.dataset.focus = "";
        if (pickedChoice && s.ids[mine] === pickedChoice) el.dataset.picked = "";
        // A click on the open question's choice picks it, as its key would.
        const option = optionsOf(focusedQuestion!, []).numbered[s.n - 1];
        if (canEdit && option) {
          el.title = `${focusedQuestion!.callsign}, choice ${s.n}: ${s.name}. Click to choose it.`;
          el.addEventListener("click", (ev) => {
            ev.stopPropagation();
            pick(option);
          });
        }
      }
      const marker = new ml.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map);
      // The open question's choices on top of the others.
      if (mine >= 0) marker.getElement().style.zIndex = "2";
      candMarkers.current.push(marker);
    }
  }, [pendings, trackQuestions, mapReady, focusedQuestion, pickedChoice, canEdit, pick]);

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
  const focusedId = focused?.id ?? null;
  const deckPinned = deckPin != null;

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
    } else {
      // While a decision is open, the units and its choices are framed beside the Decisions card [258].
      const padding = focused ? clearOfDeck(map, followPoints, focused.id) : MAP_PADDING;
      const b = new ml.LngLatBounds();
      followPoints.forEach((p) => b.extend([p.lon, p.lat]));
      map.fitBounds(b, { padding, maxZoom: followPoints.length === 1 ? 16 : 16.5, duration });
    }
    // followKey stands for followPoints, so the camera moves only when a point moves; it moves
    // too when a decision opens or the card changes sides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followKey, area, follow, mapReady, mapSize, start, focusedId, deckSide, deckPinned]);

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
      const box = map.getContainer();
      const padLeft = box.clientWidth > 600 ? Math.min(432, box.clientWidth - 120) : 0;
      map.flyTo({ center: [u.position.lon, u.position.lat], zoom: Math.max(map.getZoom(), 16), duration: 700, padding: { left: padLeft, top: 0, right: 0, bottom: 0 } });
    },
    [area],
  );

  const flyToTrack = useCallback(
    (t: TrackState) => {
      setTimelineOpen(false);
      setOpenUnit(null);
      setPicked(t.n);
      const map = mapRef.current;
      if (!map || !t.position || t.gone != null) return;
      setFollow(false);
      if (t.area !== area) setManualArea(t.area);
      // The picked track's panel covers the map's left: frame the track in the rest of it.
      const box = map.getContainer();
      const padLeft = box.clientWidth > 600 ? Math.min(432, box.clientWidth - 120) : 0;
      map.flyTo({ center: [t.position.lon, t.position.lat], zoom: Math.max(map.getZoom(), 16), duration: 700, padding: { left: padLeft, top: 0, right: 0, bottom: 0 } });
    },
    [area, setPicked],
  );

  // ---------- the command post's own changes ----------
  /** In a replay or an ended mission the tools close by themselves. */
  const activeTool = canEdit ? tool : null;
  const pickedTrack = picked != null ? (view.tracks.find((t) => t.n === picked) ?? null) : null;
  const openedUnit = openUnit != null ? (view.units.find((u) => u.callsign === openUnit) ?? null) : null;
  const openedUnitStatus = openedUnit ? unitStatus(openedUnit, isSilent(openedUnit), mode === "live" && ended != null ? fmtAgo(effNow - knownAt(openedUnit)) : null) : null;
  const openedUnitQuestion = openedUnit
    ? decisionAt.get(openedUnit.pending?.reportId ?? openedUnit.prompt?.reportId ?? "")
    : undefined;
  // On a phone, an entity panel or the timeline folds the lists so it has the height; the tabs bar can reopen them [271].
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia("(max-width: 900px)").matches) return;
    const open = !!(pickedTrack || openedUnit || timelineOpen);
    if (open && !autoFoldedLists.current && listsOpen) {
      autoFoldedLists.current = true;
      setListsOpen(false);
    } else if (!open && autoFoldedLists.current) {
      autoFoldedLists.current = false;
      setListsOpen(true);
    }
  }, [pickedTrack, openedUnit, timelineOpen, listsOpen]);
  /** The reports and acts about the picked track: its provenance [271]. */
  const pickedHistory = useMemo(() => (pickedTrack ? view.feed.filter((f) => f.track === pickedTrack.n) : []), [view.feed, pickedTrack]);
  /** The raw log line behind the inspector: the intent, rule and timings the folded feed keeps out. */
  const inspectedEntry = useMemo(
    () => (inspected ? (entries.find((e) => e.id === inspected.id) ?? null) : null),
    [inspected, entries],
  );

  // One dialog at a time takes the keyboard: Tab stays inside it, and closing it gives the focus
  // back to whatever opened it. The map's panels are the same drawer as the timeline [271, 275].
  const anyDialog =
    welcome || inspected != null || helpOpen || findOpen || timelineOpen || pickedTrack != null || openedUnit != null || panelOpen || activeTool != null || auth !== "open";
  const dialogReturn = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!anyDialog) return;
    if (!dialogReturn.current) dialogReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter((d) => d.getClientRects().length > 0);
      const dialog = dialogs[dialogs.length - 1];
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((el) => el.getClientRects().length > 0);
      if (!focusable.length) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onTab);
    return () => window.removeEventListener("keydown", onTab);
  }, [anyDialog]);
  useEffect(() => {
    if (anyDialog || !dialogReturn.current) return;
    const back = dialogReturn.current;
    dialogReturn.current = null;
    back.focus();
  }, [anyDialog]);
  /** The number a new track will most likely get; the coordinator gives the real one. */
  const nextN = full.tracks.reduce((m, t) => Math.max(m, t.n), 0) + 1;
  const tracksUrl = session ? `/api/sessions/${encodeURIComponent(session)}/tracks` : "";
  const unitPositionUrl = session ? `/api/sessions/${encodeURIComponent(session)}/units/position` : "";

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

  /** Places a unit by hand, or moves one the app placed wrongly [243]. The same button again closes the tool. */
  const startUnitMove = useCallback(
    (u: UnitState) => {
      setPicked(null);
      setToolError(null);
      setNote("");
      setFollow(false);
      setTool((t) => (t?.kind === "unit" && t.callsign === u.callsign ? null : { kind: "unit", callsign: u.callsign, radius: PLOT_RADIUS_DEFAULT, at: null }));
    },
    [setPicked],
  );



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

  /**
   * Puts it in the cell of a grid typed into the place search [245]: at the cell's centre, and no
   * surer than the cell. The coordinator names the point; the grid shows beside the name.
   */
  const putGrid = useCallback(
    (g: GridRead) => {
      const cell = PLOT_RADII.find((r) => r >= g.radius_m) ?? PLOT_RADII[PLOT_RADII.length - 1];
      setTool((t) => (t && t.kind !== "edit" ? { ...t, radius: Math.max(t.radius, cell) } : t));
      putDraft(g.pin.lat, g.pin.lon);
      const map = mapRef.current;
      map?.easeTo({ center: [g.pin.lon, g.pin.lat], zoom: Math.max(map.getZoom(), 16), duration: 500 });
    },
    [putDraft],
  );

  // A click on the map: where the track goes while placing or moving; otherwise it picks a track.
  useEffect(() => {
    mapClick.current = (e) => {
      const map = mapRef.current;
      if (!map) return;
      // The ruler has this click [245].
      if (measuring.current) return;
      if (activeTool && activeTool.kind !== "edit") {
        putDraft(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      if (activeTool) return;
      // A unit's marker opens its panel, as its strip does [271, 275]. A track symbol under the
      // pointer keeps its own click.
      const callsign = map.queryRenderedFeatures(e.point, { layers: ["pos"] })[0]?.properties?.callsign;
      if (typeof callsign === "string") {
        const u = view.units.find((x) => x.callsign === callsign);
        setTimelineOpen(false);
        setInspected(null);
        setPicked(null);
        setOpenUnit(callsign);
        if (u?.position) flyToUnit(u);
        return;
      }
      const n = map.queryRenderedFeatures(e.point, { layers: ["track-sym"] })[0]?.properties?.n;
      if (typeof n === "number") setTimelineOpen(false);
      setOpenUnit(null);
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
  /** The unit being placed by hand [243]: its draft is its own dot, in its colour. */
  const movingUnit = activeTool?.kind === "unit" ? (full.units.find((u) => u.callsign === activeTool.callsign) ?? null) : null;
  const draftColour = movingUnit ? movingUnit.colour : draftLooks ? AFFILIATION_COLOUR[draftLooks.affiliation] : "#475569";
  const movingFrom = (movingUnit ?? movingTrack)?.position ?? null;
  /** A unit with a place of its own is moved; one never placed, or still at the start point, is placed. */
  const unitVerb = movingUnit?.position && !movingUnit.atStart ? "Move" : "Place";
  /** Its own open question about where it is closes with the placement; one about a track does not. */
  const unitQuestionCloses = !!movingUnit && [movingUnit.pending?.reportId, movingUnit.prompt?.reportId].some((id) => id != null && full.feed.find((f) => f.id === id)?.track == null);

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

  // The draft's symbol: a marker that can be dragged to where the track is. A unit's is its dot.
  const draftCode = draft && draftLooks ? trackSymbolCode(draftLooks.affiliation, draftLooks.kind) : "";
  const draftDot = draft && movingUnit ? movingUnit.colour : "";
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml || !mapReady || !draft) return;
    const el = document.createElement("div");
    let offset: [number, number] = [0, 0];
    if (draftDot) {
      el.className = `${styles.draftMarker} ${styles.draftUnit}`;
      el.style.background = draftDot;
    } else {
      if (!draftCode || !symbols) return;
      const s = new symbols.Symbol(draftCode, { size: Math.round(TRACK_SYMBOL_SIZE * screenScale()), civilianColor: false, outlineWidth: 3, outlineColor: "#ffffff" });
      el.className = styles.draftMarker;
      el.innerHTML = s.asSVG();
      const { width, height } = s.getSize();
      const a = s.getAnchor();
      offset = [width / 2 - a.x, height / 2 - a.y];
    }
    el.title = "Drag to where it is";
    const m = new ml.Marker({ element: el, draggable: true, offset }).setLngLat([draft.lon, draft.lat]).addTo(map);
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
  }, [draft, draftCode, draftDot, draftRadius, draftColour, symbols, mapReady, putDraft]);

  /** Sends a change to the coordinator. The log is read again at once, so the map shows it. */
  const sendPlot = useCallback(async <T = PlotReply,>(url: string, method: "POST" | "PATCH", body: unknown): Promise<T | null> => {
    setBusy(true);
    setToolError(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
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

  /** Puts a unit back where its own last report had it, when the command post's placement was wrong [243]. */
  const undoUnitPlace = useCallback(
    async (u: UnitState) => {
      const last = u.trail[u.trail.length - 1];
      if (!last) return;
      const r = await sendPlot<FixReply>(unitPositionUrl, "POST", {
        callsign: u.callsign,
        lat: last.lat,
        lon: last.lon,
        radius_m: 30,
        note: "back to the unit's last report",
      });
      if (r) {
        setUndoAt((all) => ({ ...all, [u.callsign]: r.entry.ts }));
        setNotice(`${u.callsign} back where its last report had it: ${r.entry.position.label}`);
      }
    },
    [sendPlot, unitPositionUrl, setNotice, setUndoAt],
  );

  const confirmDraft = useCallback(async () => {
    if (!activeTool || activeTool.kind === "edit" || !activeTool.at || busy) return;
    const at = activeTool.at;
    const where = at.place ? { place: at.place } : { lat: at.lat, lon: at.lon };
    if (activeTool.kind === "unit") {
      // A unit placed by hand [243]: the same point or place as a track, sent with its call sign.
      const r = await sendPlot<FixReply>(unitPositionUrl, "POST", { callsign: activeTool.callsign, ...where, radius_m: activeTool.radius, note: note || null });
      if (r) {
        setNotice(`${activeTool.callsign} placed by hand: ${r.entry.position.label}`);
        setNote("");
        setTool(null);
      }
      return;
    }
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
  }, [activeTool, busy, note, sendPlot, tracksUrl, unitPositionUrl, setPicked, setNotice]);

  const saveEdit = useCallback(async () => {
    if (activeTool?.kind !== "edit" || busy) return;
    const w = activeTool.what;
    const r = await sendPlot(`${tracksUrl}/${activeTool.n}`, "PATCH", { action: "edit", affiliation: w.affiliation, kind: w.kind, count: w.count > 1 ? w.count : null, note: note || null });
    if (r) {
      setNotice(`Track ${activeTool.n} is now: ${describeWhat(w)}`);
      setNote("");
      setTool(null);
    }
  }, [activeTool, busy, note, sendPlot, tracksUrl, setNotice]);

  const markGone = useCallback(
    async (n: number, gone: boolean) => {
      const r = await sendPlot(`${tracksUrl}/${n}`, "PATCH", { action: gone ? "gone" : "restore" });
      if (r) setNotice(gone ? `Track ${n} marked gone` : `Track ${n} back on the map`);
    },
    [sendPlot, tracksUrl, setNotice],
  );

  /**
   * The command post answers a unit's question, as when the unit has only a radio [178], or closes
   * one with no choices (`choice` null) [242]. True once it is saved.
   */
  const sendAnswer = useCallback(
    async (reportId: string, choice: string | null, callsign: string, done: string): Promise<boolean> => {
      if (!session) return false;
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch("/api/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session, report: reportId, choice, by: COMMAND_POST }) });
        const data = (await res.json().catch(() => ({}))) as { error?: string; by?: string | null };
        if (!res.ok) throw new Error(data.error ?? `The coordinator answered ${res.status}.`);
        setNotice(data.by !== COMMAND_POST ? `${callsign} had answered already` : done);
        pollNow.current();
        return true;
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Saving the answer failed.");
        pollNow.current();
        return false;
      } finally {
        setBusy(false);
        setSelection(null);
      }
    },
    [session, setNotice],
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
    [session, setNotice],
  );

  /** The operator says what a unit is, so a drone team on the net can be sent to look [235]. */
  const sendUnitKind = useCallback(
    async (callsign: string, kind: TrackKind | null) => {
      if (!session) return;
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(session)}/units`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callsign, kind }) });
        const data = (await res.json().catch(() => ({}))) as Partial<UnitReply> & { error?: string };
        if (!res.ok) throw new Error(data.error ?? `The coordinator answered ${res.status}.`);
        if (data.entry) setNotice(kind ? `${callsign} is a ${TRACK_KIND_NAME[kind].toLowerCase()}` : `${callsign}: what it is, cleared`);
        pollNow.current();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Saving that failed.");
      } finally {
        setBusy(false);
      }
    },
    [session, setNotice],
  );

  /** The operator gives a held radio report to a unit, adds its call sign, or dismisses it [203]. True once it is saved. */
  const sendHeld = useCallback(
    async (st: { held: string; action: "assign" | "add" | "dismiss"; callsign: string | null }): Promise<boolean> => {
      if (!session) return false;
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
        pollNow.current();
        return true;
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Settling the report failed.");
        pollNow.current();
        return false;
      } finally {
        setBusy(false);
        setSelection(null);
      }
    },
    [session, setNotice],
  );

  /** The operator confirms the option picked in the open decision; the next one opens by itself [240]. */
  const confirmPick = useCallback(async () => {
    if (!focused || !picking || busy || !canEdit) return;
    const d = focused;
    const o = picking;
    setFocus({ id: d.id, index: focusedAt });
    setFollow(false);
    let ok = false;
    if (o.kind === "choice" && d.kind === "question") ok = await sendAnswer(d.id, o.choice, d.callsign, o.choice ? `Chose ${o.name} for ${d.callsign}` : `None of the choices, for ${d.callsign}`);
    else if (o.kind === "close" && d.kind === "prompt") ok = await sendAnswer(d.id, null, d.callsign, `Closed ${d.callsign}’s question`);
    else if (o.kind === "held" && d.kind === "held") ok = await sendHeld({ held: d.id, action: o.action, callsign: o.callsign });
    if (ok) frameNext.current = true;
  }, [focused, picking, busy, canEdit, focusedAt, sendAnswer, sendHeld]);

  // Once a decision is settled the one that takes its place opens, and the map moves to it.
  useEffect(() => {
    if (!focused) {
      frameNext.current = false;
      return;
    }
    if (!frameNext.current || focused.id === focus?.id) return;
    frameNext.current = false;
    moveMapTo(focused);
  }, [focused, focus, moveMapTo]);

  // How many decisions wait, in the tab's title, so it shows from another window [240].
  const waitingCount = mode === "live" && ended == null ? decisions.length : 0;
  useEffect(() => {
    document.title = waitingCount ? `(${waitingCount}) Command post · Voice-to-Map` : "Command post · Voice-to-Map";
  }, [waitingCount]);

  // Keys, while no field has the cursor: P to place, H S U C F and 1 to 9 in the palette, Esc to step back.
  // With no tool open: ↑ ↓ (or J K) move through the Decisions list, 1 to 9 pick, N none, Enter confirms [240].
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) {
        if (e.key === "Escape") el.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (e.key === "Escape") {
        if (welcome) closeWelcome();
        else if (inspected) setInspected(null);
        else if (helpOpen) {
          setHelpOpen(false);
        } else if (timelineOpen) {
          setTimelineOpen(false);
        } else if (findOpen) setFindOpen(false);
        else if (moreOpen) setMoreOpen(false);
        else if (picking) unpick();
        else if (activeTool && activeTool.kind !== "edit" && activeTool.at) setTool({ ...activeTool, at: null });
        else if (activeTool) setTool(null);
        else setPicked(null);
        return;
      }
      // Moving through the Decisions list works in a replay too; not while the map has the keys.
      const onMap = !!el && !!mapEl.current?.contains(el);
      const step = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
      if (step && !activeTool && !onMap && decisions.length) {
        e.preventDefault();
        const i = Math.max(0, Math.min(decisions.length - 1, focusedAt + step));
        focusOn(decisions[i], i);
        return;
      }
      if (!canEdit) return;
      if (!activeTool && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        startPlace();
        return;
      }
      if (!activeTool && focused) {
        const { numbered, drop } = optionsOf(focused, view.roster);
        const o = /^[1-9]$/.test(e.key) ? numbered[Number(e.key) - 1] : e.key === "n" || e.key === "N" ? drop : undefined;
        if (o) {
          e.preventDefault();
          pick(o);
          return;
        }
        // Enter on a button is that button's own click (the confirm takes the cursor when it shows).
        if (e.key === "Enter" && picking && el?.tagName !== "BUTTON") {
          e.preventDefault();
          void confirmPick();
          return;
        }
      }
      if (!activeTool || activeTool.kind === "move" || activeTool.kind === "unit") return;
      const aff = AFFILIATIONS.find((a) => AFFILIATION_KEY[a] === e.key.toUpperCase());
      const kind = /^[1-9]$/.test(e.key) ? TRACK_KINDS[Number(e.key) - 1] : undefined;
      if (aff) setTool({ ...activeTool, what: { ...activeTool.what, affiliation: aff } });
      else if (kind) setTool({ ...activeTool, what: { ...activeTool.what, kind } });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTool, picking, unpick, canEdit, startPlace, decisions, focusedAt, focused, focusOn, pick, confirmPick, view.roster, timelineOpen, findOpen, helpOpen, moreOpen, welcome, closeWelcome, inspected]);

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
  const barLo = barZoom && shownStretch ? shownStretch.start : rangeStart;
  const barHi = barZoom && shownStretch ? shownStretch.end : rangeEnd;
  const barStretches = barZoom && shownStretch ? [shownStretch] : stretches;
  const sliderValue = mode === "live" ? (shownStretch?.end ?? rangeEnd) : Math.min(Math.max(replayT, barLo), barHi);
  const barSpan = barHi - barLo;
  /** Where a time sits along the bar, in per cent. */
  const barPct = (t: number) => (barSpan > 0 ? ((t - barLo) / barSpan) * 100 : 0);
  const sliderMission = stretchAt(stretches, sliderValue, session);

  // Where a dragged Decisions card sits, in its own pixels: it is drawn larger on a big screen [258].
  // Where it was dropped, or as far across a map that has changed size since.
  const deckAt = (() => {
    if (!deckPin) return null;
    const [w, h] = mapSize ? mapSize.split("x").map(Number) : [deckPin.w, deckPin.h];
    const z = screenScale();
    const left = (deckPin.x / deckPin.w) * w;
    const top = (deckPin.y / deckPin.h) * h;
    return { "--deck-x": `${left / z}px`, "--deck-y": `${top / z}px`, "--deck-h": `calc(100% - ${(top + 12) / z}px)` } as CSSProperties;
  })();

  /** The operator drags the Decisions card by its heading; it stays where it is put until Unpin [258]. */
  const dragDeck = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (e.button !== 0 || !target?.closest("h2") || target.closest("button, a, select, input")) return;
    const deck = deckEl.current;
    const box = mapEl.current?.getBoundingClientRect();
    if (!deck || !box) return;
    const r = deck.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    e.preventDefault();
    deck.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const x = Math.min(Math.max(ev.clientX - dx - box.left, 0), Math.max(0, box.width - r.width));
      const y = Math.min(Math.max(ev.clientY - dy - box.top, 0), Math.max(0, box.height - 60));
      setDeckPin({ x, y, w: box.width, h: box.height });
    };
    const up = () => {
      deck.removeEventListener("pointermove", move);
      deck.removeEventListener("pointerup", up);
      deck.removeEventListener("pointercancel", up);
    };
    deck.addEventListener("pointermove", move);
    deck.addEventListener("pointerup", up);
    deck.addEventListener("pointercancel", up);
  };

  const findResults = useMemo(() => {
    const q = find.trim().toLowerCase();
    if (!q) return [] as { key: string; label: string; detail: string; unit: UnitState | null; track: TrackState | null; place: StartPoint | null }[];
    const units = view.units
      .filter((u) => u.callsign.toLowerCase().includes(q))
      .slice(0, 5)
      .map((u) => ({ key: `u:${u.callsign}`, label: u.callsign, detail: u.position ? `${u.position.label} · ±${u.position.radius_m} m` : "not placed", unit: u, track: null, place: null }));
    const tracks = view.tracks
      .filter((t) => `t${t.n} track ${t.n} ${describeTrack(t)}`.toLowerCase().includes(q))
      .slice(0, 5)
      .map((t) => ({ key: `t:${t.n}`, label: `Track ${t.n}`, detail: describeTrack(t), unit: null, track: t, place: null }));
    const places = placeResults
      .slice(0, 5)
      .map((p) => ({ key: `p:${p.id}`, label: p.name, detail: p.category.replace("_", " "), unit: null, track: null, place: p }));
    return [...units, ...tracks, ...places].slice(0, 8);
  }, [find, view, placeResults]);
  const pickFind = (r: (typeof findResults)[number]) => {
    setFindOpen(false);
    setFind("");
    setFindAt(0);
    if (r.track) {
      flyToTrack(r.track);
      return;
    }
    setPicked(null);
    setTimelineOpen(false);
    if (r.unit) {
      setOpenUnit(r.unit.callsign);
      if (r.unit.position) flyToUnit(r.unit);
      return;
    }
    setOpenUnit(null);
    const p = r.place;
    const map = mapRef.current;
    if (!p || !map) return;
    setFollow(false);
    map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 15) });
  };
  /** Shows the mission as it was just after an event, and closes the drawers [271]. */
  const jumpTo = (ts: number, track?: number | null) => {
    setTimelineOpen(false);
    setOpenUnit(null);
    setBarCompact(false);
    setFollow(false);
    setPlaying(false);
    setReplayOpen(true);
    scrub(Math.min(rangeEnd, Math.max(rangeStart, ts + 1)));
    if (track != null) setPicked(track);
  };
  /** A timeline event: show the mission as it was just after it [271]. */
  const jumpTimeline = (f: FeedItem) => jumpTo(f.ts, f.track);
  /** The small tag at the end of a timeline row: a track, an open question, or what the command post did. */
  const timelineTag = (f: FeedItem): string => {
    if (f.track != null) return `T${f.track}`;
    if (f.question && !f.expired && !f.answer) return "Question";
    if (f.kind === "report") return "";
    return f.kind[0].toUpperCase() + f.kind.slice(1);
  };
  /** The events the timeline shows, after its filter and search [271]. */
  const timelineEvents = useMemo(() => {
    const q = timelineQuery.trim().toLowerCase();
    const cutoff = timelineWindow > 0 ? (mode === "replay" ? replayT : effNow) - timelineWindow * 60_000 : null;
    return [...view.feed]
      .sort((a, b) => b.ts - a.ts)
      .filter((f) => {
        if (cutoff != null && f.ts < cutoff) return false;
        if (timelineFilter === "reports" && f.kind !== "report") return false;
        if (timelineFilter === "tracks" && f.track == null) return false;
        if (timelineFilter === "units" && f.kind !== "join" && !(f.kind === "report" && f.track == null)) return false;
        if (timelineFilter === "tasks" && f.kind !== "task" && f.kind !== "request" && f.kind !== "reply") return false;
        if (!q) return true;
        return `${f.callsign} ${f.transcript ?? ""} ${f.outcome} ${f.track != null ? `T${f.track}` : ""}`.toLowerCase().includes(q);
      });
  }, [view.feed, timelineFilter, timelineQuery, timelineWindow, mode, replayT, effNow]);
  const newSince = seenBefore != null && view.feed.some((f) => f.ts > seenBefore) ? seenBefore : null;
  const newCount = newSince != null ? timelineEvents.filter((f) => f.ts > newSince).length : 0;

  return (
    <div
      className={styles.root}
      data-tab={tab}
      data-lists={listsOpen ? undefined : "closed"}
      data-bar={barShut ? "compact" : undefined}
      style={listsHeight != null ? ({ "--lists-h": `${listsHeight}px` } as CSSProperties) : undefined}
    >
      <header className={styles.header}>
        <h1 className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true" />
          Voice-to-Map <span className={styles.brandSub}>Command post</span>
        </h1>
        {mission ? (
          <div className={styles.missionHead}>
            <span className={styles.missionTitle} title={`${mission.name} · code ${session}`}>
              {mission.name}
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
                <span className={styles.stateDot} data-state={connected ? "on" : "wait"} aria-hidden="true" />
                Live
              </span>
            )}
            {stored === false ? (
              <span className={styles.chip} data-state="warn" title="This coordinator keeps no record: missions and reports vanish on reload">
                No record
              </span>
            ) : null}
            {demo ? (
              <span className={styles.chip} data-state="demo" title="A recorded mission, read only. Open your own mission to answer questions and place units.">
                Demo · read-only
              </span>
            ) : null}
          </div>
        ) : session ? (
          <div className={styles.chip} title="A session from before missions">
            Session <strong>{session}</strong>
          </div>
        ) : (
          <div className={styles.chip}>No mission</div>
        )}
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
        {/* The connection, the drawers and the missions menu wrap together, not one by one [271]. */}
        <div className={styles.headActions}>
          {!mission || ended != null ? <button type="button" className={styles.ghostBtn} onClick={() => setPanelOpen(true)}>Start mission</button> : null}
          {!mission && session !== DEMO_SESSION ? (
            <button type="button" className={styles.ghostBtn} onClick={() => pickSession(DEMO_SESSION)} title="Open the recorded mission: four units, three tracks and a question asked back">
              Demo
            </button>
          ) : null}
          <button type="button" className={styles.ghostBtn} onClick={() => {
            setPicked(null);
            setOpenUnit(null);
            setTimelineOpen(true);
          }} title="The mission's events, newest first; choose one to replay it">
            Timeline
          </button>
          <button type="button" className={styles.ghostBtn} onClick={() => setFindOpen(true)} title="Find a call sign, a track or a place (Ctrl+K)">
            Find
          </button>
          <button type="button" className={styles.menuBtn} aria-expanded={panelOpen} aria-haspopup="dialog" onClick={() => setPanelOpen((o) => !o)}>
            Missions ▾
          </button>
          <div className={styles.headerMore} ref={moreRef}>
            <button
              type="button"
              className={styles.ghostBtn}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-label="More actions"
              title="Brief, help and stop"
              onClick={() => setMoreOpen((o) => !o)}
            >
              <span aria-hidden="true">…</span>
            </button>
            {moreOpen ? (
              <div className={styles.headerMorePanel} role="menu" aria-label="More actions">
                <button
                  type="button"
                  role="menuitem"
                  className={styles.headerMoreItem}
                  onClick={() => {
                    setMoreOpen(false);
                    void copySituation();
                  }}
                >
                  Copy situation
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.headerMoreItem}
                  onClick={() => {
                    setMoreOpen(false);
                    setHelpOpen(true);
                  }}
                >
                  Keys and clicks
                </button>
                {mission && ended == null && !demo ? (
                  confirmEnd ? (
                    <div className={styles.headerMoreConfirm}>
                      <span>Stop this mission? Reports stop. It stays here for replay.</span>
                      <div className={styles.headerMoreButtons}>
                        <button
                          type="button"
                          className={styles.dangerBtn}
                          onClick={() => {
                            setMoreOpen(false);
                            void endMission();
                          }}
                        >
                          Stop mission
                        </button>
                        <button
                          type="button"
                          className={styles.linkBtn}
                          onClick={() => {
                            setConfirmEnd(false);
                            setMoreOpen(false);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      className={`${styles.headerMoreItem} ${styles.headerMoreDanger}`}
                      onClick={() => setConfirmEnd(true)}
                    >
                      Stop mission
                    </button>
                  )
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        {panelOpen ? <MissionPanel current={session} defaultArea={mission?.area ?? area} onPick={pickSession} onClose={closePanel} /> : null}
      </header>

      <main className={styles.mapCol} data-drawer={timelineOpen ? "" : undefined} data-panel={(pickedTrack || openedUnit) && !activeTool ? "" : undefined}>
        <div ref={mapEl} className={styles.map} aria-label="Map of all units and tracks" />
        {/* The grid's lines, a ruler and "go to grid", behind one button, and the grid under the
            pointer at the map's edge [232, 245]. A click here already places or picks, so it copies
            nothing; while the ruler is on, a click only measures. Going to a grid stops following. */}
        <MapTools
          mapRef={mapRef}
          ready={mapReady}
          centre={AREAS[area].centre}
          below="start-fill"
          top="calc(90px / var(--z))"
          right="calc(60px / var(--z))"
          covered={coveredBelow}
          onMeasuring={setMeasuring}
          scale={mapSize ? screenScale() : 1}
          folded
          onGo={stopFollowing}
        />
        {/* Top left of the map: Satellite and "Follow units" in one row, then the palette or the
            picked track's card, so the map keeps its height. */}
        <div className={styles.dock}>
          <div className={styles.dockActions}>
            <button
              type="button"
              className={`${styles.followBtn} ${satellite ? styles.toggleOn : ""}`}
              aria-pressed={satellite}
              title={satellite ? "Back to the drawn map" : "Photograph view, needs internet"}
              onClick={() => setSatellite((on) => !on)}
            >
              {satellite ? "Map" : "Satellite"}
            </button>
            {!follow ? (
              <button type="button" className={styles.followBtn} onClick={() => setFollow(true)}>
                Follow units
              </button>
            ) : null}
          </div>
          {activeTool?.kind === "place" ? (
            <TrackPalette
              title={`Place Track ${nextN}`}
              what={activeTool.what}
              onWhat={(what) => setTool({ ...activeTool, what })}
              radius={activeTool.radius}
              onRadius={(radius) => setTool({ ...activeTool, radius })}
              area={area}
              onPlace={putPlace}
              onGrid={putGrid}
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
                    grid={shortGrid(activeTool.at)}
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
              onGrid={putGrid}
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
                    grid={shortGrid(activeTool.at)}
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
          ) : activeTool?.kind === "unit" && movingUnit ? (
            // A unit placed by hand [243]: the same circle, place search and confirm as a track moved by hand.
            <TrackPalette
              title={`${unitVerb} ${activeTool.callsign} by hand`}
              what={DEFAULT_WHAT}
              onWhat={() => {}}
              showWhat={false}
              radius={activeTool.radius}
              onRadius={(radius) => setTool({ ...activeTool, radius })}
              area={area}
              onPlace={putPlace}
              onGrid={putGrid}
              symbols={symbols}
              onClose={() => setTool(null)}
              hint={activeTool.at ? null : `Click the map where ${activeTool.callsign} is, or find a place. Esc to stop.`}
              footer={
                activeTool.at ? (
                  <DraftCard
                    symbols={symbols}
                    dot={movingUnit.colour}
                    title={`${unitVerb} ${activeTool.callsign}`}
                    detail={`${unitVerb === "Move" ? "to " : ""}${activeTool.at.label ?? "naming the point…"} · ±${activeTool.radius} m${activeTool.at.place ? " or the place's size" : ""} · placed by ${COMMAND_POST}${unitQuestionCloses ? " · its open question closes" : ""}`}
                    grid={shortGrid(activeTool.at)}
                    note={note}
                    onNote={setNote}
                    notePlaceholder="Source, if any: heard on the net, by phone"
                    confirmLabel={unitVerb}
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
              {mapSlow ? "The map has not loaded yet. Units and reports still show in the lists." : "Loading the map…"}
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

        <div ref={replayEl} className={styles.replayBar} data-compact={barShut ? "" : undefined}>
          {barShut ? (
            <button type="button" className={styles.liveBtn} disabled={mapShort} onClick={() => {
              setBarCompact(false);
              if (entries.length) setReplayOpen(true);
            }} title={mapShort ? "Enlarge the map to show the replay bar" : entries.length ? "Open the replay" : "Nothing to replay yet"} aria-label="Show the replay bar">
              Replay <span aria-hidden="true">▴</span>
            </button>
          ) : (
            <>
          <button type="button" className={styles.barToggle} onClick={() => setBarCompact(true)} title="Hide the replay bar, to see the map" aria-label="Hide the replay bar">
            <span aria-hidden="true">▾</span>
          </button>
          <button type="button" className={`${styles.liveBtn} ${styles.replayClose}`} aria-expanded={replayOpen} disabled={!entries.length} title={!entries.length ? "Nothing to replay yet: no report, track or unit placed in this mission" : replayOpen ? "Back to the live view and close the replay" : "Read this mission from its log, from a moment you choose"} onClick={() => {
            if (replayOpen) {
              goLive();
              setBarCompact(true);
            }
            setReplayOpen(!replayOpen);
          }}>{replayOpen ? "Close replay" : "Replay"}</button>
          {replayOpen ? <>
          <button
            type="button"
            className={`${styles.liveBtn} ${styles.replayLive}`}
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
              {barStretches.map((s) => (
                <span
                  key={s.code}
                  className={styles.stretch}
                  data-shown={s.code === session ? "" : undefined}
                  style={{ left: `${barPct(s.start)}%`, width: `${barPct(s.end) - barPct(s.start)}%` }}
                />
              ))}
              {detents(barStretches).map((d) => (
                <span key={d} className={styles.detent} style={{ left: `${barPct(d)}%` }} />
              ))}
            </div>
            <input
              className={styles.slider}
              type="range"
              min={barLo}
              max={barHi}
              step="any"
              value={sliderValue}
              disabled={!stretches.length}
              onChange={(e) => {
                setPlaying(false);
                // A start or end within a few pixels pulls the replay onto it.
                const width = e.currentTarget.getBoundingClientRect().width - THUMB_PX;
                const pull = width > 0 ? (barSpan * DETENT_PX) / width : 0;
                scrub(Math.round(settle(barStretches, Number(e.currentTarget.value), pull)));
              }}
              onKeyDown={(e) => {
                const to = keyTarget(barStretches, sliderValue, e.key);
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
          <div className={styles.replayExtra}>
            {shownStretch ? (
              <button
                type="button"
                className={styles.liveBtn}
                aria-pressed={barZoom}
                onClick={() => setBarZoom((z) => !z)}
                title={barZoom ? "Show the whole day again" : "Zoom the bar onto this mission"}
              >
                {barZoom ? "Day" : "Mission"}
              </button>
            ) : null}
            {mode === "replay" ? (
              <button type="button" className={styles.liveBtn} onClick={() => void copyMoment()} title="Copy a link to this moment">
                Link
              </button>
            ) : null}
            <div className={styles.segmentedSmall} role="group" aria-label="Replay speed" title="Replay speed">
              {SPEEDS.map((s) => (
                <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                  {s}×
                </button>
              ))}
            </div>
          </div>
          <details className={styles.replayMore}>
            <summary aria-label="More replay controls" title="Mission zoom, link and speed">
              …
            </summary>
            <div className={styles.replayMorePanel}>
              {shownStretch ? (
                <button
                  type="button"
                  className={styles.liveBtn}
                  aria-pressed={barZoom}
                  onClick={() => setBarZoom((z) => !z)}
                  title={barZoom ? "Show the whole day again" : "Zoom the bar onto this mission"}
                >
                  {barZoom ? "Day" : "Mission"}
                </button>
              ) : null}
              {mode === "replay" ? (
                <button type="button" className={styles.liveBtn} onClick={() => void copyMoment()} title="Copy a link to this moment">
                  Link
                </button>
              ) : null}
              <div className={styles.segmentedSmall} role="group" aria-label="Replay speed" title="Replay speed">
                {SPEEDS.map((s) => (
                  <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                    {s}×
                  </button>
                ))}
              </div>
            </div>
          </details>
          </> : <div className={styles.time}>{lost ? "No contact" : ended != null ? "Mission ended" : "Live"}</div>}
            </>
          )}
        </div>

        {/* Everything that waits on the operator, oldest first, one open at a time [240], on a card over
            the map: on the side away from the open decision's points, or where the operator dragged it [258]. */}
        {/* An idle deck says nothing a tool open on the map does not; with no decisions, no card [271]. */}
        {session && decisions.length > 0 ? (
          <div
            ref={deckEl}
            className={styles.deck}
            data-side={deckPin ? undefined : deckSide}
            data-pinned={deckPin ? "" : undefined}
            data-idle={decisions.length ? undefined : ""}
            data-collapsed={cardShut ? "" : undefined}
            style={deckAt ?? undefined}
            onPointerDown={dragDeck}
          >
          <DecisionQueue
            head={
              <>
                {decisions.length ? (
                  <button
                    type="button"
                    className={styles.unpinBtn}
                    onClick={() => setDeckCollapsed((collapsed) => !collapsed)}
                    disabled={mapShort}
                    title={mapShort ? "Enlarge the map to show the decisions" : cardShut ? "Show the decisions, over the map" : "Hide the decisions, to see the map"}
                  >
                    {cardShut ? "Show" : "Hide"}
                  </button>
                ) : null}
                {deckPin ? (
                  <button
                    type="button"
                    className={styles.unpinBtn}
                    onClick={() => {
                      setDeckPin(null);
                      deckFor.current = null;
                    }}
                    title="Let the card move off each decision again"
                  >
                    Unpin
                  </button>
                ) : null}
              </>
            }
            decisions={decisions}
            focused={focused}
            selection={canEdit ? picking : null}
            heardPick={canEdit && !ownPick && picking != null}
            roster={view.roster}
            tracks={view.tracks}
            units={view.units}
            session={session}
            canEdit={canEdit}
            busy={busy}
            now={effNow}
            fmtTime={fmtTime}
            onFocus={(d) => focusOn(d, decisions.indexOf(d))}
            onSelect={(o) => (o ? pick(o) : unpick())}
            onConfirm={() => void confirmPick()}
            onTask={sendTask}
            onTrack={(n) => {
              const t = view.tracks.find((x) => x.n === n);
              if (t) flyToTrack(t);
            }}
          />
          </div>
        ) : null}

        {pickedTrack && !activeTool ? (
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
            history={pickedHistory}
            format={fmtTime}
            onJump={(ts) => {
              jumpTo(ts);
              setPicked(null);
            }}
          >
            <TrackRecon track={pickedTrack} tracks={view.tracks} units={view.units} requests={view.requests} canEdit={canEdit} busy={busy} fmt={fmtTime} onTask={sendTask} />
          </TrackCard>
        ) : null}

        {openedUnit && openedUnitStatus && !activeTool ? (
          <UnitPanel
            unit={openedUnit}
            status={openedUnitStatus}
            history={view.feed.filter((f) => f.callsign === openedUnit.callsign)}
            format={fmtTime}
            canEdit={canEdit}
            busy={busy}
            onClose={() => setOpenUnit(null)}
            onPlace={() => startUnitMove(openedUnit)}
            onUndo={openedUnit.placedBy && openedUnit.trail.length && openedUnit.positionTs !== undoAt[openedUnit.callsign] ? () => void undoUnitPlace(openedUnit) : undefined}
            onKind={sendUnitKind}
            onTask={sendTask}
            onQuestion={
              openedUnitQuestion != null
                ? () => {
                    setOpenUnit(null);
                    focusOn(decisions[openedUnitQuestion], openedUnitQuestion);
                  }
                : undefined
            }
          />
        ) : null}

        {timelineOpen ? (
          <div className={styles.timelinePanel} role="dialog" aria-label="Timeline">
            <div className={styles.timelinePanelHead}>
              <h2>Timeline</h2>
              <button autoFocus type="button" className={`${styles.linkBtn} ${styles.drawerClose}`} onClick={() => setTimelineOpen(false)}>
                Close
              </button>
            </div>
            <p className={styles.timelinePanelHint}>
              {timelineEvents.length === view.feed.length
                ? `${view.feed.length} event${view.feed.length === 1 ? "" : "s"}`
                : `${timelineEvents.length} of ${view.feed.length} events`}{" "}
              · newest first{newCount > 0 ? ` · ${newCount} new` : ""}. Choose one to replay the mission just after it.
            </p>
            <div className={styles.timelineFilters} role="group" aria-label="Filter the timeline">
              {TIMELINE_FILTERS.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={timelineFilter === id} onClick={() => setTimelineFilter(id)}>
                  {label}
                </button>
              ))}
              {timelineFilter !== "all" || timelineQuery || timelineWindow > 0 ? (
                <button
                  type="button"
                  className={styles.timelineClear}
                  onClick={() => {
                    setTimelineFilter("all");
                    setTimelineQuery("");
                    setTimelineWindow(0);
                  }}
                >
                  Clear
                </button>
              ) : null}
              <select
                className={styles.timelineWindow}
                value={timelineWindow}
                onChange={(e) => setTimelineWindow(Number(e.target.value) as 0 | 5 | 15 | 60)}
                aria-label="Show events from"
                title="Show the last minutes, or the whole mission"
              >
                <option value={0}>All time</option>
                <option value={5}>Last 5 min</option>
                <option value={15}>Last 15 min</option>
                <option value={60}>Last 60 min</option>
              </select>
            </div>
            <input
              className={styles.timelineSearch}
              value={timelineQuery}
              onChange={(e) => setTimelineQuery(e.target.value)}
              placeholder="Callsign, words, track…"
              aria-label="Search the timeline"
            />
            <ol className={styles.timelinePanelList}>
              {timelineEvents.map((f, i) => {
                const tag = timelineTag(f);
                const firstOld =
                  newSince != null && f.ts <= newSince && (i === 0 || timelineEvents[i - 1].ts > newSince);
                const hour = new Date(f.ts).getHours();
                const hourChanged = i === 0 || new Date(timelineEvents[i - 1].ts).getHours() !== hour;
                return (
                  <Fragment key={f.id}>
                    {hourChanged ? (
                      <li className={styles.timelineHour} aria-hidden="true">
                        {String(hour).padStart(2, "0")}:00
                      </li>
                    ) : null}
                    {firstOld ? (
                      <li className={styles.timelineNewDivider}>New since {fmtTime(newSince)}</li>
                    ) : null}
                    <li className={styles.timelineRow}>
                      <button
                        type="button"
                        onClick={() => jumpTimeline(f)}
                        onMouseEnter={() => setHoverEvent(f)}
                        onMouseLeave={() => setHoverEvent(null)}
                        onFocus={() => setHoverEvent(f)}
                        onBlur={() => setHoverEvent(null)}
                        title={`${fmtTime(f.ts)} · ${f.callsign}`}
                      >
                        <span className={styles.timelinePanelDot} style={{ background: f.colour }} aria-hidden="true" />
                        <span className={styles.timelinePanelTime}>{fmtTime(f.ts)}</span>
                        <span className={styles.timelinePanelWho}>{f.callsign}</span>
                        <span className={styles.timelinePanelText}>{f.transcript || f.outcome}</span>
                        {tag ? <span className={styles.timelinePanelTag}>{tag}</span> : null}
                      </button>
                      <button
                        type="button"
                        className={styles.timelineInspect}
                        onClick={() => setInspected(f)}
                        aria-label={`Inspect the event at ${fmtTime(f.ts)} from ${f.callsign}`}
                        title="What the app heard, and how it placed it"
                      >
                        i
                      </button>
                    </li>
                  </Fragment>
                );
              })}
              {view.feed.length === 0 ? (
                <li className={styles.timelinePanelEmpty}>No events yet.</li>
              ) : timelineEvents.length === 0 ? (
                <li className={styles.timelinePanelEmpty}>No event matches.</li>
              ) : null}
            </ol>
          </div>
        ) : null}
      </main>

      {/* On a phone the lists take turns under the map [258]. The box's top edge drags the whole box
          taller or shorter with a mouse or a finger, and the chevron shuts it entirely [262, 263]. */}
      <div className={styles.tabsBar}>
        <div
          className={styles.listsGrip}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the lists"
          title="Drag the top edge to resize the lists, or use the arrow keys"
          tabIndex={0}
          onPointerDown={startListsDrag}
          onPointerMove={moveListsDrag}
          onPointerUp={endListsDrag}
          onPointerCancel={endListsDrag}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              nudgeLists(24);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              nudgeLists(-24);
            }
          }}
        />
        <div className={styles.tabs} role="tablist" aria-label="Lists">
          {(
            [
              ["units", "Units", view.units.length],
              ["tracks", "Tracks", view.tracks.length],
              ["reports", "Reports", view.feed.filter((f) => f.kind === "report").length],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => {
                setTab(id);
                setListsOpen(true);
                if (listsHeight != null && listsHeight < 80) setListsHeight(null);
                if (id === "reports") setReportsOpen(true);
              }}
            >
              {label} <span className={styles.count}>{n}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.tabsToggle}
          aria-expanded={listsOpen}
          title={listsOpen ? "Hide the lists and give the map the height" : "Show the units, tracks and reports"}
          aria-label={listsOpen ? "Hide the lists" : "Show the lists"}
          onClick={() => {
            if (listsOpen) setListsOpen(false);
            else {
              setListsOpen(true);
              if (listsHeight == null || listsHeight < 80) setListsHeight(null);
            }
          }}
        >
          <span aria-hidden="true">{listsOpen ? "▾" : "▴"}</span>
        </button>
      </div>

      {/* Units on the left, one strip each [258]. */}
      <aside className={`${styles.side} ${styles.unitsCol}`} data-tab={tab === "units" || undefined} aria-label="Units">
        <section className={`${styles.section} ${styles.unitsSection}`} aria-labelledby="units-h">
          <h2 id="units-h" className={styles.h2}>
            Units <span className={styles.count}>{view.units.length}</span>
            {orders.units.length ? (
              <button type="button" className={`${styles.unpinBtn} ${styles.resetBtn}`} onClick={() => saveOrders({ ...orders, units: [] })} title="Put the units back in the order they joined" aria-label="Reset the units' order">
                Reset
              </button>
            ) : null}
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
            <ul className={styles.units} onClickCapture={swallowDragClick}>
              {asDrawn("units", unitKeys).map((callsign) => {
                const u = view.units.find((x) => x.callsign === callsign);
                if (!u) return null;
                const silent = isSilent(u);
                const st = unitStatus(u, silent, atEnd ? fmtAgo(effNow - knownAt(u)) : null);
                // A unit whose question waits: its strip opens the question [240].
                const asks = decisionAt.get(u.pending?.reportId ?? u.prompt?.reportId ?? "");
                const moving = activeTool?.kind === "unit" && activeTool.callsign === u.callsign;
                // A strip opens to its whole line and what can be done to the unit [258].
                const open = openUnit === u.callsign || moving;
                return (
                  <li key={u.callsign} data-lane-key={`units:${u.callsign}`} data-dragging={(drag?.lane === "units" && drag.key === u.callsign) || undefined}>
                    <button
                      type="button"
                      className={styles.unit}
                      data-tone={st.tone}
                      data-open={open || undefined}
                      aria-expanded={asks != null ? undefined : open}
                      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                      onPointerDown={(e) => pressStrip(e, "units", u.callsign, "units")}
                      onKeyDown={(e) => moveByKey(e, "units", u.callsign, unitKeys)}
                      onClick={() => {
                        if (asks != null) return focusOn(decisions[asks], asks);
                        if (open) {
                          setOpenUnit(null);
                          return;
                        }
                        setPicked(null);
                        setTimelineOpen(false);
                        setOpenUnit(u.callsign);
                        if (u.position) flyToUnit(u);
                      }}
                      title={asks != null ? "Open its question in Decisions" : open ? undefined : st.text}
                    >
                      <span className={styles.unitDot} style={{ background: u.colour }} aria-hidden="true" />
                      <span className={styles.unitMain}>
                        <span className={styles.unitTop}>
                          <span className={styles.unitName}>{u.callsign}</span>
                          {/* How long since it was last heard. An ended mission has no "ago": the
                              picture is the one at its end. */}
                          {u.lastHeard && effNow ? <span className={styles.unitTime}>{atEnd ? fmtTime(u.lastHeard) : fmtAgo(effNow - u.lastHeard)}</span> : null}
                        </span>
                        <span className={styles.unitStatus}>
                          {/* "Placed" is what most units are: the strip says only what differs. */}
                          {st.tone === "placed" ? null : (
                            <span className={styles.pill} data-status={st.tone}>
                              {st.tag}
                            </span>
                          )}
                          {st.text}
                          {/* Its grid, to say on the radio [245]; not under a question, which says no place. */}
                          {u.pending || u.prompt ? null : <GridTag at={u.position} />}
                          {/* The time it was heard, in the open strip. */}
                          {open && u.lastHeard && !atEnd ? <span className={styles.unitClock}> · heard {fmtTime(u.lastHeard)}</span> : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </aside>

      {/* Tracks on the right, one strip each, and the reports folded under them [258]. */}
      <aside className={`${styles.side} ${styles.tracksCol}`} data-tab={tab === "units" ? undefined : tab} aria-label="Tracks and reports">
          <section className={`${styles.section} ${styles.tracksSection}`} aria-labelledby="tracks-h">
            <h2 id="tracks-h" className={styles.h2}>
              Tracks <span className={styles.count}>{view.tracks.length}</span>
              {trackView.sort === "mine" && orders.tracks.length ? (
                <button
                  type="button"
                  className={`${styles.unpinBtn} ${styles.resetBtn}`}
                  onClick={() => {
                    saveOrders({ ...orders, tracks: [] });
                    updateTrackView(() => ({ sort: "number" }));
                  }}
                  title="Put the tracks back in order by number"
                  aria-label="Reset the tracks' order"
                >
                  Reset
                </button>
              ) : null}
            </h2>
            {view.tracks.length === 0 ? <p className={styles.empty}>What the units see shows here.</p> : null}
            {/* Sort, groups and filter: on this screen and in this list only; the map shows every track [259]. */}
            {/* One line says how the list is drawn; it opens to chips for the sort, the groups and what shows. */}
            {view.tracks.length ? (
              <button
                type="button"
                className={styles.viewBtn}
                aria-expanded={viewOpen}
                aria-controls="track-view"
                data-hiding={arranged.hidden > 0 || undefined}
                onClick={() => setViewOpen((o) => !o)}
                title="Sort, group and filter this list"
              >
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M3.5 10V2M1.5 4l2-2 2 2M8.5 2v8M6.5 8l2 2 2-2" />
                </svg>
                <span className={styles.viewText}>
                  {TRACK_SORTS.find((s) => s.id === trackView.sort)?.label}
                  {trackView.group !== "none" ? ` · by ${TRACK_GROUPS.find((g) => g.id === trackView.group)?.label.toLowerCase()}` : null}
                </span>
                {arranged.hidden ? <span className={styles.viewHidden}>{arranged.hidden} hidden</span> : null}
                <span className={styles.foldMark} aria-hidden="true">
                  {viewOpen ? "▴" : "▾"}
                </span>
              </button>
            ) : null}
            {view.tracks.length && viewOpen ? (
              <div id="track-view" className={styles.viewPanel}>
                <div className={styles.viewRow} role="group" aria-labelledby="track-sort-h">
                  <span id="track-sort-h" className={styles.viewLabel}>
                    Sort
                  </span>
                  {TRACK_SORTS.map((s) => (
                    <button key={s.id} type="button" aria-pressed={trackView.sort === s.id} onClick={() => updateTrackView(() => ({ sort: s.id }))}>
                      {s.label}
                    </button>
                  ))}
                </div>
                <div className={styles.viewRow} role="group" aria-labelledby="track-group-h">
                  <span id="track-group-h" className={styles.viewLabel}>
                    Group
                  </span>
                  {TRACK_GROUPS.map((g) => (
                    <button key={g.id} type="button" aria-pressed={trackView.group === g.id} onClick={() => updateTrackView(() => ({ group: g.id }))}>
                      {g.label}
                    </button>
                  ))}
                </div>
                <div className={styles.viewRow} role="group" aria-labelledby="track-show-h">
                  <span id="track-show-h" className={styles.viewLabel}>
                    Show
                  </span>
                  {TRACK_HIDES.map((h) => (
                    <button key={h.id} type="button" data-hide={h.id} aria-pressed={!trackView.hide.includes(h.id)} onClick={() => toggleHide(h.id)}>
                      {h.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className={styles.trackLists} data-lane-scroll="">
              {arranged.sections.map((s) => {
                const keys = s.tracks.map((t) => String(t.n));
                const foldId = `${trackView.group}:${s.id}`;
                const isFolded = s.label != null && folded.includes(foldId);
                return (
                  <div key={s.id} className={styles.trackGroup}>
                    {s.label ? (
                      <h3 className={styles.groupHead}>
                        <button type="button" className={styles.foldBtn} aria-expanded={!isFolded} onClick={() => setFolded((f) => (isFolded ? f.filter((x) => x !== foldId) : [...f, foldId]))}>
                          {s.label} <span className={styles.count}>{s.tracks.length}</span>
                          <span className={styles.foldMark} aria-hidden="true">
                            {isFolded ? "▸" : "▾"}
                          </span>
                        </button>
                      </h3>
                    ) : null}
                    {isFolded ? null : (
                      <ul className={`${styles.units} ${styles.tracks}`} onClickCapture={swallowDragClick}>
                        {/* Tracks marked gone go last in every sort: they are off the map and kept for the record. */}
                        {asDrawn(s.id, keys).map((k) => {
                          const t = s.tracks.find((x) => String(x.n) === k);
                          if (!t) return null;
                          const old = isOld(t);
                          const st = trackStatus(t, old);
                          return (
                            <li key={t.n} data-lane-key={`tracks:${t.n}`} data-dragging={(drag?.lane === "tracks" && drag.key === k) || undefined}>
                              <button
                                type="button"
                                className={styles.unit}
                                data-tone={st.tone}
                                data-selected={picked === t.n || undefined}
                                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                                onPointerDown={(e) => pressStrip(e, "tracks", k, s.id)}
                                onKeyDown={(e) => moveByKey(e, "tracks", k, keys)}
                                onClick={() => flyToTrack(t)}
                                title={t.position && t.gone == null ? "Show on the map" : "Show its card"}
                              >
                                {/* The same standard symbol as on the map. Drawn by milsymbol from a code this page builds. */}
                                <span className={styles.trackSym} aria-hidden="true" dangerouslySetInnerHTML={symbols ? { __html: trackSvg(symbols, t, 18) } : undefined} />
                                <span className={styles.unitMain}>
                                  <span className={styles.unitTop}>
                                    {/* "T1" in a thin column, as the map labels it. */}
                                    <span className={styles.unitName}>
                                      <span className={styles.longName}>Track </span>
                                      <span className={styles.shortName}>T</span>
                                      {t.n}
                                    </span>
                                    {t.seenTs && effNow ? <span className={styles.unitTime}>{atEnd ? fmtTime(t.seenTs) : fmtAgo(effNow - t.seenTs)}</span> : null}
                                  </span>
                                  <span className={styles.unitStatus}>
                                    {/* Whose it is: the symbol's frame says it too, so only the picked track's strip has the word. */}
                                    <span className={`${styles.pill} ${styles.affPill}`} data-status={t.affiliation}>
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
                                    {st.main}
                                  </span>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
              {arranged.hidden ? (
                <p className={styles.hiddenNote}>
                  {arranged.hidden === 1 ? "1 track" : `${arranged.hidden} tracks`} hidden in this list only.{" "}
                  <button type="button" className={styles.linkBtn} onClick={() => updateTrackView(() => ({ hide: [] }))}>
                    Show all
                  </button>
                </p>
              ) : null}
            </div>
          </section>

        {/* The reports, newest first: folded to the newest one, or the whole history [258]. */}
        <section className={`${styles.section} ${styles.feedSection}`} data-open={reportsOpen || undefined} aria-labelledby="feed-h">
          <h2 id="feed-h" className={styles.h2}>
            <button type="button" className={styles.foldBtn} aria-expanded={reportsOpen} onClick={() => setReportsOpen((o) => !o)}>
              Reports <span className={styles.count}>{view.feed.filter((f) => f.kind === "report").length}</span>
              <span className={styles.foldMark} aria-hidden="true">
                {reportsOpen ? "▾" : "▸"}
              </span>
            </button>
          </h2>
          {session && view.feed.length === 0 ? <p className={styles.empty}>{mode === "replay" ? "No reports at this time." : "No reports yet. Each one appears here with its time, call sign and outcome."}</p> : null}
          <ol className={styles.feed}>
            {(reportsOpen ? view.feed : view.feed.slice(0, 1)).map((f) => {
              if (f.kind === "plot" || f.kind === "note" || f.kind === "request" || f.kind === "task" || f.kind === "reply") {
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
                      onMouseEnter={() => setHoverEvent(f)}
                      onMouseLeave={() => setHoverEvent(null)}
                      onFocus={() => setHoverEvent(f)}
                      onBlur={() => setHoverEvent(null)}
                      onClick={() => {
                        flyToItem(f);
                        if (t && !f.position) flyToTrack(t);
                        else if (f.track != null) setPicked(f.track);
                      }}
                    >
                      <span className={styles.itemTime}>{fmtTime(f.ts)}</span>
                      <span className={styles.itemCall}>
                        <span className={styles.itemDot} style={{ background: f.kind === "request" || f.kind === "reply" ? f.colour : CP_COLOUR }} aria-hidden="true" />
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
                    <button
                      type="button"
                      className={styles.joinItem}
                      data-selected={selected === f.id || undefined}
                      onMouseEnter={() => setHoverEvent(f)}
                      onMouseLeave={() => setHoverEvent(null)}
                      onFocus={() => setHoverEvent(f)}
                      onBlur={() => setHoverEvent(null)}
                      onClick={() => flyToItem(f)}
                      disabled={!f.position}
                    >
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
              // Waiting in the Decisions list: answered there, not here [240].
              const waiting = decisionAt.get(f.id);
              const open = waiting != null;
              // The same words as the units list, so a state has one name on the page.
              const estimate = f.status === "resolved" && !!f.position?.estimated;
              const pill = open
                ? { tone: "ask", tag: "Awaiting answer" }
                : f.expired
                  ? { tone: "none", tag: "Not answered" }
                  : f.overtaken
                    ? // Closed by the unit's next report, or by a person placing the unit by hand [243].
                      { tone: "none", tag: f.byHand ? "Closed" : "Overtaken" }
                    : f.status === "ambiguous"
                      ? { tone: "answered", tag: f.answer?.by ? `${f.answer.by} answered` : "Answered" }
                      : f.status === "unresolved" && f.answer
                        ? { tone: "answered", tag: f.answer.by ? `${f.answer.by} closed` : "Closed" }
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
                  <button
                    type="button"
                    className={styles.item}
                    data-selected={selected === f.id || undefined}
                    data-open={open || undefined}
                    onMouseEnter={() => setHoverEvent(f)}
                    onMouseLeave={() => setHoverEvent(null)}
                    onFocus={() => setHoverEvent(f)}
                    onBlur={() => setHoverEvent(null)}
                    onClick={() => {
                      if (waiting != null) focusOn(decisions[waiting], waiting);
                      else {
                        // The words, the intent and the rule behind the place, and the map on it.
                        setInspected(f);
                        flyToItem(f);
                      }
                    }}
                    title={open ? "Open it in Decisions" : "What the app heard, and how it placed it"}
                  >
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
                    <span className={styles.outcome}>
                      {f.outcome}
                      {open ? null : <GridTag at={f.position} />}
                    </span>
                    {f.sender ? <span className={styles.heardLine}>{describeSender(f.sender)}</span> : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      </aside>

      <div className={styles.srOnly} aria-live="polite">
        {mode === "live" && latest ? `${latest.callsign}: ${latest.outcome}` : ""}
      </div>

      {helpOpen ? (
        <div
          className={styles.find}
          role="dialog"
          aria-modal="true"
          aria-label="Help and keyboard shortcuts"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setHelpOpen(false);
          }}
        >
          <div className={styles.helpCard}>
            <div className={styles.helpHead}>
              <h2>Keys and clicks</h2>
              <button autoFocus type="button" className={styles.linkBtn} onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
            <dl className={styles.helpList}>
              <dt>P</dt>
              <dd>Place a track by hand.</dd>
              <dt>H S U C F</dt>
              <dd>Hostile, suspect, unknown, civilian or friendly, while placing or changing a track.</dd>
              <dt>1–9</dt>
              <dd>Pick a track kind in the palette, or a choice in an open decision.</dd>
              <dt>↑ ↓ / J K</dt>
              <dd>Move through the Decisions list.</dd>
              <dt>N / Enter</dt>
              <dd>None of the choices, then confirm the pick.</dd>
              <dt>Ctrl / ⌘ K</dt>
              <dd>Find a call sign, a track or a place.</dd>
              <dt>Page Up / Page Down</dt>
              <dd>Jump between mission starts and ends on the replay bar.</dd>
              <dt>Esc</dt>
              <dd>Step back, or close the open panel or drawer.</dd>
              <dt>?</dt>
              <dd>This help.</dd>
            </dl>
            <p className={styles.helpNote}>
              Click a track for its <b>Info / History / Recon</b> panel, or a unit in the Units list for the same.
              The map keeps the track number; the panel names what it is.
            </p>
            <div className={styles.helpActions}>
              <button type="button" className={styles.ghostBtn} aria-pressed={awake} onClick={() => void toggleAwake()}>
                {awake ? "Screen stays awake" : "Keep the screen awake"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {findOpen ? (
        <div
          className={styles.find}
          role="dialog"
          aria-modal="true"
          aria-label="Find"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setFindOpen(false);
          }}
        >
          <div className={styles.findCard}>
            <input
              autoFocus
              value={find}
              onChange={(e) => {
                setFind(e.target.value);
                setFindAt(0);
                if (e.target.value.trim().length < 2) setPlaceResults([]);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setFindOpen(false);
                else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setFindAt((i) => Math.min(findResults.length - 1, i + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setFindAt((i) => Math.max(0, i - 1));
                } else if (e.key === "Enter" && findResults[findAt]) {
                  pickFind(findResults[findAt]);
                }
              }}
              placeholder="Call sign, track, drone, place…"
              aria-label="Find a unit, a track or a place"
            />
            {find.trim() ? (
              findResults.length ? (
                <ul className={styles.findList}>
                  {findResults.map((r, i) => (
                    <li key={r.key}>
                      <button type="button" data-active={i === findAt || undefined} onMouseEnter={() => setFindAt(i)} onClick={() => pickFind(r)}>
                        <b>{r.label}</b>
                        <span>{r.detail}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.findHint}>Nothing matches.</p>
              )
            ) : (
              <p className={styles.findHint}>Type a call sign (ALPHA 1), a track (T2), a kind (drone, vehicle) or a place name.</p>
            )}
          </div>
        </div>
      ) : null}

      {inspected ? (
        <ReportInspector
          item={inspected}
          entry={inspectedEntry}
          canEdit={canEdit}
          session={session}
          area={area}
          format={fmtTime}
          onClose={() => setInspected(null)}
          onShow={() => {
            const f = inspected;
            setInspected(null);
            if (f) flyToItem(f);
          }}
          onCopy={(text) => {
            void copyText(text).then((ok) => setNotice(ok ? "Copied." : "Could not copy."));
          }}
          onSent={() => pollNow.current()}
          onNotice={setNotice}
        />
      ) : null}

      {welcome ? (
        <div
          className={styles.find}
          role="dialog"
          aria-modal="true"
          aria-label="Welcome to the command post"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeWelcome();
          }}
        >
          <div className={styles.helpCard}>
            <div className={styles.helpHead}>
              <h2>Welcome to the command post</h2>
              <button autoFocus type="button" className={styles.linkBtn} onClick={closeWelcome}>
                Close
              </button>
            </div>
            <p className={styles.helpNote}>
              The map is the mission. What a unit says becomes a marker, a circle and a line in the
              reports; when the words could mean more than one place, the app asks back instead of guessing.
            </p>
            <ul className={styles.welcomeList}>
              <li><b>Units on the left, tracks on the right.</b> Click one for its side panel: Info, History and Recon.</li>
              <li><b>Click a report</b> to see the words, what the model understood, the rule that placed it and the timings.</li>
              <li><b>Timeline</b> replays the mission; <b>Find</b> or Ctrl/⌘ K jumps to a call sign, a track or a place.</li>
            </ul>
            <div className={styles.helpActions}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => {
                  closeWelcome();
                  pickSession(DEMO_SESSION);
                }}
              >
                Open the demo mission
              </button>
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => {
                  closeWelcome();
                  setPanelOpen(true);
                }}
              >
                Start my own
              </button>
            </div>
            <p className={styles.helpNote}>
              This card shows once in this browser. The full keys are under <b>…</b> then <b>Keys and clicks</b>.
            </p>
          </div>
        </div>
      ) : null}

      {auth !== "open" ? (
        <div className={styles.lock} role="dialog" aria-modal="true" aria-label="Command post locked">
          <form className={styles.lockCard} onSubmit={unlock}>
            <h2>Command post</h2>
            {auth === "checking" ? (
              <p>Checking the coordinator…</p>
            ) : (
              <>
                <p>Enter the operator PIN to change the mission. Viewing stays open.</p>
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  autoComplete="current-password"
                  aria-label="Operator PIN"
                  autoFocus
                />
                {authError ? <p className={styles.lockError} role="alert">{authError}</p> : null}
                <button type="submit">Unlock</button>
              </>
            )}
          </form>
        </div>
      ) : null}
    </div>
  );
}
