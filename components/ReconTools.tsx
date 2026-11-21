"use client";

/**
 * The command post's controls for recon [234]: sending a friendly drone or drone team to look at a
 * track, ending that, and answering a unit's request for it. A person chooses every time. The app
 * lists what can be sent and never ranks it: no distance, no nearest. The only one free is offered
 * first, and is still sent only after a confirm.
 *
 * What can be sent [235]: a friendly drone or drone-team track on the map, or a unit on the net that
 * a person at the command post said is a drone or drone team. Never one read from its call sign.
 */
import { useState } from "react";
import { canLook, describeTrack, RECON_KINDS, TRACK_KIND_NAME, TRACK_KINDS } from "@/lib/geo/trackKinds";
import type { TrackKind } from "@/lib/geo/types";
import { unitKindWord, type RequestState, type TrackState, type UnitState } from "@/lib/reports/fold";
import styles from "./CommandPost.module.css";

/** The drone a task names: a track by its number, or a unit by its call sign [235]. */
export type DroneRef = { asset: number } | { unit: string };

/** What the command post sends to `POST /api/sessions/<code>/tasks`. */
export type TaskBody = ({ action: "send"; n: number; request: string | null } & DroneRef) | ({ action: "done" } & DroneRef) | { action: "decline"; request: string };

/** Something the command post can send to look, a drone track or a drone unit, in one shape. */
export interface Looker {
  key: string;
  ref: DroneRef;
  /** "Track 3" or "BRAVO 2". */
  label: string;
  /** "Track 3, friendly drone team" or "BRAVO 2, drone team". */
  long: string;
  kind: TrackKind;
  task: { n: number; ts: number } | null;
  /** Its own track number, for a track: it cannot look at itself. */
  self: number | null;
}

/** What can be sent, in list order: drone tracks on the map, then drone units on the net [235]. */
export function lookersOf(tracks: TrackState[], units: UnitState[]): Looker[] {
  const out: Looker[] = [];
  for (const t of tracks) {
    if (canLook(t) && t.gone == null) out.push({ key: `track-${t.n}`, ref: { asset: t.n }, label: `Track ${t.n}`, long: `Track ${t.n}, ${describeTrack(t)}`, kind: t.kind, task: t.task, self: t.n });
  }
  for (const u of units) {
    if (u.kind && RECON_KINDS.includes(u.kind)) out.push({ key: `unit-${u.callsign}`, ref: { unit: u.callsign }, label: u.callsign, long: `${u.callsign}, ${unitKindWord(u.kind)}`, kind: u.kind, task: u.task, self: null });
  }
  return out;
}

/**
 * Picks a drone to send to a track, and asks once more. With no track named, the operator picks
 * the track too. With a request, it can also be turned down.
 */
