"use client";

/**
 * The command post's Decisions list [240]: everything that waits on the operator, oldest first, in
 * one place. On a radio net the operator is the one who asks back and answers [208], so this is
 * where they spend their time: one decision open at a time, the rest one line each, and keys for
 * all of it (CommandPost.tsx listens for them). Nothing is saved without a confirm.
 */
import { useEffect, useRef, useState } from "react";
import { describeTrack } from "@/lib/geo/trackKinds";
import { optionsOf, type Decision, type DecisionOption } from "@/lib/reports/decisions";
import type { TrackState, UnitState } from "@/lib/reports/fold";
import { callsignGiven, callsignOf, type HeldReason } from "@/lib/reports/types";
import { SendDrone, type TaskBody } from "./ReconTools";
import styles from "./CommandPost.module.css";

/** Why a radio report waits, as one word on its pill [203]. */
const HELD_TAG: Record<HeldReason, string> = { which: "Which unit?", unknown: "Not on roster", none: "No call sign", far: "Too far" };

/** A decision that has waited this long is marked late, in words and colour. */
export const LATE_AFTER_MS = 2 * 60_000;

/** "12 s", "3:05" or "1 h 07": how long a decision has waited. */
function fmtWait(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}

/**
 * The answer heard for a question, when the coordinator read one from the unit's words [245]:
 * the words without their last full stop, and the choice with its kind, since two choices can
 * have one name ("Château de Vincennes (metro station)").
 */
function heardOf(d: Decision): { ts: number; choice: string; n: number; said: string; what: string } | null {
  const h = d.kind === "question" ? d.item.heard : undefined;
  if (!h || d.kind !== "question") return null;
  const c = d.item.candidates.find((x) => x.id === h.choice);
  const what = c ? `${h.name}${c.town ? ` (${c.town})` : ""} (${c.category.replace("_", " ")})` : h.name;
  return { ts: h.ts, choice: h.choice, n: h.n, said: h.words.replace(/[\s.!?…]+$/u, ""), what };
}

function tagOf(d: Decision): string {
  switch (d.kind) {
    case "question":
      if (d.item.heard) return `Heard: ${d.item.heard.n}`;
      return d.item.track != null ? `Track ${d.item.track}: which?` : "Which one?";
    case "prompt":
      return "No choices";
    case "held":
      return HELD_TAG[d.held.reason];
    case "request":
      return "Recon";
  }
}

/** The same, short, for a line in the list: the words of the question need the room. */
function shortTagOf(d: Decision): string {
  switch (d.kind) {
    case "question":
      // An answer was heard: it only needs the confirm.
      if (d.item.heard) return `Heard ${d.item.heard.n}`;
      return d.item.track != null ? `T${d.item.track}?` : "Which?";
    case "prompt":
      return "Ask";
    case "held":
      return "Unit?";
    case "request":
      return "Recon";
  }
}

/** The one line a decision shows when it is not the open one. */
function lineOf(d: Decision): string {
  switch (d.kind) {
    case "question":
      if (d.item.heard) return `“${heardOf(d)!.said}”: choice ${d.item.heard.n}. Confirm it.`;
      return d.item.question ?? d.item.outcome;
    case "prompt":
      return d.item.question ?? d.item.outcome;
    case "held":
      return d.held.transcript ? `“${d.held.transcript}”` : "(no words heard)";
    case "request":
      return `“${d.request.words}”`;
  }
}

function whoOf(d: Decision): string {
  if (d.kind !== "held") return d.callsign;
  return d.held.heard ? `“${d.held.heard}”` : "Radio";
}

/** What an option's button says. */
function optionLabel(o: DecisionOption): string {
  switch (o.kind) {
    case "choice":
      return o.choice ? o.name : "None of these";
    case "close":
      return "Close it";
    case "held":
      return o.action === "dismiss" ? "Dismiss" : o.action === "add" ? `Add ${o.callsign} and give it` : `Give to ${o.callsign}`;
  }
}

