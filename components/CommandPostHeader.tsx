"use client";

/**
 * The command post's header: the mission name and its state, Place track, Timeline, Find,
 * Missions and the More menu (Copy situation, Keys and clicks, Stop mission). The state and the
 * callbacks stay in CommandPost; they are grouped here so the header does not take a long list of
 * props [276]. The markup and the classes are the ones that were inline before.
 */
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { AreaId } from "@/lib/geo/areas";
import type { MissionState } from "@/lib/reports/fold";
import { DEMO_SESSION } from "@/lib/reports/types";
import MissionPanel from "./MissionPanel";
import styles from "./CommandPost.module.css";

export interface CommandPostHeaderModel {
  mission: MissionState | null;
  session: string | null;
  ended: number | null;
  mode: "live" | "replay";
  lost: boolean;
  connected: boolean;
  stored: boolean | null;
  demo: boolean;
  canEdit: boolean;
  placing: boolean;
  actionError: string | null;
  panelOpen: boolean;
  moreOpen: boolean;
  confirmEnd: boolean;
  now: number;
  defaultArea: AreaId;
  onStartPlace: () => void;
  onOpenMissions: () => void;
  onToggleMissions: () => void;
  onOpenTimeline: () => void;
  onOpenFind: () => void;
  onToggleMore: () => void;
  onCloseMore: () => void;
  onCopySituation: () => void;
  onOpenHelp: () => void;
  onStopMission: () => void;
  onConfirmStop: () => void;
  onCancelStop: () => void;
  onCloseMissions: () => void;
  onPickMission: (code: string | null) => void;
  fmtWhen: (ts: number, now: number) => string;
}

const HeaderContext = createContext<CommandPostHeaderModel | null>(null);

export function CommandPostHeaderProvider({ value, children }: { value: CommandPostHeaderModel; children: ReactNode }) {
  return <HeaderContext.Provider value={value}>{children}</HeaderContext.Provider>;
}

export function CommandPostHeader() {
  const m = useContext(HeaderContext);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreOpen = m?.moreOpen ?? false;
  const closeMore = m?.onCloseMore;

  // The More menu closes on a pointer outside it, as it did inline in CommandPost [274].
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      const el = moreRef.current;
      if (el && !el.contains(e.target as Node)) closeMore?.();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [moreOpen, closeMore]);

  if (!m) throw new Error("CommandPostHeader needs CommandPostHeaderProvider.");
  const { mission, session, ended, mode, lost, connected, stored, demo, canEdit, placing } = m;

  return (
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
              Ended {m.fmtWhen(ended, m.now)}
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
          className={placing ? styles.primaryBtn : styles.ghostBtn}
          aria-pressed={placing}
          onClick={m.onStartPlace}
          title="Place a track by hand: friend, foe or unknown (P)"
        >
          Place track
        </button>
      ) : null}
      {m.actionError ? (
        <span className={styles.error} role="alert">
          {m.actionError}
        </span>
      ) : null}
      {/* The connection, the drawers and the missions menu wrap together, not one by one [271]. */}
      <div className={styles.headActions}>
        {!mission || ended != null ? <button type="button" className={styles.ghostBtn} onClick={m.onOpenMissions}>Start mission</button> : null}
        {!mission && session !== DEMO_SESSION ? (
          <button type="button" className={styles.ghostBtn} onClick={() => m.onPickMission(DEMO_SESSION)} title="Open the recorded mission: four units, three tracks and a question asked back">
            Demo
          </button>
        ) : null}
        <button type="button" className={styles.ghostBtn} onClick={m.onOpenTimeline} title="The mission's events, newest first; choose one to replay it">
          Timeline
        </button>
        <button type="button" className={styles.ghostBtn} onClick={m.onOpenFind} title="Find a call sign, a track or a place (Ctrl+K)">
          Find
        </button>
        <button type="button" className={styles.menuBtn} aria-expanded={m.panelOpen} aria-haspopup="dialog" onClick={m.onToggleMissions}>
          Missions ▾
        </button>
        <div className={styles.headerMore} ref={moreRef}>
          <button
            type="button"
            className={styles.ghostBtn}
            aria-expanded={m.moreOpen}
            aria-haspopup="menu"
            aria-label="More actions"
            title="Brief, help and stop"
            onClick={m.onToggleMore}
          >
            <span aria-hidden="true">…</span>
          </button>
          {m.moreOpen ? (
            <div className={styles.headerMorePanel} role="menu" aria-label="More actions">
              <button
                type="button"
                role="menuitem"
                className={styles.headerMoreItem}
                onClick={() => {
                  m.onCloseMore();
                  m.onCopySituation();
                }}
              >
                Copy situation
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.headerMoreItem}
                onClick={() => {
                  m.onCloseMore();
                  m.onOpenHelp();
                }}
              >
                Keys and clicks
              </button>
              {mission && ended == null && !demo ? (
                m.confirmEnd ? (
                  <div className={styles.headerMoreConfirm}>
                    <span>Stop this mission? Reports stop. It stays here for replay.</span>
                    <div className={styles.headerMoreButtons}>
                      <button
                        type="button"
                        className={styles.dangerBtn}
                        onClick={() => {
                          m.onCloseMore();
                          m.onStopMission();
                        }}
                      >
                        Stop mission
                      </button>
                      <button
                        type="button"
                        className={styles.linkBtn}
                        onClick={m.onCancelStop}
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
                    onClick={m.onConfirmStop}
                  >
                    Stop mission
                  </button>
                )
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {m.panelOpen ? <MissionPanel current={session} defaultArea={m.defaultArea} onPick={m.onPickMission} onClose={m.onCloseMissions} /> : null}
    </header>
  );
}