export function SendDrone(props: {
  /** The track to look at; null when the request named none. */
  n: number | null;
  tracks: TrackState[];
  units: UnitState[];
  request: RequestState | null;
  busy: boolean;
  onTask: (body: TaskBody, done: string) => void;
  onCancel?: () => void;
}) {
  const lookers = lookersOf(props.tracks, props.units);
  const free = lookers.filter((d) => !d.task);
  const [target, setTarget] = useState<number | null>(props.n);
  const [confirm, setConfirm] = useState<{ action: "send"; drone: Looker } | { action: "decline" } | null>(null);
  const targets = props.tracks.filter((t) => t.gone == null && !canLook(t));

  if (confirm) {
    const text =
      confirm.action === "decline"
        ? `Decline ${props.request?.callsign}’s request? Nothing is sent.`
        : confirm.drone.task && confirm.drone.task.n !== target
          ? `${confirm.drone.label} is looking at Track ${confirm.drone.task.n}. Send it to Track ${target} instead?`
          : `Send ${confirm.drone.long}, to look at Track ${target}?`;
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
              if (target != null) props.onTask({ action: "send", ...confirm.drone.ref, n: target, request: props.request?.id ?? null }, `Sent ${confirm.drone.label} to look at Track ${target}`);
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
      {lookers.length === 0 ? <span className={styles.hint}>No friendly drone or drone team. Place one with Place track, or say under Units that a unit is one.</span> : null}
      {lookers.map((d) => {
        // The only free drone is offered first; two free, or none, and nothing is.
        const first = free.length === 1 && free[0].key === d.key;
        const where = d.task ? (d.task.n === target ? `on Track ${target} already` : `on Track ${d.task.n}`) : "free";
        // Every drone here is friendly, so the label leaves the word out to fit the tray.
        return (
          <button
            key={d.key}
            type="button"
            className={`${first ? styles.primaryBtn : styles.giveBtn} ${styles.droneBtn}`}
            disabled={props.busy || target == null || d.self === target || d.task?.n === target}
            onClick={() => setConfirm({ action: "send", drone: d })}
            aria-label={`Send ${d.long}, ${where}`}
          >
            Send {d.label} · {unitKindWord(d.kind)} · {where}
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

/** "Recon done" with a confirm: only a person ends a task [234]. */
function EndRecon(props: { label: string; n: number; busy: boolean; onDone: () => void }) {
  const [ending, setEnding] = useState(false);
  if (!ending) {
    return (
      <button type="button" className={styles.ghostBtn} onClick={() => setEnding(true)} disabled={props.busy}>
        Recon done
      </button>
    );
  }
  return (
    <div className={styles.confirm} role="group" aria-label={`End ${props.label}’s recon?`}>
      <span className={styles.confirmText}>
        {props.label} stops looking at Track {props.n}?
      </span>
      <button
        type="button"
        className={styles.primaryBtn}
        disabled={props.busy}
        onClick={() => {
          setEnding(false);
          props.onDone();
        }}
      >
        Recon done
      </button>
      <button type="button" className={styles.linkBtn} onClick={() => setEnding(false)}>
        Cancel
      </button>
    </div>
  );
}

/**
 * What the track card says about recon: what is looking at this track, the track a drone is
 * looking at, requests waiting for it, and the buttons to send a drone or end its recon.
 */
export function TrackRecon(props: {
  track: TrackState;
  tracks: TrackState[];
  units: UnitState[];
  requests: RequestState[];
  canEdit: boolean;
  busy: boolean;
  fmt: (ts: number) => string;
  onTask: (body: TaskBody, done: string) => void;
}) {
  const t = props.track;
  const [sending, setSending] = useState(false);
  const asked = props.requests.filter((r) => r.n === t.n);
  const drone = canLook(t);
  const lines: string[] = [];
  for (const r of t.recon) lines.push(`Recon: ${r.asset != null ? `Track ${r.asset}` : r.unit} since ${props.fmt(r.ts)}`);
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
        <div className={styles.draftButtons}>
          <EndRecon label={`Track ${t.n}`} n={t.task!.n} busy={props.busy} onDone={() => props.onTask({ action: "done", asset: t.n }, `Track ${t.n}: recon done`)} />
        </div>
      ) : null}
      {canSend ? (
        sending ? (
          <SendDrone
            n={t.n}
            tracks={props.tracks}
            units={props.units}
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

/**
 * Under a unit in the list [235]: what it is, as a person at the command post said, and its recon
 * when it is a drone team sent to look at a track. Nothing reads the kind from the call sign. While
 * it is looking, it stays a drone or drone team: changing what it is does not end a task.
 */
export function UnitRecon(props: {
  unit: UnitState;
  canEdit: boolean;
  busy: boolean;
  fmt: (ts: number) => string;
  onKind: (callsign: string, kind: TrackKind | null) => void;
  onTask: (body: TaskBody, done: string) => void;
}) {
  const u = props.unit;
  const looking = u.task ? `Looking at Track ${u.task.n} since ${props.fmt(u.task.ts)}` : null;
  if (!props.canEdit) {
    const said = [u.kind ? TRACK_KIND_NAME[u.kind] : null, looking].filter(Boolean).join(" · ");
    return said ? <p className={styles.unitRecon}>{said}</p> : null;
  }
  return (
    <div className={styles.unitRecon}>
      <select
        className={styles.unitKind}
        value={u.kind ?? ""}
        disabled={props.busy}
        aria-label={`What ${u.callsign} is`}
        onChange={(e) => props.onKind(u.callsign, (e.target.value || null) as TrackKind | null)}
      >
        <option value="" disabled={!!u.task}>
          What is it?
        </option>
        {TRACK_KINDS.map((k) => (
          <option key={k} value={k} disabled={!!u.task && !RECON_KINDS.includes(k)}>
            {TRACK_KIND_NAME[k]}
          </option>
        ))}
      </select>
      {looking ? <span className={styles.hint}>{looking}</span> : null}
      {u.task ? <EndRecon label={u.callsign} n={u.task.n} busy={props.busy} onDone={() => props.onTask({ action: "done", unit: u.callsign }, `${u.callsign}: recon done`)} /> : null}
    </div>
  );
}