/** The confirm, asked once more before anything is saved. */
function confirmOf(o: DecisionOption, d: Decision): { text: string; label: string; danger: boolean } {
  const who = d.callsign ?? "";
  const heard = heardOf(d);
  switch (o.kind) {
    case "choice":
      // The choice the unit was heard to say: the confirm shows its words, so the operator checks them.
      if (o.choice && heard?.choice === o.choice) return { text: `${who} said “${heard.said}”. Choose ${heard.n}, ${heard.what}?`, label: "Choose", danger: false };
      return o.choice
        ? { text: `Choose ${o.name} for ${who}?`, label: "Choose", danger: false }
        : { text: `None of these, for ${who}? The question closes and nothing moves.`, label: "None of these", danger: false };
    case "close":
      return { text: `Close ${who}’s question? Nothing moves. Ask by radio first if you need the place.`, label: "Close", danger: false };
    case "held": {
      if (o.action === "dismiss") return { text: "Dismiss this report? Nothing moves.", label: "Dismiss", danger: true };
      if (o.action === "add") return { text: `Add ${o.callsign} to the roster and give it this report?`, label: "Add and give", danger: false };
      return { text: `Give this report to ${o.callsign}? Its words are read again from where ${o.callsign} was when it came in.`, label: "Give", danger: false };
    }
  }
}

function sameOption(a: DecisionOption | null, b: DecisionOption): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "choice" && b.kind === "choice") return a.choice === b.choice;
  if (a.kind === "held" && b.kind === "held") return a.action === b.action && a.callsign === b.callsign;
  return true;
}

