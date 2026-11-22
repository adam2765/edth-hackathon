"use client";

/**
 * Grid tools on a map [232]: the MGRS grid under the pointer, the grid's lines, a ruler that gives
 * distance and bearing between two points, and a box to go to a grid. On the map page a click also
 * copies the grid under it. Used by the map page, and by the command post, where the tools are
 * `folded` behind one button and the grid under the pointer is a line at the map's edge [245].
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import type { GeoJSONSource, Map as MLMap, MapMouseEvent } from "maplibre-gl";
import type { LatLon } from "@/lib/geo/geo";
import { gridLines, gridSpacing, measureText, readGrid, shortGrid, toGrid, type GridLabels } from "@/lib/geo/grid";
import styles from "./MapTools.module.css";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

interface Props {
  mapRef: RefObject<MLMap | null>;
  /** True once the map's style has loaded, so sources and layers can be added. */
  ready: boolean;
  /** The area's centre: where a grid with its square left out is read from. */
  centre: LatLon;
  /** The id of a layer the grid lines go under, so they never hide a unit. */
  below?: string;
  /** A plain click copies the grid under it. Off where a click already does something. */
  copyOnClick?: boolean;
  /** Pixels from the top of the map: under the zoom buttons. */
  top?: string;
  /** Pixels at the bottom of the map that the page covers, such as a bar: the grid's figures stay above it. */
  covered?: () => number;
  /** Told when the ruler goes on or off, so the page's own clicks on the map can stand down. */
  onMeasuring?: (on: boolean) => void;
  /** How much larger the grid's figures are drawn, on a page that grows for a large screen. */
  scale?: number;
  /**
   * For a page with its own work on the map [245]: the buttons wait behind one button, closed
   * until asked for, and the grid under the pointer is one line at the map's bottom edge, in the
   * six figures a grid is said in, there only while a pointer is on the map.
   */
  folded?: boolean;
  /** Told when "Go" moves the map to a grid, so a page that keeps its units in view can let go. */
  onGo?: () => void;
}

/** The size of the grid's figures on the map, before `scale`. */
const LABEL_SIZE = 12;

