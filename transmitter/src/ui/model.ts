// What the screen shows, as plain data. The logic that fills it lives in App.tsx.
export type StepResult = { state: "running" | "pass" | "fail"; note: string };

export type Reach = "checking" | "ok" | "unreachable";

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