export default function DecisionQueue(props: {
  decisions: Decision[];
  focused: Decision | null;
  /** The option picked in the open decision, waiting for its confirm. */
  selection: DecisionOption | null;
  /** The pick is the answer the coordinator heard, not the operator's own [245]. */
  heardPick?: boolean;
  roster: string[];
  tracks: TrackState[];
  units: UnitState[];
  session: string | null;
  /** A live mission this coordinator keeps: false in a replay, at the end, or with no record. */
  canEdit: boolean;
  busy: boolean;
  /** The time the page shows: now, the mission's end, or the replay's moment. */
  now: number;
  fmtTime: (ts: number) => string;
  onFocus: (d: Decision) => void;
  onSelect: (o: DecisionOption | null) => void;
  onConfirm: () => void;
  onTask: (body: TaskBody, done: string) => void;
  onTrack: (n: number) => void;
}) {
  const { decisions, focused, selection, canEdit, busy, now, fmtTime } = props;
  const openRef = useRef<HTMLLIElement>(null);
  /** A call sign the operator types for a held report, when the words gave none [203]. */
  const [typed, setTyped] = useState<{ held: string; text: string }>({ held: "", text: "" });

  const confirmRef = useRef<HTMLDivElement>(null);
  // Keep the open decision in view when the keys move it down the list.
  useEffect(() => {
    openRef.current?.scrollIntoView({ block: "nearest" });
  }, [focused?.id]);
  // A pick: the confirm button takes the cursor, so Enter confirms after a click as after a key. The
  // whole card stays in view when it fits, and the confirm row always does.
  const heardPick = props.heardPick === true;
  useEffect(() => {
    if (!selection) return;
    // An answer heard arrives by itself: it does not take the cursor out of a field being typed in.
    const at = document.activeElement;
    if (heardPick && at instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName)) return;
    confirmRef.current?.querySelector("button")?.focus({ preventScroll: true });
    openRef.current?.scrollIntoView({ block: "nearest" });
    confirmRef.current?.scrollIntoView({ block: "nearest" });
  }, [selection, heardPick]);

  return (
    <section className={`${styles.section} ${styles.decisionSection}`} aria-labelledby="decisions-h">
      <h2 id="decisions-h" className={styles.h2}>
        Decisions <span className={styles.count} data-waiting={decisions.length ? "" : undefined}>{decisions.length}</span>
        {canEdit && decisions.length ? (
          // The keys for each option are on its button; these are the rest.
          <span className={styles.keysHint} title="Keys: ↑ ↓ or J K to move, 1 to 9 to pick, N for none, Enter to confirm, Esc to step back">
            <kbd>↑</kbd>
            <kbd>↓</kbd> move · <kbd>Enter</kbd> confirm
          </span>
        ) : null}
      </h2>
      {decisions.length === 0 ? (
        <p className={styles.empty}>Nothing waits for you. Questions, radio reports the coordinator is not sure of and requests for recon come here, oldest first.</p>
      ) : (
        <ol className={styles.decisions}>
          {decisions.map((d) => {
            const wait = now - d.ts;
            const late = wait >= LATE_AFTER_MS || undefined;
            if (d.id !== focused?.id) {
              return (
                <li key={d.id}>
                  <button type="button" className={styles.decisionRow} data-new={wait < 4000 || undefined} onClick={() => props.onFocus(d)}>
                    <span className={styles.wait} data-late={late}>
                      {fmtWait(wait)}
                    </span>
                    <span className={styles.itemCall}>
                      {d.colour ? <span className={styles.itemDot} style={{ background: d.colour }} aria-hidden="true" /> : null}
                      {whoOf(d)}
                    </span>
                    <span className={styles.pill} data-status="ask" title={tagOf(d)}>
                      {shortTagOf(d)}
                    </span>
                    <span className={styles.decisionLine}>{lineOf(d)}</span>
                  </button>
                </li>
              );
            }
            const { numbered, drop } = optionsOf(d, props.roster);
            const picked = selection;
            const confirm = picked ? confirmOf(picked, d) : null;
            const transcript = d.kind === "held" ? d.held.transcript : d.kind === "request" ? d.request.words : d.item.transcript;
            const question = d.kind === "held" ? d.held.question : d.kind === "request" ? null : d.item.question;
            const h = d.kind === "held" ? d.held : null;
            const others = h ? props.roster.filter((c) => !numbered.some((o) => o.kind === "held" && o.callsign === c)) : [];
            const text = h && typed.held === h.id ? typed.text : "";
            const typedSign = callsignGiven(text) ? callsignOf(text) : null;
            const track = d.kind === "request" && d.request.n != null ? props.tracks.find((t) => t.n === d.request.n) : undefined;
            return (
              <li key={d.id} ref={openRef} className={styles.decision} data-late={late} aria-current="true">
                <span className={styles.itemHead}>
                  <span className={styles.wait} data-late={late}>
                    {fmtWait(wait)}
                  </span>
                  <span className={styles.itemCall}>
                    {d.colour ? <span className={styles.itemDot} style={{ background: d.colour }} aria-hidden="true" /> : null}
                    {whoOf(d)}
                  </span>
                  <span className={styles.itemTime}>{fmtTime(d.ts)}</span>
                  <span className={styles.pill} data-status="ask">
                    {tagOf(d)}
                  </span>
                </span>
                <span className={styles.said}>{transcript ? `“${transcript}”` : "(no words heard)"}</span>
                {question ? <span className={styles.heldQuestion}>{question}</span> : null}
                {heardOf(d) ? (
                  // What the unit said in answer, read in code [245]. Its choice is picked below; nothing is saved without the confirm.
                  <span className={styles.heardAnswer}>
                    Heard at {fmtTime(heardOf(d)!.ts)}: “{heardOf(d)!.said}”. That is choice {heardOf(d)!.n}, {heardOf(d)!.what}.
                  </span>
                ) : null}
                {h?.audio && props.session ? (
                  <audio className={styles.heldAudio} controls preload="none" src={`/api/sessions/${encodeURIComponent(props.session)}/audio/${encodeURIComponent(h.audio)}`}>
                    The recording.
                  </audio>
                ) : null}
                {d.kind === "request" ? (
                  <>
                    {track ? (
                      <button type="button" className={styles.linkBtn} onClick={() => props.onTrack(track.n)}>
                        Track {track.n} · {describeTrack(track)}
                        {track.position ? ` · ${track.position.label}` : " · not placed yet"}
                      </button>
                    ) : (
                      <span className={styles.heldQuestion}>No track named. Pick the track to look at.</span>
                    )}
                    {canEdit ? <SendDrone key={`${d.request.id}:${d.request.n}`} n={track ? track.n : null} tracks={props.tracks} units={props.units} request={d.request} busy={busy} onTask={props.onTask} /> : null}
                  </>
                ) : (
                  <div className={styles.options} role="group" aria-label={`What to do with ${whoOf(d)}’s report`}>
                    {numbered.map((o, i) => {
                      const c = o.kind === "choice" && d.kind === "question" ? d.item.candidates[i] : undefined;
                      return (
                        <button key={i} type="button" className={styles.option} aria-pressed={sameOption(picked, o)} disabled={!canEdit || busy} onClick={() => props.onSelect(o)}>
                          {/* Keys 1 to 9; a tenth unit for a held report is picked by a click only. */}
                          <kbd className={styles.key} style={d.colour ? { borderColor: d.colour } : undefined} aria-hidden={i >= 9 || undefined}>
                            {i < 9 ? i + 1 : ""}
                          </kbd>
                          <span className={styles.optionName}>
                            {optionLabel(o)}
                            {c?.town ? ` (${c.town})` : ""}
                            {c ? <span className={styles.muted}> · {c.category.replace("_", " ")}</span> : null}
                          </span>
                        </button>
                      );
                    })}
                    {drop ? (
                      <button type="button" className={styles.option} data-drop="" aria-pressed={sameOption(picked, drop)} disabled={!canEdit || busy} onClick={() => props.onSelect(drop)}>
                        <kbd className={styles.key}>N</kbd>
                        <span className={styles.optionName}>{optionLabel(drop)}</span>
                      </button>
                    ) : null}
                  </div>
                )}
                {confirm && canEdit ? (
                  <div ref={confirmRef} className={styles.confirm} role="group" aria-label="Confirm">
                    <span className={styles.confirmText}>{confirm.text}</span>
                    <button type="button" className={confirm.danger ? styles.dangerBtn : styles.primaryBtn} onClick={props.onConfirm} disabled={busy}>
                      {busy ? "Saving…" : confirm.label} <kbd className={styles.keyInline}>Enter</kbd>
                    </button>
                    <button type="button" className={styles.linkBtn} onClick={() => props.onSelect(null)}>
                      Cancel
                    </button>
                  </div>
                ) : null}
                {h && canEdit && !confirm ? (
                  <div className={styles.heldActions}>
                    {others.length ? (
                      <select
                        className={styles.giveSelect}
                        value=""
                        onChange={(e) => {
                          if (e.target.value) props.onSelect({ kind: "held", action: "assign", callsign: e.target.value });
                        }}
                        aria-label="Give this report to a unit"
                      >
                        <option value="">{numbered.length ? "Another unit…" : "Give to…"}</option>
                        {others.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <form
                      className={styles.giveForm}
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (typedSign) props.onSelect({ kind: "held", action: props.roster.includes(typedSign) ? "assign" : "add", callsign: typedSign });
                      }}
                    >
                      <input
                        className={styles.giveInput}
                        value={text}
                        onChange={(e) => setTyped({ held: h.id, text: e.target.value })}
                        placeholder="New call sign"
                        maxLength={24}
                        autoCapitalize="characters"
                        spellCheck={false}
                        aria-label="A call sign to add to the roster"
                      />
                      <button type="submit" className={styles.linkBtn} disabled={!typedSign}>
                        Add
                      </button>
                    </form>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