export default function MapTools({ mapRef, ready, centre, below, copyOnClick = false, top = "110px", covered, onMeasuring, scale = 1, folded = false, onGo }: Props) {
  const [grid, setGrid] = useState("");
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [lines, setLines] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [measured, setMeasured] = useState("");
  const [goto, setGoto] = useState("");
  const [note, setNote] = useState("");
  const linesRef = useRef(lines);
  const measuringRef = useRef(measuring);
  const points = useRef<LatLon[]>([]);
  const centreRef = useRef(centre);
  const coveredRef = useRef(covered);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redrawRef = useRef<() => void>(() => {});
  const clearRulerRef = useRef<() => void>(() => {});
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    linesRef.current = lines;
    measuringRef.current = measuring;
    centreRef.current = centre;
    coveredRef.current = covered;
  });

  const say = (text: string) => {
    setNote(text);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(""), 2500);
  };

  // Sources, layers and the map's events, once the map is ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = (id: string) => map.getSource(id) as GeoJSONSource | undefined;
    if (!map.getSource("mgrs")) {
      map.addSource("mgrs", { type: "geojson", data: EMPTY });
      map.addSource("ruler", { type: "geojson", data: EMPTY });
      map.addSource("goto", { type: "geojson", data: EMPTY });
      const under = below && map.getLayer(below) ? below : undefined;
      map.addLayer({ id: "mgrs-line", type: "line", source: "mgrs", filter: ["==", "kind", "line"], paint: { "line-color": "#1e3a5f", "line-width": ["case", ["get", "major"], 2, 1], "line-opacity": 0.45 } }, under);
      map.addLayer(
        {
          id: "mgrs-label",
          type: "symbol",
          source: "mgrs",
          filter: ["==", "kind", "label"],
          layout: { "text-field": ["get", "text"], "text-font": ["Noto Sans Regular"], "text-size": LABEL_SIZE, "text-allow-overlap": true, "text-ignore-placement": true },
          paint: { "text-color": "#1e3a5f", "text-halo-color": "#ffffff", "text-halo-width": 2 },
        },
        under,
      );
      map.addLayer({ id: "ruler-line", type: "line", source: "ruler", filter: ["==", "$type", "LineString"], layout: { "line-cap": "round" }, paint: { "line-color": "#f2b33d", "line-width": 3, "line-dasharray": [2, 1] } });
      map.addLayer({ id: "ruler-pts", type: "circle", source: "ruler", filter: ["==", "$type", "Point"], paint: { "circle-radius": 5, "circle-color": "#f2b33d", "circle-stroke-color": "#12181d", "circle-stroke-width": 2 } });
      map.addLayer({ id: "goto-ring", type: "circle", source: "goto", paint: { "circle-radius": 14, "circle-color": "rgba(242,179,61,0.15)", "circle-stroke-color": "#f2b33d", "circle-stroke-width": 3 } });
    }

    let hovering = false;
    // Folded, the grid is written as it is said: the square and six figures [245].
    const write = (p: LatLon) => (folded ? shortGrid(p) : toGrid(p));
    const showCentre = () => {
      const c = map.getCenter();
      setGrid(write({ lat: c.lat, lon: c.lng }));
    };
    /**
     * Where the grid's figures go [233]: along the bottom and up the left of the part of the map
     * that nothing covers. The bottom is the map's padding, which keeps clear of the page's sheet,
     * or what the page says it covers [245]. The left column starts at the top of these tools,
     * which sit below the page's own buttons.
     */
    const labelPlace = (): GridLabels => {
      const el = map.getContainer();
      const w = el.clientWidth;
      const h = el.clientHeight;
      const top = toolsRef.current ? toolsRef.current.getBoundingClientRect().top - el.getBoundingClientRect().top : 0;
      const bottom = h - Math.max(map.getPadding().bottom ?? 0, coveredRef.current?.() ?? 0) - 12;
      const left = 14;
      const at = (x: number, y: number) => map.unproject([x, y]);
      return {
        row: at(w / 2, bottom).lat,
        column: at(left, h / 2).lng,
        // Clear of each other's corner: eastings right of the column, northings above the row.
        inside: { west: at(left + 20, 0).lng, east: at(w - 14, 0).lng, north: at(0, top).lat, south: at(0, bottom - 16).lat },
      };
    };
    const drawLines = () => {
      const spacing = gridSpacing(map.getZoom());
      if (!linesRef.current || !spacing) return src("mgrs")?.setData(EMPTY);
      const b = map.getBounds();
      src("mgrs")?.setData(gridLines({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, centreRef.current, spacing, labelPlace()));
    };
    const drawRuler = () => {
      const p = points.current;
      const fc: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          ...p.map((q): GeoJSON.Feature => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [q.lon, q.lat] } })),
          ...(p.length === 2 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: p.map((q) => [q.lon, q.lat]) } } as GeoJSON.Feature] : []),
        ],
      };
      src("ruler")?.setData(fc);
    };
    const onMove = (e: MapMouseEvent) => {
      hovering = true;
      setOver(true);
      setGrid(write({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
    };
    const onOut = () => {
      hovering = false;
      setOver(false);
      showCentre();
    };
    // A tap also sends mouse events, so it counts as hovering, and a touch screen never sends
    // "mouseout". Without this the box would keep the tapped point while the map is dragged [233].
    const onTouch = () => {
      hovering = false;
      setOver(false);
    };
    const onMoveEnd = () => {
      if (!hovering) showCentre();
      drawLines();
    };
    const onClick = (e: MapMouseEvent) => {
      const at = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      if (measuringRef.current) {
        // A third click starts a new measure.
        points.current = points.current.length >= 2 ? [at] : [...points.current, at];
        drawRuler();
        setMeasured(points.current.length === 2 ? measureText(points.current[0], points.current[1]) : "Click the second point");
        return;
      }
      if (!copyOnClick) return;
      const g = toGrid(at);
      navigator.clipboard?.writeText(g).then(
        () => say(`Copied ${g}`),
        () => say(g),
      );
    };
    // The buttons draw again through these.
    redrawRef.current = drawLines;
    clearRulerRef.current = () => {
      points.current = [];
      drawRuler();
    };
    map.on("mousemove", onMove);
    map.on("mouseout", onOut);
    map.on("touchstart", onTouch);
    map.on("moveend", onMoveEnd);
    map.on("click", onClick);
    showCentre();
    drawLines();
    return () => {
      map.off("mousemove", onMove);
      map.off("mouseout", onOut);
      map.off("touchstart", onTouch);
      map.off("moveend", onMoveEnd);
      map.off("click", onClick);
    };
  }, [mapRef, ready, below, copyOnClick, folded]);

  // The grid's figures grow with the page, and the lines are drawn again around them [245].
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("mgrs-label")) return;
    map.setLayoutProperty("mgrs-label", "text-size", Math.round(LABEL_SIZE * scale));
    redrawRef.current();
  }, [mapRef, ready, scale]);

  const toggleLines = () => {
    linesRef.current = !lines;
    setLines(!lines);
    redrawRef.current();
    if (!lines && mapRef.current && !gridSpacing(mapRef.current.getZoom())) say("Zoom in to see the grid");
  };
  const setRuler = useCallback(
    (on: boolean) => {
      measuringRef.current = on;
      setMeasuring(on);
      setMeasured(on ? "Click the first point" : "");
      clearRulerRef.current();
      onMeasuring?.(on);
    },
    [onMeasuring],
  );
  const toggleMeasure = () => setRuler(!measuring);
  // Folded away, the ruler goes off too: it takes the map's clicks, so it is never on unseen [245].
  const toggleOpen = () => {
    if (open && measuring) setRuler(false);
    setOpen(!open);
  };

  // Esc ends the ruler, as it ends a page's other tools, and the key goes no further [245].
  useEffect(() => {
    if (!measuring) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setRuler(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [measuring, setRuler]);

  const go = (e: FormEvent) => {
    e.preventDefault();
    const map = mapRef.current;
    const g = readGrid(`grid ${goto}`, centre);
    if (!g || !map) return say("Not a grid. Try DQ 586 101.");
    onGo?.();
    map.flyTo({ center: [g.pin.lon, g.pin.lat], zoom: Math.max(map.getZoom(), 15) });
    (map.getSource("goto") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [g.pin.lon, g.pin.lat] } }] });
    say(`Grid ${g.text}`);
  };

  if (!grid) return null;
  const shown = !folded || open;
  return (
    <>
      <div ref={toolsRef} className={styles.tools} style={{ top }}>
        {folded ? (
          <div className={styles.row}>
            <button type="button" className={styles.btn} aria-expanded={open} onClick={toggleOpen} title="Grid lines, a ruler and go to a grid">
              Map tools <span aria-hidden="true">{open ? "▴" : "▾"}</span>
            </button>
          </div>
        ) : (
          <div className={styles.grid} title="MGRS grid of the point under the pointer, or of the map's centre">
            {grid}
          </div>
        )}
        {shown ? (
          <>
            <div className={styles.row}>
              <button type="button" className={styles.btn} aria-pressed={lines} onClick={toggleLines} title="Show the 1 km grid">
                {folded ? "Grid lines" : "Grid"}
              </button>
              <button type="button" className={styles.btn} aria-pressed={measuring} onClick={toggleMeasure} title="Distance and bearing between two points">
                Measure
              </button>
            </div>
            <form className={styles.row} onSubmit={go}>
              <input className={styles.input} value={goto} onChange={(e) => setGoto(e.target.value)} placeholder="Go to grid" aria-label="Go to grid" spellCheck={false} />
              <button type="submit" className={styles.btn}>
                Go
              </button>
            </form>
          </>
        ) : null}
        {measuring && measured ? <div className={styles.out}>{measured}</div> : null}
        {note ? (
          <div className={styles.out} role="status">
            {note}
          </div>
        ) : null}
      </div>
      {/* For the eye that follows the pointer, not for a screen reader: every position on the page has its grid in words. */}
      {folded && over ? (
        <div className={`${styles.grid} ${styles.edge}`} aria-hidden="true">
          {grid}
        </div>
      ) : null}
    </>
  );
}
