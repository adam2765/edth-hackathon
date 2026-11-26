"use client";

/**
 * The replay bar's contents. The root div and its ref stay in CommandPost, because the map uses
 * them to keep the attribution clear; everything inside is grouped here so the bar does not take a
 * long list of props [276]. The markup and classes are the ones that were inline before.
 */
import { createContext, useContext, type ReactNode } from "react";
import { detents, keyTarget, settle, type Stretch } from "@/lib/reports/timeline";
import styles from "./CommandPost.module.css";

const SPEEDS = [1, 10, 30];
/** How close to a mission's start or end, in pixels on the bar, the replay is pulled onto it. */
const DETENT_PX = 8;
/** The bar's thumb, in CSS pixels: its middle runs from half this in from each end. */
const THUMB_PX = 16;

export interface CommandPostReplayBarModel {
  barShut: boolean;
  mapShort: boolean;
  hasEntries: boolean;
  replayOpen: boolean;
  playing: boolean;
  session: string | null;
  mode: "live" | "replay";
  ended: number | null;
  lost: boolean;
  now: number;
  replayT: number;
  rangeEnd: number;
  barLo: number;
  barHi: number;
  sliderValue: number;
  barSpan: number;
  barStretches: Stretch[];
  stretches: Stretch[];
  shownStretch: Stretch | null;
  sliderMission: Stretch | null;
  barZoom: boolean;
  speed: number;
  fmtTime: (ts: number) => string;
  fmtSpan: (ms: number) => string;
  onShowBar: () => void;
  onHideBar: () => void;
  onToggleReplay: () => void;
  onLive: () => void;
  onTogglePlay: () => void;
  onScrub: (t: number) => void;
  onZoom: () => void;
  onSpeed: (speed: number) => void;
  onCopy: () => void;
}

const ReplayBarContext = createContext<CommandPostReplayBarModel | null>(null);

export function CommandPostReplayBarProvider({ value, children }: { value: CommandPostReplayBarModel; children: ReactNode }) {
  return <ReplayBarContext.Provider value={value}>{children}</ReplayBarContext.Provider>;
}

