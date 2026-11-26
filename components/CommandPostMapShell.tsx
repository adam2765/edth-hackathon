"use client";

/**
 * The shell of the command post's map: the map element, its grid tools, and the overlays as
 * children. The MapLibre instance, its effects and every overlay still live in CommandPost; this
 * only holds the markup and the refs [276]. The markup and classes are the ones that were inline.
 */
import type { ReactNode, RefObject } from "react";
import type { Map as MLMap } from "maplibre-gl";
import type { LatLon } from "@/lib/geo/geo";
import MapTools from "./MapTools";
import styles from "./CommandPost.module.css";

interface Props {
  mapEl: RefObject<HTMLDivElement | null>;
  mapRef: RefObject<MLMap | null>;
  ready: boolean;
  centre: LatLon;
  covered: () => number;
  scale: number;
  timelineOpen: boolean;
  panelOpen: boolean;
  onMeasuring: (on: boolean) => void;
  onGo: () => void;
  children: ReactNode;
}

export function CommandPostMapShell({ mapEl, mapRef, ready, centre, covered, scale, timelineOpen, panelOpen, onMeasuring, onGo, children }: Props) {
  return (
    <main className={styles.mapCol} data-drawer={timelineOpen ? "" : undefined} data-panel={panelOpen ? "" : undefined}>
      <div ref={mapEl} className={styles.map} aria-label="Map of all units and tracks" />
      {/* The grid's lines, a ruler and "go to grid", behind one button, and the grid under the
          pointer at the map's edge [232, 245]. A click here already places or picks, so it copies
          nothing; while the ruler is on, a click only measures. Going to a grid stops following. */}
      <MapTools
        mapRef={mapRef}
        ready={ready}
        centre={centre}
        below="start-fill"
        top="calc(90px / var(--z))"
        right="calc(60px / var(--z))"
        covered={covered}
        onMeasuring={onMeasuring}
        scale={scale}
        folded
        onGo={onGo}
      />
      {children}
    </main>
  );
}
