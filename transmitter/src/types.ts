// The coordinator's reply types are shared with the server. These are type-only imports,
// so nothing outside this folder ends up in the app bundle.
import type { Affiliation, Candidate, Intent, Placement, Resolution, TrackKind } from "../../lib/geo/types";
import type { HeldReason, MissionListReply, MissionSummary } from "../../lib/reports/types";

export type { Candidate, Intent, Placement, Resolution };
export type { MissionListReply, MissionSummary };

export type AreaId = "vincennes" | "kyiv" | "izium";
export type Lang = "en" | "fr" | "uk";

/** A stretch of speech as Whisper on the phone timed it: t0 and t1 as whisper.rn gives them. */
export interface PhoneSegment {
  text: string;
  t0: number;
  t1: number;
}

export interface ScenarioStep {
  id: string;
  /** Seconds from the start of the scenario. */
  t: number;
  callsign: string;
  lang: Lang;
  text: string;
  expect: {
    status: Resolution["status"];
    feature_id?: string;
    heading_to?: string;
    /**
     * For a report about a track: its number, whose it is (null when no word said so) and its kind.
     * Only the fields given are checked. Numbers count from 1 in a new mission. Without `track`,
     * a report that places something must be about the speaker.
     */
    track?: { n?: number; affiliation?: Affiliation | null; kind?: TrackKind };
  };
  /** Candidate id to pick when the coordinator asks back. */
  choose?: string;
  /** Bundled clip (a Metro asset id). */
  audio: number;
  /** The same clip as 16 kHz mono PCM, for speech-to-text on the phone. */
  wav: number;
}

export interface Scenario {
  id: string;
  title: string;
  area: AreaId;
  steps: ScenarioStep[];
}

/**
 * One spoken report, whatever produced it. Today a button release or a scenario clip makes one;
 * later an open microphone that cuts at pauses will make them too. Nothing after this point
 * knows the difference.
 */
export interface Utterance {
  /** Counts up on this phone, so the coordinator can drop a report sent twice. */
  seq: number;
  /**
   * Only for a scenario step, which is scripted and speaks for several units. A report from the
   * microphone has none: like a radio's, its sender is read from its words [202].
   */
  callsign?: string;
  source: "mic" | "scenario" | "open_mic";
  /** Local file with the audio, when speech-to-text runs on the server. */
  audioUri?: string;
  mime?: string;
  /** The words, when speech-to-text already ran on the phone. */
  text?: string;
  /** For tests ("Send clips"): the recording beside the words, and Whisper's timed stretches of it. */
  clipUri?: string;
  segments?: PhoneSegment[];
  /** Epoch ms. */
  startedAt: number;
  endedAt: number;
  scenarioStepId?: string;
}

/** A radio report the coordinator did not give to a unit by itself: it waits for the operator [203]. */
export interface HeldReport {
  id: string;
  reason: HeldReason;
  /** What the operator is asked, not the speaker. */
  question: string;
  audio: string | null;
}

/**
 * `POST /api/report`'s answer. A report that went to a unit has a `resolution`. A radio report
 * the coordinator is not sure of has `held` instead [203]: null when holding it failed.
 */
export interface ReportReply {
  transcript: string;
  language: string | null;
  intent: Intent | null;
  resolution?: Resolution;
  held?: HeldReport | null;
  timings_ms: { stt: number; extract: number; resolve: number; total: number };
  /** Set when the coordinator saved the report for the command post. */
  report_id?: string;
  /** The file name, when the coordinator kept the clip for tests (KEEP_CLIPS=1). */
  clip?: string;
  error?: string;
  /** With an error: the mission has ended, so the phone should pick another. */
  ended?: boolean;
}

/** Where this unit was last placed. `estimated` marks a position derived from a movement report. */
export interface Position {
  lat: number;
  lon: number;
  ts: number;
  radius_m: number;
  label: string;
  estimated?: boolean;
}
