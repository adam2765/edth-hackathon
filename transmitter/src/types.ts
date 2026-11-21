// The coordinator's reply types are shared with the server. These are type-only imports,
// so nothing outside this folder ends up in the app bundle.
import type { Candidate, Intent, Placement, Resolution } from "../../lib/geo/types";
import type { JoinReply, MissionListReply, MissionSummary, UnitPosition } from "../../lib/reports/types";

export type { Candidate, Intent, Placement, Resolution };
export type { JoinReply, MissionListReply, MissionSummary, UnitPosition };

export type AreaId = "vincennes" | "kyiv" | "izium";
export type Lang = "en" | "fr" | "uk";

export interface ScenarioStep {
  id: string;
  /** Seconds from the start of the scenario. */
  t: number;
  callsign: string;
  lang: Lang;
  text: string;
  expect: { status: Resolution["status"]; feature_id?: string; heading_to?: string };
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
  /** Counts up per call sign, so the coordinator can spot gaps, duplicates and late arrivals. */
  seq: number;
  callsign: string;
  source: "mic" | "scenario" | "open_mic";
  /** Local file with the audio, when speech-to-text runs on the server. */
  audioUri?: string;
  mime?: string;
  /** The words, when speech-to-text already ran on the phone. */
  text?: string;
  /** Epoch ms. */
  startedAt: number;
  endedAt: number;
  scenarioStepId?: string;
}

export interface ReportReply {
  transcript: string;
  language: string | null;
  intent: Intent | null;
  resolution: Resolution;
  timings_ms: { stt: number; extract: number; resolve: number; total: number };
  /** Set when the coordinator saved the report for the receiver; send it back with the answer to a question. */
  report_id?: string;
  error?: string;
  /** With an error: the mission has ended, so the phone should join another. */
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
