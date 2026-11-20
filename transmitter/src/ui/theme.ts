// One place for the transmitter's colours, type and spacing. The palette is the web app's
// (app/globals.css in the folder above), so both read as one product.
import type { TextStyle } from "react-native";

export const color = {
  bg: "#0f1720",
  surface: "#16212c",
  raised: "#1e2c3a",
  /** Selected segment and pressed states: one step lighter than `raised`. */
  lifted: "#2c3f52",
  line: "#2a3a4b",
  text: "#e8eef4",
  textDim: "#93a4b5",
  /** The one tint: the talk button, the current choice, switches. */
  accent: "#ff6b2c",
  /** Text and icons on the accent. White fails contrast on this orange. */
  onAccent: "#1d0e06",
  /** The resting ring around the talk button: the accent, held back. */
  accentRing: "rgba(255, 107, 44, 0.45)",
  ok: "#3ccf7a",
  warn: "#ffc940",
  bad: "#ff5a5a",
  onBad: "#2a0707",
  badWash: "rgba(255, 90, 90, 0.14)",
  warnWash: "rgba(255, 201, 64, 0.12)",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { control: 10, panel: 14 } as const;

/** Smallest comfortable touch target on both platforms. */
export const TOUCH = 44;

export const type = {
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700", color: color.text },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600", color: color.text },
  body: { fontSize: 16, lineHeight: 22, color: color.text },
  footnote: { fontSize: 13, lineHeight: 18, color: color.textDim },
  caption: { fontSize: 12, lineHeight: 16, color: color.textDim },
} satisfies Record<string, TextStyle>;

/** Times, distances and counts line up when the digits share a width. */
export const tabular: TextStyle = { fontVariant: ["tabular-nums"] };
