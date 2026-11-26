"use client";

/**
 * The mission timeline drawer: filters, a search, the time window, the hour marks and the rows
 * that replay an event or open its report. The state and the jump live in CommandPost; the
 * drawer's model is grouped here [276]. The markup and classes are the ones that were inline.
 */
import { createContext, Fragment, useContext, type ReactNode } from "react";
import type { FeedItem } from "@/lib/reports/fold";
import styles from "./CommandPost.module.css";

export const TIMELINE_FILTERS = [
  ["all", "All"],
  ["reports", "Reports"],
  ["tracks", "Tracks"],
  ["units", "Units"],
  ["tasks", "Tasks"],
] as const;

export type TimelineFilter = (typeof TIMELINE_FILTERS)[number][0];

export interface CommandPostTimelineModel {
  events: FeedItem[];
  feedLength: number;
  newSince: number | null;
  newCount: number;
  filter: TimelineFilter;
  query: string;
  window: 0 | 5 | 15 | 60;
  fmtTime: (ts: number) => string;
  onClose: () => void;
  onFilter: (filter: TimelineFilter) => void;
  onQuery: (query: string) => void;
  onWindow: (window: 0 | 5 | 15 | 60) => void;
  onClear: () => void;
  onJump: (item: FeedItem) => void;
  onInspect: (item: FeedItem) => void;
  onHover: (item: FeedItem | null) => void;
}

const TimelineContext = createContext<CommandPostTimelineModel | null>(null);

export function CommandPostTimelineProvider({ value, children }: { value: CommandPostTimelineModel; children: ReactNode }) {
  return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>;
}

/** The small tag at the end of a row: a track, an open question, or what the command post did. */
function timelineTag(f: FeedItem): string {
  if (f.track != null) return `T${f.track}`;
  if (f.question && !f.expired && !f.answer) return "Question";
  if (f.kind === "report") return "";
  return f.kind[0].toUpperCase() + f.kind.slice(1);
}

export function CommandPostTimeline() {
  const m = useContext(TimelineContext);
  if (!m) throw new Error("CommandPostTimeline needs CommandPostTimelineProvider.");

  return (
    <div className={styles.timelinePanel} role="dialog" aria-label="Timeline">
      <div className={styles.timelinePanelHead}>
        <h2>Timeline</h2>
        <button autoFocus type="button" className={`${styles.linkBtn} ${styles.drawerClose}`} onClick={m.onClose}>
          Close
        </button>
      </div>
      <p className={styles.timelinePanelHint}>
        {m.events.length === m.feedLength
          ? `${m.feedLength} event${m.feedLength === 1 ? "" : "s"}`
          : `${m.events.length} of ${m.feedLength} events`}{" "}
        · newest first{m.newCount > 0 ? ` · ${m.newCount} new` : ""}. Choose one to replay the mission just after it.
      </p>
      <div className={styles.timelineFilters} role="group" aria-label="Filter the timeline">
        {TIMELINE_FILTERS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={m.filter === id} onClick={() => m.onFilter(id)}>
            {label}
          </button>
        ))}
        {m.filter !== "all" || m.query || m.window > 0 ? (
          <button type="button" className={styles.timelineClear} onClick={m.onClear}>
            Clear
          </button>
        ) : null}
        <select
          className={styles.timelineWindow}
          value={m.window}
          onChange={(e) => m.onWindow(Number(e.target.value) as 0 | 5 | 15 | 60)}
          aria-label="Show events from"
          title="Show the last minutes, or the whole mission"
        >
          <option value={0}>All time</option>
          <option value={5}>Last 5 min</option>
          <option value={15}>Last 15 min</option>
          <option value={60}>Last 60 min</option>
        </select>
      </div>
      <input
        className={styles.timelineSearch}
        value={m.query}
        onChange={(e) => m.onQuery(e.target.value)}
        placeholder="Callsign, words, track…"
        aria-label="Search the timeline"
      />
      <ol className={styles.timelinePanelList}>
        {m.events.map((f, i) => {
          const tag = timelineTag(f);
          const firstOld =
            m.newSince != null && f.ts <= m.newSince && (i === 0 || m.events[i - 1].ts > m.newSince);
          const hour = new Date(f.ts).getHours();
          const hourChanged = i === 0 || new Date(m.events[i - 1].ts).getHours() !== hour;
          return (
            <Fragment key={f.id}>
              {hourChanged ? (
                <li className={styles.timelineHour} aria-hidden="true">
                  {String(hour).padStart(2, "0")}:00
                </li>
              ) : null}
              {firstOld ? (
                <li className={styles.timelineNewDivider}>New since {m.fmtTime(m.newSince!)}</li>
              ) : null}
              <li className={styles.timelineRow}>
                <button
                  type="button"
                  onClick={() => m.onJump(f)}
                  onMouseEnter={() => m.onHover(f)}
                  onMouseLeave={() => m.onHover(null)}
                  onFocus={() => m.onHover(f)}
                  onBlur={() => m.onHover(null)}
                  title={`${m.fmtTime(f.ts)} · ${f.callsign}`}
                >
                  <span className={styles.timelinePanelDot} style={{ background: f.colour }} aria-hidden="true" />
                  <span className={styles.timelinePanelTime}>{m.fmtTime(f.ts)}</span>
                  <span className={styles.timelinePanelWho}>{f.callsign}</span>
                  <span className={styles.timelinePanelText}>{f.transcript || f.outcome}</span>
                  {tag ? <span className={styles.timelinePanelTag}>{tag}</span> : null}
                </button>
                <button
                  type="button"
                  className={styles.timelineInspect}
                  onClick={() => m.onInspect(f)}
                  aria-label={`Inspect the event at ${m.fmtTime(f.ts)} from ${f.callsign}`}
                  title="What the app heard, and how it placed it"
                >
                  i
                </button>
              </li>
            </Fragment>
          );
        })}
        {m.feedLength === 0 ? (
          <li className={styles.timelinePanelEmpty}>No events yet.</li>
        ) : m.events.length === 0 ? (
          <li className={styles.timelinePanelEmpty}>No event matches.</li>
        ) : null}
      </ol>
    </div>
  );
}
