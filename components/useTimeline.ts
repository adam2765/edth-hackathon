"use client";

/**
 * The command post's timeline state: whether the drawer is open, its filter, search and time
 * window, the rows after them, and what is new since this browser last opened the mission. The
 * jump and the drawer's markup stay outside [276].
 */
import { useEffect, useMemo, useState } from "react";
import type { FeedItem } from "@/lib/reports/fold";
import type { TimelineFilter } from "./CommandPostTimeline";

export interface UseTimelineOptions {
  session: string | null;
  feed: FeedItem[];
  mode: "live" | "replay";
  replayT: number;
  effNow: number;
}

export function useTimeline(o: UseTimelineOptions) {
  const { session, feed, mode, replayT, effNow } = o;
  const [timelineOpen, setTimelineOpen] = useState(false);
  /** What the timeline shows, and what to look for in it [271]. */
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const [timelineQuery, setTimelineQuery] = useState("");
  /** The timeline's time window, in minutes; 0 is all of it [273]. */
  const [timelineWindow, setTimelineWindow] = useState<0 | 5 | 15 | 60>(0);
  /** When this operator last had this mission open: what the Timeline calls new [273]. */
  const [seenBefore, setSeenBefore] = useState<number | null>(null);

  // What was new since this operator last opened the mission; kept in this browser only [273].
  useEffect(() => {
    if (!session) {
      queueMicrotask(() => setSeenBefore(null));
      return;
    }
    const key = `cp-seen:${session}`;
    let previous: number | null = null;
    try {
      const raw = localStorage.getItem(key);
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) previous = n;
      localStorage.setItem(key, String(Date.now()));
    } catch {
      // A private window can refuse storage; then there is no "new since".
    }
    queueMicrotask(() => setSeenBefore(previous));
  }, [session]);

  /** The events the timeline shows, after its filter and search [271]. */
  const timelineEvents = useMemo(() => {
    const q = timelineQuery.trim().toLowerCase();
    const cutoff = timelineWindow > 0 ? (mode === "replay" ? replayT : effNow) - timelineWindow * 60_000 : null;
    return [...feed]
      .sort((a, b) => b.ts - a.ts)
      .filter((f) => {
        if (cutoff != null && f.ts < cutoff) return false;
        if (timelineFilter === "reports" && f.kind !== "report") return false;
        if (timelineFilter === "tracks" && f.track == null) return false;
        if (timelineFilter === "units" && f.kind !== "join" && !(f.kind === "report" && f.track == null)) return false;
        if (timelineFilter === "tasks" && f.kind !== "task" && f.kind !== "request" && f.kind !== "reply") return false;
        if (!q) return true;
        return `${f.callsign} ${f.transcript ?? ""} ${f.outcome} ${f.track != null ? `T${f.track}` : ""}`.toLowerCase().includes(q);
      });
  }, [feed, timelineFilter, timelineQuery, timelineWindow, mode, replayT, effNow]);

  const newSince = seenBefore != null && feed.some((f) => f.ts > seenBefore) ? seenBefore : null;
  const newCount = newSince != null ? timelineEvents.filter((f) => f.ts > newSince).length : 0;

  return {
    timelineOpen,
    setTimelineOpen,
    timelineFilter,
    setTimelineFilter,
    timelineQuery,
    setTimelineQuery,
    timelineWindow,
    setTimelineWindow,
    timelineEvents,
    newSince,
    newCount,
  };
}
