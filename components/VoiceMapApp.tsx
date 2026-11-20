"use client";

import { useEffect, useRef } from "react";
import type { Map as MLMap } from "maplibre-gl";

const CENTER: [number, number] = [2.435, 48.8455]; // lon, lat: Vincennes centre
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export default function VoiceMapApp() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !mapEl.current) return;
      ml.setWorkerUrl("/maplibre-gl-worker.mjs");
      const map = new ml.Map({
        container: mapEl.current,
        style: STYLE_URL,
        center: CENTER,
        zoom: 14.5,
        attributionControl: { compact: false },
      });
      map.addControl(new ml.NavigationControl({ showCompass: true }), "top-right");
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <main className="app">
      <div ref={mapEl} className="map" />
      <section className="sheet">
        <div className="status">Voice-to-Map · stage 1</div>
      </section>
    </main>
  );
}