export function CommandPostReplayBar() {
  const m = useContext(ReplayBarContext);
  if (!m) throw new Error("CommandPostReplayBar needs CommandPostReplayBarProvider.");
  const barPct = (t: number) => (m.barSpan > 0 ? ((t - m.barLo) / m.barSpan) * 100 : 0);

  return (
    <>
      {m.barShut ? (
        <button type="button" className={styles.liveBtn} disabled={m.mapShort} onClick={m.onShowBar} title={m.mapShort ? "Enlarge the map to show the replay bar" : m.hasEntries ? "Open the replay" : "Nothing to replay yet"} aria-label="Show the replay bar">
          Replay <span aria-hidden="true">▴</span>
        </button>
      ) : (
        <>
          <button type="button" className={styles.barToggle} onClick={m.onHideBar} title="Hide the replay bar, to see the map" aria-label="Hide the replay bar">
            <span aria-hidden="true">▾</span>
          </button>
          <button type="button" className={`${styles.liveBtn} ${styles.replayClose}`} aria-expanded={m.replayOpen} disabled={!m.hasEntries} title={!m.hasEntries ? "Nothing to replay yet: no report, track or unit placed in this mission" : m.replayOpen ? "Back to the live view and close the replay" : "Read this mission from its log, from a moment you choose"} onClick={m.onToggleReplay}>{m.replayOpen ? "Close replay" : "Replay"}</button>
          {m.replayOpen ? <>
            <button
              type="button"
              className={`${styles.liveBtn} ${styles.replayLive}`}
              aria-pressed={m.mode === "live" && !!m.session}
              disabled={!m.session}
              data-stale={m.ended != null ? "ended" : m.lost ? "lost" : undefined}
              onClick={m.onLive}
              title={m.ended != null ? "Show the mission as it ended" : "Show the present and follow the units"}
            >
              <span className={styles.liveDot} aria-hidden="true" /> {m.ended != null ? "At end" : "Live"}
            </button>
            <button
              type="button"
              className={styles.playBtn}
              onClick={m.onTogglePlay}
              disabled={!m.stretches.length}
              aria-label={m.playing ? "Pause replay" : "Play replay"}
              title={m.playing ? "Pause the replay" : "Replay from the start of this mission"}
            >
              {m.playing ? "❚❚" : "▶"}
            </button>
            {/* The day's missions in this area: a stretch for each, gray where none was running, and
                a detent at every start and end. The replay never rests in the gray. */}
            <div className={styles.timeline}>
              <div className={styles.rail} aria-hidden="true">
                {m.barStretches.map((s) => (
                  <span
                    key={s.code}
                    className={styles.stretch}
                    data-shown={s.code === m.session ? "" : undefined}
                    style={{ left: `${barPct(s.start)}%`, width: `${barPct(s.end) - barPct(s.start)}%` }}
                  />
                ))}
                {detents(m.barStretches).map((d) => (
                  <span key={d} className={styles.detent} style={{ left: `${barPct(d)}%` }} />
                ))}
              </div>
              <input
                className={styles.slider}
                type="range"
                min={m.barLo}
                max={m.barHi}
                step="any"
                value={m.sliderValue}
                disabled={!m.stretches.length}
                onChange={(e) => {
                  // A start or end within a few pixels pulls the replay onto it.
                  const width = e.currentTarget.getBoundingClientRect().width - THUMB_PX;
                  const pull = width > 0 ? (m.barSpan * DETENT_PX) / width : 0;
                  m.onScrub(Math.round(settle(m.barStretches, Number(e.currentTarget.value), pull)));
                }}
                onKeyDown={(e) => {
                  const to = keyTarget(m.barStretches, m.sliderValue, e.key);
                  if (to == null) return;
                  e.preventDefault();
                  m.onScrub(to);
                }}
                aria-label="Replay time"
                title="The day's missions in this area; gray where none was running. Page Up and Page Down jump between starts and ends."
                // No time before the first entry: the server's locale would not match the browser's.
                aria-valuetext={m.stretches.length ? `${m.fmtTime(m.sliderValue)}${m.sliderMission ? `, ${m.sliderMission.name}` : ""}` : undefined}
              />
            </div>
            <div className={styles.time}>
              {m.mode === "replay" ? (
                <>
                  {m.fmtTime(m.replayT)} <span className={styles.muted}>{m.fmtSpan(Math.max(0, (m.shownStretch?.end ?? m.rangeEnd) - m.replayT))} left</span>
                </>
              ) : m.ended != null ? (
                <>Ended · {m.fmtTime(m.ended)}</>
              ) : !m.session ? (
                // No mission on screen, so nothing is live: only the clock.
                <>{m.now ? m.fmtTime(m.now) : ""}</>
              ) : (
                <>
                  {m.lost ? "No contact" : "Live"}
                  {m.now ? ` · ${m.fmtTime(m.now)}` : ""}
                </>
              )}
            </div>
            <div className={styles.replayExtra}>
              {m.shownStretch ? (
                <button
                  type="button"
                  className={styles.liveBtn}
                  aria-pressed={m.barZoom}
                  onClick={m.onZoom}
                  title={m.barZoom ? "Show the whole day again" : "Zoom the bar onto this mission"}
                >
                  {m.barZoom ? "Day" : "Mission"}
                </button>
              ) : null}
              {m.mode === "replay" ? (
                <button type="button" className={styles.liveBtn} onClick={m.onCopy} title="Copy a link to this moment">
                  Link
                </button>
              ) : null}
              <div className={styles.segmentedSmall} role="group" aria-label="Replay speed" title="Replay speed">
                {SPEEDS.map((s) => (
                  <button key={s} type="button" aria-pressed={m.speed === s} onClick={() => m.onSpeed(s)}>
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
                {m.shownStretch ? (
                  <button
                    type="button"
                    className={styles.liveBtn}
                    aria-pressed={m.barZoom}
                    onClick={m.onZoom}
                    title={m.barZoom ? "Show the whole day again" : "Zoom the bar onto this mission"}
                  >
                    {m.barZoom ? "Day" : "Mission"}
                  </button>
                ) : null}
                {m.mode === "replay" ? (
                  <button type="button" className={styles.liveBtn} onClick={m.onCopy} title="Copy a link to this moment">
                    Link
                  </button>
                ) : null}
                <div className={styles.segmentedSmall} role="group" aria-label="Replay speed" title="Replay speed">
                  {SPEEDS.map((s) => (
                    <button key={s} type="button" aria-pressed={m.speed === s} onClick={() => m.onSpeed(s)}>
                      {s}×
                    </button>
                  ))}
                </div>
              </div>
            </details>
          </> : <div className={styles.time}>{m.lost ? "No contact" : m.ended != null ? "Mission ended" : "Live"}</div>}
        </>
      )}
    </>
  );
}
