"use client";

/**
 * What the command post heard, and what the app did with it: the words, the model's intent, the
 * resolver's rule, the place, the grid and the timings, in one drawer. A report's words can be
 * corrected and sent again as a new report from the same unit; the first line stays in the log.
 */
import { useState } from "react";
import type { AreaId } from "@/lib/geo/areas";
import type { FeedItem } from "@/lib/reports/fold";
import type { Intent, Resolution } from "@/lib/geo/types";
import type { LogEntry, ReportEntry } from "@/lib/reports/types";
import { GridTag } from "./TrackTools";
import styles from "./CommandPost.module.css";

const INTENT_KIND: Record<Intent["kind"], string> = {
  position: "a place",
  movement: "a movement",
  other: "something else",
};

const RESOLUTION: Record<Resolution["status"], string> = {
  resolved: "Placed",
  ambiguous: "Asked back",
  unresolved: "Could not place",
};

function languageName(code: string | null): string {
  if (!code) return "not known";
  if (code.startsWith("fr")) return "French";
  if (code.startsWith("uk")) return "Ukrainian";
  if (code.startsWith("ru")) return "Russian";
  if (code.startsWith("en")) return "English";
  return code;
}

export function ReportInspector(props: {
  item: FeedItem;
  entry: LogEntry | null;
  canEdit: boolean;
  session: string | null;
  area: AreaId;
  format: (ts: number) => string;
  onClose: () => void;
  onShow: () => void;
  onCopy: (text: string) => void;
  onSent: () => void;
  onNotice: (text: string) => void;
}) {
  const report = props.entry?.kind === "report" ? (props.entry as ReportEntry) : null;
  const [words, setWords] = useState(props.item.transcript);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const canCorrect = props.canEdit && !!props.session && report != null && !sent;
  const changed = words.trim() !== props.item.transcript.trim() && words.trim().length > 0;

  const sendCorrection = async () => {
    if (!canCorrect || !props.session || !changed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("text", words.trim());
      form.set("session", props.session);
      form.set("callsign", props.item.callsign);
      form.set("area", props.area);
      form.set("language", report?.language ?? "en");
      form.set("clientTs", String(Date.now()));
      const res = await fetch("/api/report", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `The coordinator answered ${res.status}.`);
      setSent(true);
      props.onSent();
      props.onNotice(`Corrected report sent as a new report from ${props.item.callsign}. The first one stays in the log.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sending the correction failed.");
    } finally {
      setBusy(false);
    }
  };

  const candidates = report?.resolution.candidates ?? props.item.candidates;
  const answered = !!props.item.answer;
  const statusTag = answered
    ? `${props.item.answer?.by ?? ""} ${props.item.answer?.choice ? "answered" : "closed"}`.trim()
    : RESOLUTION[props.item.status];
  const questions = [
    report?.intent?.subject === "track" ? "about a track" : report?.intent ? "about the speaker" : null,
    report?.intent ? INTENT_KIND[report.intent.kind] : null,
    report?.intent?.landmark_name ? `at ${report.intent.landmark_name}` : null,
    report?.intent?.relation && report.intent.relation !== "at" ? `(${report.intent.relation.replace(/_/g, " ")})` : null,
    report?.intent?.distance_m ? `${report.intent.distance_m} m` : null,
    report?.intent?.direction ? `towards ${report.intent.direction}` : null,
  ].filter(Boolean) as string[];

  return (
    <div
      className={styles.inspector}
      role="dialog"
      aria-modal="true"
      aria-label={`Report from ${props.item.callsign}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className={styles.inspectorCard}>
        <div className={styles.inspectorHead}>
          <div className={styles.drawerTitle}>
            <h2>Report · {props.item.callsign}</h2>
            <span>
              {props.format(props.item.ts)} · {props.item.kind === "report" ? "heard on the net" : props.item.kind}
            </span>
          </div>
          <span className={styles.pill} data-status={answered ? "answered" : props.item.status === "resolved" ? "placed" : props.item.status === "ambiguous" ? "ask" : "none"}>
            {statusTag}
          </span>
          <button autoFocus type="button" className={`${styles.linkBtn} ${styles.drawerClose}`} onClick={props.onClose}>
            Close
          </button>
        </div>

        <div className={styles.inspectorBody}>
          <section className={styles.inspectorSection}>
            <h3>Words</h3>
            <blockquote className={styles.inspectorWords}>
              {props.item.transcript ? `“${props.item.transcript}”` : "(no words heard)"}
            </blockquote>
            <p className={styles.inspectorMeta}>
              Language: {languageName(report?.language ?? null)}
              {report?.sender ? " · sender read from the words" : ""}
            </p>
          </section>

          {report?.intent ? (
            <section className={styles.inspectorSection}>
              <h3>What the app understood</h3>
              <p className={styles.inspectorMeta}>{questions.join(" · ") || "nothing to place"}</p>
              <dl className={styles.inspectorGrid}>
                <dt>Kind</dt>
                <dd>{INTENT_KIND[report.intent.kind]}</dd>
                <dt>Subject</dt>
                <dd>{report.intent.subject === "track" ? "a track" : "the speaker"}</dd>
                <dt>Language</dt>
                <dd>{languageName(report.intent.language)}</dd>
                <dt>Confidence</dt>
                <dd>{Math.round(report.intent.confidence * 100)}%</dd>
                {report.intent.track_kind ? (
                  <>
                    <dt>Track</dt>
                    <dd>{report.intent.track_kind}{report.intent.track_count ? ` × ${report.intent.track_count}` : ""}</dd>
                  </>
                ) : null}
                {report.intent.track_heading ? (
                  <>
                    <dt>Moving</dt>
                    <dd>{report.intent.track_heading}</dd>
                  </>
                ) : null}
              </dl>
            </section>
          ) : null}

          <section className={styles.inspectorSection}>
            <h3>How it was placed</h3>
            <p className={styles.inspectorMeta}>
              {report ? report.resolution.evidence.detail : props.item.outcome}
            </p>
            {report ? (
              <dl className={styles.inspectorGrid}>
                <dt>Rule</dt>
                <dd><code>{report.resolution.evidence.rule}</code></dd>
                <dt>Status</dt>
                <dd>{answered ? (props.item.answer?.choice ? "asked back, then answered" : "question closed") : report.resolution.status}</dd>
                {report.resolution.question ? (
                  <>
                    <dt>Asked</dt>
                    <dd>{report.resolution.question}</dd>
                  </>
                ) : null}
                {report.resolution.track ? (
                  <>
                    <dt>Track</dt>
                    <dd>Track {report.resolution.track.n}{report.resolution.track.label ? ` · ${report.resolution.track.label}` : ""}</dd>
                  </>
                ) : null}
              </dl>
            ) : null}
            {props.item.position ? (
              <p className={styles.inspectorMeta}>
                {props.item.position.label} · ±{props.item.position.radius_m} m
                <GridTag at={props.item.position} />
                {props.item.position.estimated ? " · estimate" : ""}
              </p>
            ) : null}
            {candidates.length ? (
              <ol className={styles.inspectorList}>
                {candidates.map((c) => (
                  <li key={c.id}>
                    <b>{c.name}</b> · {c.category.replace("_", " ")} · {Math.round(c.distance_m)} m
                  </li>
                ))}
              </ol>
            ) : null}
            {props.item.answer ? (
              <p className={styles.inspectorMeta}>
                {props.item.answer.choice ? `Chosen: ${props.item.answer.name ?? props.item.answer.choice}` : "Closed without a choice"}
                {props.item.answer.by ? ` by ${props.item.answer.by}` : ""}
              </p>
            ) : null}
          </section>

          {report?.timings_ms ? (
            <section className={styles.inspectorSection}>
              <h3>Timings</h3>
              <p className={styles.inspectorMeta}>
                speech-to-text {report.timings_ms.stt} ms · intent {report.timings_ms.extract} ms · resolver {report.timings_ms.resolve} ms · total {report.timings_ms.total} ms
              </p>
            </section>
          ) : null}

          <section className={styles.inspectorSection}>
            <h3>Actions</h3>
            <div className={styles.inspectorActions}>
              {props.item.position ? (
                <button type="button" className={styles.ghostBtn} onClick={props.onShow}>
                  Show on map
                </button>
              ) : null}
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => props.onCopy(props.item.transcript || props.item.outcome)}
                disabled={!props.item.transcript}
              >
                Copy words
              </button>
            </div>
            {canCorrect ? (
              <div className={styles.inspectorCorrect}>
                <label htmlFor="report-correct">Correct the words and send them again</label>
                <textarea
                  id="report-correct"
                  value={words}
                  onChange={(e) => setWords(e.target.value)}
                  rows={3}
                  maxLength={500}
                />
                <p className={styles.inspectorMeta}>
                  A new report from {props.item.callsign} is read and placed. The first report stays in the log, so the
                  correction is visible beside it.
                </p>
                {error ? <p className={styles.error} role="alert">{error}</p> : null}
                <div className={styles.inspectorActions}>
                  <button type="button" className={styles.primaryBtn} onClick={() => void sendCorrection()} disabled={busy || !changed}>
                    {busy ? "Sending…" : "Send corrected report"}
                  </button>
                </div>
              </div>
            ) : sent ? (
              <p className={styles.inspectorMeta} role="status">
                Sent. The new report is at the top of the list.
              </p>
            ) : !props.canEdit ? (
              <p className={styles.inspectorMeta}>Read-only here: open your own mission to correct a report.</p>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
