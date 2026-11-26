"use client";

/**
 * The command post's MapLibre instance: the element, the refs, the base map, the photo layers,
 * the resize and click wiring, and the readiness flags. The layers that hold the units and tracks
 * are still drawn by CommandPost [276].
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExpressionSpecification, Map as MLMap, MapMouseEvent } from "maplibre-gl";
import { AREAS, DEFAULT_AREA } from "@/lib/geo/areas";
import { AFFILIATION_COLOUR } from "@/lib/geo/trackKinds";
import { loadBaseMap } from "@/lib/map/baseMap";
import { addSatelliteLayers, setSatelliteVisible } from "@/lib/map/satellite";

export const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function useMap({ onUserMove }: { onUserMove: () => void }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [mapSlow, setMapSlow] = useState(false);
  const [mapSize, setMapSize] = useState("");
  const [zoomKey, setZoomKey] = useState(0);
  const mapClick = useRef<(e: MapMouseEvent) => void>(() => {});
  const measuring = useRef(false);
  const setMeasuring = useCallback((on: boolean) => {
    measuring.current = on;
  }, []);
  const setMapClick = useCallback((fn: (e: MapMouseEvent) => void) => {
    mapClick.current = fn;
  }, []);

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
        if ((e as { originalEvent?: Event }).originalEvent) onUserMove();
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
  }, [onUserMove]);

  // The photo view follows the button. The layers were added with the map's own, so showing them
  // only changes their visibility [260].
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    setSatelliteVisible(map, satellite);
  }, [satellite, mapReady]);


  useEffect(() => {
    if (mapReady) return;
    const t = setTimeout(() => setMapSlow(true), 12_000);
    return () => clearTimeout(t);
  }, [mapReady]);

  return {
    mapEl,
    mapRef,
    mlRef,
    mapReady,
    mapSlow,
    mapSize,
    satellite,
    setSatellite,
    zoomKey,
    mapClick,
    measuring,
    setMeasuring,
    setMapClick,
  };
}
