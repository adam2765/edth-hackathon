"use client";

/**
 * The unit picked in the list: the same side panel as a track [271]. Info has where it is and how
 * long since it was heard; History has its events and earlier positions; Recon has what it is and
 * the task it was sent on. Placing it by hand stays at the bottom.
 */
import { useState } from "react";
import { shortGrid } from "@/lib/geo/grid";
import { TRACK_KIND_NAME } from "@/lib/geo/trackKinds";
import type { TrackKind } from "@/lib/geo/types";
import type { FeedItem, UnitState } from "@/lib/reports/fold";
import { UnitRecon, type TaskBody } from "./ReconTools";
import { GridTag } from "./TrackTools";
import styles from "./CommandPost.module.css";

export function UnitPanel(props: {
  unit: UnitState;
  status: { tag: string; text: string; tone: string };
  history: FeedItem[];
  format: (ts: number) => string;
  canEdit: boolean;
  busy: boolean;
  onClose: () => void;
  onPlace: () => void;
  onKind: (callsign: string, kind: TrackKind | null) => void;
  onTask: (body: TaskBody, done: string) => void;
  /** Opens the unit's question in the Decisions list, when one waits. */
  onQuestion?: () => void;
}) {
  const u = props.unit;
  const [tab, setTab] = useState<"info" | "history" | "recon">("info");
  const question = u.pending?.question ?? u.prompt?.question ?? null;
  const history = props.history.slice();
  const why = history.find((f) => f.position) ?? null;
  const when = props.format;
  return (
    <div className={styles.trackPanel} role="dialog" aria-label={`Unit ${u.callsign}`}>
      <div className={styles.timelinePanelHead}>
        <span className={styles.unitDot} style={{ background: u.colour }} aria-hidden="true" />
        <div className={styles.drawerTitle}>
          <h2>{u.callsign}</h2>
          <span>{u.kind ? TRACK_KIND_NAME[u.kind] : "Unit"}</span>
        </div>
        <span className={styles.pill} data-status={props.status.tone}>
          {props.status.tag}
        </span>
        <button autoFocus type="button" className={`${styles.linkBtn} ${styles.drawerClose}`} onClick={props.onClose}>
          Close
        </button>
      </div>
      <div className={styles.trackTabs} role="tablist" aria-label={`${u.callsign} details`}>
        {([
          ["info", "Info"],
          ["history", "History"],
          ["recon", "Recon"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`unit-${id}-tab`}
            aria-selected={tab === id}
            aria-controls={`unit-${id}`}
            onClick={() => setTab(id)}
          >
            {label}
            {id === "history" ? <span className={styles.provenanceCount}>{history.length}</span> : null}
          </button>
        ))}
      </div>
      <div className={styles.trackBody} role="tabpanel" id={`unit-${tab}`} aria-labelledby={`unit-${tab}-tab`}>
        {tab === "info" ? (
          <div className={styles.trackSection}>
            <p className={styles.hint}>
              {props.status.text}
              {u.position ? <GridTag at={u.position} /> : null}
            </p>
            {question ? (
              <>
                <p className={styles.provLine}>{question}</p>
                {props.onQuestion ? (
                  <div>
                    <button type="button" className={styles.primaryBtn} onClick={props.onQuestion}>
                      Answer in Decisions
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
            <p className={styles.provLine}>
              {u.lastHeard ? `Last heard ${when(u.lastHeard)}` : "Not heard yet"}
              {u.joined != null ? ` · joined ${when(u.joined)}` : ""}
              {u.placedBy ? ` · placed by ${u.placedBy}` : ""}
            </p>
            {why ? (
              <details className={styles.provenance}>
                <summary>Why here?</summary>
                <p className={styles.provLine}>
                  <b>{why.callsign}</b> · {when(why.ts)}
                </p>
                <p className={styles.provLine}>{why.transcript || why.outcome}</p>
                <p className={styles.provLine}>
                  <GridTag at={why.position} />
                </p>
              </details>
            ) : null}
          </div>
        ) : tab === "history" ? (
          <div className={styles.trackSection}>
            {u.trail.length ? (
              <div className={styles.provTrail}>
                <span className={styles.provMetaLabel}>Earlier positions ({u.trail.length})</span>
                <ol>
                  {u.trail
                    .slice()
                    .reverse()
                    .map((x) => (
                      <li key={`${x.ts}-${x.lat}-${x.lon}`}>
                        <span className={styles.provTime}>{when(x.ts)}</span>
                        <span className={styles.gridTag}>{shortGrid({ lat: x.lat, lon: x.lon })}</span>
                      </li>
                    ))}
                </ol>
              </div>
            ) : null}
            <span className={styles.provMetaLabel}>Events · newest first</span>
            {history.length ? (
              <ol className={styles.provListUnit}>
                {history.map((f) => (
                  <li key={f.id}>
                    <span className={styles.provTime}>{when(f.ts)}</span>
                    <span className={styles.provWhat}>{f.transcript || f.outcome}</span>
                    {f.position ? (
                      <span className={styles.provPlace}>
                        <GridTag at={f.position} />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.provLine}>Nothing heard from this unit yet.</p>
            )}
          </div>
        ) : (
          <div className={styles.trackSection}>
            <UnitRecon unit={u} canEdit={props.canEdit} busy={props.busy} fmt={props.format} onKind={props.onKind} onTask={props.onTask} />
          </div>
        )}
      </div>
      {props.canEdit ? (
        <div className={styles.toolFoot}>
          <div className={styles.draftButtons}>
            <button type="button" className={styles.ghostBtn} onClick={props.onPlace} disabled={props.busy}>
              {u.position && !u.atStart ? "Move" : "Place"} by hand
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
