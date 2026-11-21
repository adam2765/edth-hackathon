"use client";

/**
 * The receiver: the shared map a person at the base station watches. It opens and ends missions;
 * otherwise it only shows. It polls the mission's log every second and rebuilds the picture with
 * foldLog(), so the live view and a replay are the same code: a replay is the log read up to a moment.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ExpressionSpecification, GeoJSONSource, Map as MLMap, Marker } from "maplibre-gl";
import { bearingDeg, destination, distanceM } from "@/lib/geo/geo";
import { AREAS, DEFAULT_AREA, isAreaId, type AreaId } from "@/lib/geo/areas";
import { colourMap, FADE_AFTER_MS, foldLog, type FeedItem, type UnitState } from "@/lib/reports/fold";
import { sessionCode, type LogEntry, type MissionListReply, type SessionLogReply } from "@/lib/reports/types";
import MissionPanel from "./MissionPanel";
import styles from "./Receiver.module.css";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const POLL_MS = 1000;
const STEP_MS = 200;
const SPEEDS = [1, 10, 30];
const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
// The bottom leaves room for the replay bar; the right for the zoom buttons.
const MAP_PADDING = { top: 70, bottom: 120, left: 60, right: 80 };

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

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function fmtSpan(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// The page's address says which mission is shown, so a projector's tab can be reloaded or shared.
const LOCATION_EVENT = "receiver:location";
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

function unitStatus(u: UnitState, silent: boolean, now: number): { text: string; tone: "ok" | "ask" | "muted" } {
  if (u.pending) return { text: `Awaiting answer: ${u.pending.question}`, tone: "ask" };
  if (silent) return { text: `Silent for ${fmtAgo(now - u.lastHeard)}${u.position ? ` · last at ${u.position.label}` : ""}`, tone: "muted" };
  if (!u.position) return { text: u.joined != null ? "Joined · not placed yet" : "Not placed yet", tone: "muted" };
  const p = u.position;
  return { text: `${p.estimated ? "≈ " : ""}${p.label} · ±${p.radius_m} m`, tone: "ok" };
}

export default function Receiver() {
  // ?session= picks the mission; with none, the newest open one is shown. ?area= pins the map to one area.
  const search = useSyncExternalStore(subscribeLocation, () => window.location.search, () => "");
  const { session, fixedArea } = useMemo(() => {
    const q = new URLSearchParams(search);
    const a = q.get("area");
    return { session: sessionCode(q.get("session")), fixedArea: isAreaId(a) ? a : null };
  }, [search]);

  // The log of the session shown; entries of another session are dropped when it changes.
  const [log, setLog] = useState<{ session: string | null; entries: LogEntry[] }>({ session: null, entries: [] });
  const entries = useMemo(() => (log.session === session ? log.entries : []), [log, session]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** With no mission in the address: still looking for one, or none is open. */
  const [noMission, setNoMission] = useState(false);
  const [stored, setStored] = useState<boolean | null>(null);
  const [lastOk, setLastOk] = useState(0);
  const [now, setNow] = useState(0);
  const [mode, setMode] = useState<"live" | "replay">("live");
  const [replayT, setReplayT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [follow, setFollow] = useState(true);
  const [manualArea, setManualArea] = useState<AreaId | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  /** Bumped when the map changes size, so following refits (a projector often changes the window). */
  const [mapSize, setMapSize] = useState("");

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const candMarkers = useRef<Marker[]>([]);
  const countRef = useRef(0);
  const replayRef = useRef({ t: 0, end: 0 });

  // ---------- which mission ----------
  // No mission in the address: show the newest open one, or open the missions menu.
  useEffect(() => {
    if (session) return;
    let stop = false;
    (async () => {
      try {
        const res = await fetch("/api/sessions", { cache: "no-store" });
        if (!res.ok || stop) return;
        const data = (await res.json()) as MissionListReply;
        setStored(data.stored);
        setLastOk(Date.now());
        const open = data.missions.find((m) => m.ended == null);
        if (open) showSession(open.code, true);
        else {
          setNoMission(true);
          if (data.stored) setPanelOpen(true);
        }
      } catch {
        // The connection light shows it.
      }
    })();
    return () => {
      stop = true;
    };
  }, [session]);

  const pickSession = useCallback((code: string | null) => {
    setPlaying(false);
    setMode("live");
    setFollow(true);
    setConfirmEnd(false);
    setActionError(null);
    setNoMission(code == null);
    showSession(code);
  }, []);

  // ---------- the log ----------
  useEffect(() => {
    if (!session) return;
    let stop = false;
    let busy = false;
    let loaded = false;
    countRef.current = 0;
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
          setLog({ session, entries: [] });
        } else if (data.entries.length || !loaded) {
          const from = countRef.current;
          countRef.current += data.entries.length;
          setLog((l) => ({ session, entries: l.session === session && from > 0 ? [...l.entries, ...data.entries] : data.entries }));
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
    const id = setInterval(poll, POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
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
  const effNow = mode === "live" ? now : replayT;
  const mission = full.mission;
  const area: AreaId = fixedArea ?? mission?.area ?? manualArea ?? view.area ?? DEFAULT_AREA;
  const rangeStart = full.first != null ? full.first - 2000 : 0;
  const rangeEnd = full.last != null ? full.last + 2000 : 0;
  const isSilent = useCallback((u: UnitState) => effNow > 0 && effNow - u.lastHeard > FADE_AFTER_MS, [effNow]);

  useEffect(() => {
    replayRef.current = { t: replayT, end: rangeEnd };
  }, [replayT, rangeEnd]);

  // ---------- replay ----------
  const goLive = useCallback(() => {
    setPlaying(false);
    setMode("live");
    setFollow(true);
  }, []);

  const scrub = useCallback((t: number) => {
    setMode("replay");
    setReplayT(t);
  }, []);

  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // From live, or from the end, a replay starts at the beginning of the session.
    if (mode === "live" || replayRef.current.t >= replayRef.current.end) setReplayT(rangeStart);
    setMode("replay");
    setFollow(true);
    setPlaying(true);
  }, [playing, mode, rangeStart]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const { t, end } = replayRef.current;
      const next = t + STEP_MS * speed;
      if (next >= end) {
        // The replay has caught up with the present: back to live.
        setPlaying(false);
        setMode("live");
      } else setReplayT(next);
    }, STEP_MS);
    return () => clearInterval(id);
  }, [playing, speed]);

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
      map.on("load", () => {
        for (const id of ["start", "trail", "accuracy", "arrow", "target", "pos"]) map.addSource(id, { type: "geojson", data: EMPTY_FC });
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
        map.addLayer({ id: "arrow-shaft", type: "line", source: "arrow", filter: ["==", "part", "shaft"], layout: { "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": op } });
        map.addLayer({ id: "arrow-head", type: "fill", source: "arrow", filter: ["==", "part", "head"], paint: { "fill-color": ["get", "color"], "fill-opacity": op } });
        map.addLayer({ id: "target", type: "circle", source: "target", paint: { "circle-radius": 10, "circle-color": "rgba(255,255,255,0.35)", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2, "circle-stroke-opacity": op } });
        map.addLayer({ id: "pos", type: "circle", source: "pos", paint: { "circle-radius": 9, "circle-color": ["get", "color"], "circle-opacity": op, "circle-stroke-color": "#fff", "circle-stroke-width": 3, "circle-stroke-opacity": op } });
        // Call sign and time of the last update next to each marker, as in Lysk's brief.
        map.addLayer({
          id: "pos-label",
          type: "symbol",
          source: "pos",
          layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 14, "text-offset": [0, 1.2], "text-anchor": "top", "text-allow-overlap": true, "text-ignore-placement": true },
          paint: { "text-color": "#16212c", "text-halo-color": "#ffffff", "text-halo-width": 2, "text-opacity": op },
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

  // Draw every unit: marker with call sign and time, circle, trail, movement arrow.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const pos: GeoJSON.Feature[] = [];
    const acc: GeoJSON.Feature[] = [];
    const trail: GeoJSON.Feature[] = [];
    const arrows: GeoJSON.Feature[] = [];
    const targets: GeoJSON.Feature[] = [];
    // Units on the same spot (often the start point) share one label, so call signs do not overprint.
    const together = new Map<string, UnitState[]>();
    for (const u of view.units) {
      if (!u.position || u.positionTs == null) continue;
      const k = `${u.position.lat.toFixed(5)},${u.position.lon.toFixed(5)}`;
      together.set(k, [...(together.get(k) ?? []), u]);
    }
    const labelled = new Set<string>();
    for (const u of view.units) {
      const op = isSilent(u) ? 0.35 : 1;
      const color = u.colour;
      const p = u.position;
      const pts = [...u.trail, ...(p ? [p] : [])];
      if (pts.length > 1) trail.push({ type: "Feature", properties: { color, op }, geometry: { type: "LineString", coordinates: pts.map((x) => [x.lon, x.lat]) } });
      for (const t of u.trail) trail.push({ type: "Feature", properties: { color, op }, geometry: { type: "Point", coordinates: [t.lon, t.lat] } });
      if (!p || u.positionTs == null) continue;
      const k = `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
      const group = together.get(k) ?? [u];
      const newest = Math.max(...group.map((x) => x.positionTs ?? 0));
      const label = labelled.has(k) ? "" : `${group.map((x) => x.callsign).join(" · ")}\n${p.estimated ? "≈ " : ""}${fmtTime(newest)}`;
      labelled.add(k);
      pos.push({ type: "Feature", properties: { color, op, label }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
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

  // Open questions: each choice numbered on the map in its unit's colour.
  const pendings = useMemo(() => view.units.filter((u) => u.pending), [view]);
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    candMarkers.current.forEach((m) => m.remove());
    candMarkers.current = [];
    if (!map || !ml || !mapReady) return;
    for (const u of pendings) {
      u.pending!.candidates.forEach((c, i) => {
        const el = document.createElement("div");
        el.className = styles.candMarker;
        el.style.background = u.colour;
        el.textContent = String(i + 1);
        el.title = `${u.callsign}, choice ${i + 1}: ${c.name}`;
        candMarkers.current.push(new ml.Marker({ element: el }).setLngLat([c.lon, c.lat]).addTo(map));
      });
    }
  }, [pendings, mapReady]);

  // Follow: keep every unit in this area (and its open choices) in view as reports come in.
  const followPoints = useMemo(() => {
    const pts: LatLon[] = [];
    for (const u of view.units) {
      if (u.area !== area) continue;
      if (u.position) pts.push(u.position);
      if (u.position?.heading_to) pts.push(u.position.heading_to);
      u.pending?.candidates.forEach((c) => pts.push(c));
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
  const connected = now > 0 && now - lastOk < (session ? 3500 : 60_000);
  const ended = mission?.ended ?? null;
  const latest = view.feed[0];
  const sliderValue = mode === "live" ? rangeEnd : Math.min(Math.max(replayT, rangeStart), rangeEnd);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true" />
          Voice-to-Map <span className={styles.brandSub}>Receiver</span>
        </div>
        {mission ? (
          <div className={styles.missionHead}>
            <span className={styles.missionTitle}>{mission.name}</span>
            <span className={styles.chip} title="Phones join this mission by picking it from the list on the coordinator">
              code <strong>{session}</strong>
            </span>
            {ended != null ? <span className={styles.endedChip}>Ended {fmtTime(ended)}</span> : null}
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
              <span className={styles.confirmText} title="Phones can no longer report to it. It stays here for replay.">
                End this mission?
              </span>
              <button type="button" className={styles.dangerBtn} onClick={endMission}>
                End mission
              </button>
              <button type="button" className={styles.linkBtn} onClick={() => setConfirmEnd(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className={styles.ghostBtn} onClick={() => setConfirmEnd(true)}>
              End mission
            </button>
          )
        ) : null}
        {actionError ? (
          <span className={styles.error} role="alert">
            {actionError}
          </span>
        ) : null}
        {!fixedArea && !mission && session ? (
          <div className={styles.segmented} role="group" aria-label="Area">
            {(Object.keys(AREAS) as AreaId[]).map((id) => (
              <button key={id} type="button" aria-pressed={area === id} onClick={() => setManualArea(id)}>
                {AREAS[id].label}
              </button>
            ))}
          </div>
        ) : null}
        <div className={styles.spacer} />
        <div className={styles.conn} data-state={stored === false ? "off" : connected ? "on" : "wait"} role="status">
          <span className={styles.connDot} aria-hidden="true" />
          {stored === false ? "This coordinator keeps no record" : connected ? "Connected" : lastOk ? "Reconnecting…" : "Connecting…"}
        </div>
        <button type="button" className={styles.menuBtn} aria-expanded={panelOpen} aria-haspopup="dialog" onClick={() => setPanelOpen((o) => !o)}>
          Missions ▾
        </button>
        {panelOpen ? <MissionPanel current={session} defaultArea={mission?.area ?? area} onPick={pickSession} onClose={closePanel} /> : null}
      </header>

      <main className={styles.mapCol}>
        <div ref={mapEl} className={styles.map} aria-label="Map of all units" />
        {!follow ? (
          <button type="button" className={styles.followBtn} onClick={() => setFollow(true)}>
            Follow units
          </button>
        ) : null}
        {mode === "replay" ? (
          <div className={styles.replayBadge}>Replay · {fmtTime(replayT)}</div>
        ) : ended != null ? (
          <div className={styles.endedBanner}>Mission ended at {fmtTime(ended)}. Press ▶ to replay it.</div>
        ) : null}

        <div className={styles.replayBar}>
          <button type="button" className={styles.liveBtn} aria-pressed={mode === "live"} onClick={goLive}>
            <span className={styles.liveDot} aria-hidden="true" /> Live
          </button>
          <button type="button" className={styles.playBtn} onClick={togglePlay} disabled={!entries.length} aria-label={playing ? "Pause replay" : "Play replay"}>
            {playing ? "❚❚" : "▶"}
          </button>
          <input
            className={styles.slider}
            type="range"
            min={rangeStart}
            max={rangeEnd}
            step={1000}
            value={sliderValue}
            disabled={!entries.length}
            onChange={(e) => {
              setPlaying(false);
              scrub(Number(e.target.value));
            }}
            aria-label="Replay time"
            // No time before the first entry: the server's locale would not match the browser's.
            aria-valuetext={entries.length ? fmtTime(sliderValue) : undefined}
          />
          <div className={styles.time}>
            {mode === "live" ? (
              <>Live{now ? ` · ${fmtTime(now)}` : ""}</>
            ) : (
              <>
                {fmtTime(replayT)} <span className={styles.muted}>−{fmtSpan(rangeEnd - replayT)}</span>
              </>
            )}
          </div>
          <div className={styles.segmentedSmall} role="group" aria-label="Replay speed">
            {SPEEDS.map((s) => (
              <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                {s}×
              </button>
            ))}
          </div>
        </div>
      </main>

      <aside className={styles.side}>
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
                    ? ended != null
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
                const st = unitStatus(u, silent, effNow);
                return (
                  <li key={u.callsign}>
                    <button type="button" className={styles.unit} data-silent={silent || undefined} data-ask={!!u.pending || undefined} onClick={() => flyToUnit(u)} disabled={!u.position}>
                      <span className={styles.unitDot} style={{ background: u.colour }} aria-hidden="true" />
                      <span className={styles.unitMain}>
                        <span className={styles.unitName}>{u.callsign}</span>
                        <span className={styles.unitStatus} data-tone={st.tone}>
                          {st.text}
                        </span>
                      </span>
                      <span className={styles.unitTime}>{u.lastHeard ? fmtTime(u.lastHeard) : ""}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={`${styles.section} ${styles.feedSection}`} aria-labelledby="feed-h">
          <h2 id="feed-h" className={styles.h2}>
            Reports <span className={styles.count}>{view.feed.filter((f) => f.kind === "report").length}</span>
          </h2>
          <ol className={styles.feed}>
            {view.feed.map((f) => {
              if (f.kind === "join") {
                return (
                  <li key={f.id}>
                    <button type="button" className={styles.joinItem} data-selected={selected === f.id || undefined} onClick={() => flyToItem(f)} disabled={!f.position}>
                      <span className={styles.itemTime}>{fmtTime(f.ts)}</span>
                      <span className={styles.itemCall} style={{ borderColor: f.colour }}>
                        {f.callsign}
                      </span>
                      <span className={styles.joinText}>{f.outcome}</span>
                    </button>
                  </li>
                );
              }
              const open = f.status === "ambiguous" && !f.answer && !f.expired;
              return (
                <li key={f.id}>
                  <button type="button" className={styles.item} data-selected={selected === f.id || undefined} data-open={open || undefined} onClick={() => flyToItem(f)}>
                    <span className={styles.itemHead}>
                      <span className={styles.itemTime}>{fmtTime(f.ts)}</span>
                      <span className={styles.itemCall} style={{ borderColor: f.colour }}>
                        {f.callsign}
                      </span>
                      <span className={styles.pill} data-status={open ? "open" : f.status}>
                        {open ? "Awaiting answer" : f.expired ? "Not answered" : f.status === "ambiguous" ? "Answered" : f.status === "resolved" ? "Placed" : "Not placed"}
                      </span>
                    </span>
                    <span className={styles.said}>{f.transcript ? `“${f.transcript}”` : "(no words heard)"}</span>
                    <span className={styles.outcome}>{f.outcome}</span>
                    {open && f.candidates.length ? (
                      <ol className={styles.choices}>
                        {f.candidates.map((c, i) => (
                          <li key={c.id}>
                            <span className={styles.choiceN} style={{ background: f.colour }}>
                              {i + 1}
                            </span>
                            {c.name}
                            {c.town ? ` (${c.town})` : ""} <span className={styles.muted}>· {c.category.replace("_", " ")}</span>
                          </li>
                        ))}
                      </ol>
                    ) : null}
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
    </div>
  );
}
