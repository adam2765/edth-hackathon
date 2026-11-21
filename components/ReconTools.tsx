"use client";

/**
 * The command post's controls for recon [234]: sending a friendly drone or drone team to look at a
 * track, ending that, and answering a unit's request for it. A person chooses every time. The app
 * lists the drones on the map and never ranks them: no distance, no nearest. The only drone free is
 * offered first, and is still sent only after a confirm.
 */
import { useState } from "react";
import { canLook, describeTrack, TRACK_KIND_NAME } from "@/lib/geo/trackKinds";
import type { RequestState, TrackState } from "@/lib/reports/fold";
import styles from "./CommandPost.module.css";

/** What the command post sends to `POST /api/sessions/<code>/tasks`. */
export type TaskBody = { action: "send"; asset: number; n: number; request: string | null } | { action: "done"; asset: number } | { action: "decline"; request: string };

/** The friendly drones and drone teams on the map, by number: what can be sent. */
export function dronesOf(tracks: TrackState[]): TrackState[] {
  return tracks.filter((t) => canLook(t) && t.gone == null);
}

const name = (t: TrackState) => `Track ${t.n}, ${describeTrack(t)}`;

/**
 * Picks a drone to send to a track, and asks once more. With no track named, the operator picks
 * the track too. With a request, it can also be turned down.
 */
export function SendDrone(props: {
  /** The track to look at; null when the request named none. */
  n: number | null;
  tracks: TrackState[];
  request: RequestState | null;
  busy: boolean;
  onTask: (body: TaskBody, done: string) => void;
  onCancel?: () => void;
}) {
  const drones = dronesOf(props.tracks);
  const free = drones.filter((d) => !d.task);
  const [target, setTarget] = useState<number | null>(props.n);
  const [confirm, setConfirm] = useState<{ action: "send"; drone: TrackState } | { action: "decline" } | null>(null);
  const targets = props.tracks.filter((t) => t.gone == null && !canLook(t));

  if (confirm) {
    const text =
      confirm.action === "decline"
        ? `Decline ${props.request?.callsign}’s request? Nothing is sent.`
        : confirm.drone.task && confirm.drone.task.n !== target
          ? `Track ${confirm.drone.n} is looking at Track ${confirm.drone.task.n}. Send it to Track ${target} instead?`
          : `Send ${name(confirm.drone)}, to look at Track ${target}?`;
    return (
      <div className={styles.confirm} role="group" aria-label="Confirm">
        <span className={styles.confirmText}>{text}</span>
        {confirm.action === "decline" ? (
          <button
            type="button"
            className={styles.dangerBtn}
            disabled={props.busy}
            onClick={() => {
              setConfirm(null);
              if (props.request) props.onTask({ action: "decline", request: props.request.id }, `Declined ${props.request.callsign}’s request`);
            }}
          >
            Decline
          </button>
        ) : (
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={props.busy || target == null}
            onClick={() => {
              setConfirm(null);
              if (target != null) props.onTask({ action: "send", asset: confirm.drone.n, n: target, request: props.request?.id ?? null }, `Sent Track ${confirm.drone.n} to look at Track ${target}`);
            }}
          >
            Send
          </button>
        )}
        <button type="button" className={styles.linkBtn} onClick={() => setConfirm(null)}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className={styles.heldActions}>
      {props.n == null ? (
        <select className={styles.giveSelect} value={target ?? ""} onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : null)} aria-label="The track to look at">
          <option value="">Which track?</option>
          {targets.map((t) => (
            <option key={t.n} value={t.n}>
              Track {t.n}: {describeTrack(t)}
            </option>
          ))}
        </select>
      ) : null}
      {drones.length === 0 ? <span className={styles.hint}>No friendly drone or drone team on the map. Place one with Place track.</span> : null}
      {drones.map((d) => {
        // The only free drone is offered first; two free, or none, and nothing is.
        const first = free.length === 1 && free[0].n === d.n;
        const where = d.task ? (d.task.n === target ? `on Track ${target} already` : `on Track ${d.task.n}`) : "free";
        // Every drone here is friendly, so the label leaves the word out to fit the tray.
        return (
          <button
            key={d.n}
            type="button"
            className={`${first ? styles.primaryBtn : styles.giveBtn} ${styles.droneBtn}`}
            disabled={props.busy || target == null || d.n === target || d.task?.n === target}
            onClick={() => setConfirm({ action: "send", drone: d })}
            aria-label={`Send Track ${d.n}, ${describeTrack(d)}, ${where}`}
          >
            Send Track {d.n} · {TRACK_KIND_NAME[d.kind].toLowerCase()} · {where}
          </button>
        );
      })}
      {props.request ? (
        <button type="button" className={styles.linkBtn} onClick={() => setConfirm({ action: "decline" })}>
          Not now
        </button>
      ) : null}
      {props.onCancel ? (
        <button type="button" className={styles.linkBtn} onClick={props.onCancel}>
          Cancel
        </button>
      ) : null}
    </div>
  );
}

/**
 * What the track card says about recon: the drone looking at this track, the track a drone is
 * looking at, requests waiting for it, and the buttons to send a drone or end its recon.
 */
export function TrackRecon(props: {
  track: TrackState;
  tracks: TrackState[];
  requests: RequestState[];
  canEdit: boolean;
  busy: boolean;
  fmt: (ts: number) => string;
  onTask: (body: TaskBody, done: string) => void;
}) {
  const t = props.track;
  const [sending, setSending] = useState(false);
  const [ending, setEnding] = useState(false);
  const asked = props.requests.filter((r) => r.n === t.n);
  const drone = canLook(t);
  const lines: string[] = [];
  for (const r of t.recon) lines.push(`Recon: Track ${r.asset} since ${props.fmt(r.ts)}`);
  if (drone && t.task) lines.push(`Looking at Track ${t.task.n} since ${props.fmt(t.task.ts)}`);
  for (const r of asked) lines.push(`Asked by ${r.callsign} at ${props.fmt(r.ts)}: “${r.words}”`);
  const canSend = props.canEdit && !drone && t.gone == null;
  const canEnd = props.canEdit && drone && !!t.task;
  if (!lines.length && !canSend && !canEnd) return null;
  return (
    <>
      {lines.map((l) => (
        <p key={l} className={styles.hint}>
          {l}
        </p>
      ))}
      {canEnd ? (
        ending ? (
          <div className={styles.confirm} role="group" aria-label={`End Track ${t.n}’s recon?`}>
            <span className={styles.confirmText}>Track {t.n} stops looking at Track {t.task!.n}?</span>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={props.busy}
              onClick={() => {
                setEnding(false);
                props.onTask({ action: "done", asset: t.n }, `Track ${t.n}: recon done`);
              }}
            >
              Recon done
            </button>
            <button type="button" className={styles.linkBtn} onClick={() => setEnding(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className={styles.draftButtons}>
            <button type="button" className={styles.ghostBtn} onClick={() => setEnding(true)} disabled={props.busy}>
              Recon done
            </button>
          </div>
        )
      ) : null}
      {canSend ? (
        sending ? (
          <SendDrone
            n={t.n}
            tracks={props.tracks}
            request={asked[0] ?? null}
            busy={props.busy}
            onTask={(body, done) => {
              setSending(false);
              props.onTask(body, done);
            }}
            onCancel={() => setSending(false)}
          />
        ) : (
          <div className={styles.draftButtons}>
            <button type="button" className={styles.ghostBtn} onClick={() => setSending(true)} disabled={props.busy}>
              Send drone…
            </button>
          </div>
        )
      ) : null}
    </>
  );
}
