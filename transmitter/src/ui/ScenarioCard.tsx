// Scripted reports: pick a scenario, play it all, or send one report on its own.
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Scenario, ScenarioStep } from "../types";
import { Button } from "./controls";
import type { StepResult } from "./model";
import { TOUCH, color, radius, space, type } from "./theme";

/** What a step should get back, in a few words: "a position", "Track 1, hostile vehicle", "a question about Track 4". */
export function expected(e: ScenarioStep["expect"]): string {
  let track: string | null = null;
  if (e.track) {
    // `affiliation: null` means no word said whose it is, so the track is unknown.
    const whose = e.track.affiliation === undefined ? "" : e.track.affiliation === "neutral" ? "civilian" : (e.track.affiliation ?? "unknown");
    const what = [whose, e.track.kind?.replace("_", " ") ?? ""].filter(Boolean).join(" ");
    track = [e.track.n != null ? `Track ${e.track.n}` : "a track", what].filter(Boolean).join(", ");
  }
  if (e.status === "ambiguous") return track ? `a question about ${track}` : "a question back";
  if (e.status === "unresolved") return "no place, and a question";
  return track ?? (e.heading_to ? "a movement" : "a position");
}

export function ScenarioCard({
  scenarios,
  scenarioId,
  onSelect,
  results,
  running,
  blocked,
  onPlay,
  onStop,
  onSendStep,
}: {
  scenarios: Scenario[];
  scenarioId: string;
  onSelect: (id: string) => void;
  results: Record<string, StepResult>;
  running: boolean;
  /** True when nothing can be sent right now (busy elsewhere, or a model is missing). */
  blocked: boolean;
  onPlay: () => void;
  onStop: () => void;
  onSendStep: (scenario: Scenario, step: ScenarioStep) => void;
}) {
  const scenario = scenarios.find((s) => s.id === scenarioId);
  return (
    <View style={styles.section}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipScroll}>
        {scenarios.map((s) => {
          const on = s.id === scenarioId;
          return (
            <Pressable
              key={s.id}
              onPress={() => !running && onSelect(s.id)}
              style={[styles.chip, on && styles.chipOn]}
              hitSlop={{ top: 4, bottom: 4 }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: running }}
              accessibilityLabel={s.title}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{s.title}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {running ? <Button label="Stop" icon="stop" onPress={onStop} /> : <Button label="Play all in order" icon="play" onPress={onPlay} disabled={blocked || !scenario} />}

      {scenario ? (
        <View style={styles.panel}>
          {scenario.steps.map((step, i) => {
            const r = results[`${scenario.id}/${step.id}`];
            return (
              <View key={step.id}>
                {i > 0 ? <View style={styles.hairline} /> : null}
                <Pressable
                  onPress={() => !blocked && !running && onSendStep(scenario, step)}
                  style={({ pressed }) => [styles.step, pressed && !blocked && !running && styles.stepPressed]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: blocked || running }}
                  accessibilityLabel={`${step.callsign} says ${step.text}. ${r ? r.note : "Not sent yet"}`}
                  accessibilityHint="Sends this report on its own"
                >
                  <View style={styles.mark}>
                    {r?.state === "running" ? (
                      <ActivityIndicator size="small" color={color.textDim} />
                    ) : (
                      <Ionicons
                        name={r?.state === "pass" ? "checkmark-circle" : r?.state === "fail" ? "close-circle" : "play-circle-outline"}
                        size={24}
                        color={r?.state === "pass" ? color.ok : r?.state === "fail" ? color.bad : color.textDim}
                      />
                    )}
                  </View>
                  <View style={styles.stepText}>
                    <Text style={type.body}>“{step.text}”</Text>
                    <Text style={[type.footnote, r?.state === "fail" && styles.failNote]}>
                      {step.callsign} · {r ? r.note : `expects ${expected(step.expect)}`}
                    </Text>
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}
      <Text style={styles.hint}>Tap a report to send it on its own. Scenarios use prepared clips, not the microphone.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  chipScroll: { marginHorizontal: -space.lg },
  chips: { gap: space.sm, paddingHorizontal: space.lg },
  chip: { minHeight: 36, justifyContent: "center", paddingHorizontal: space.md + 2, borderRadius: 18, backgroundColor: color.raised },
  chipOn: { backgroundColor: color.lifted },
  chipText: { ...type.footnote, fontWeight: "600" },
  chipTextOn: { color: color.text },
  panel: { backgroundColor: color.surface, borderRadius: radius.panel, overflow: "hidden" },
  hairline: { height: StyleSheet.hairlineWidth, backgroundColor: color.line, marginLeft: space.lg + 24 + space.md },
  step: { minHeight: TOUCH, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm + 2 },
  stepPressed: { backgroundColor: color.raised },
  mark: { width: 24, alignItems: "center" },
  stepText: { flex: 1, gap: 2 },
  failNote: { color: color.bad },
  hint: { ...type.footnote, paddingHorizontal: space.lg },
});
