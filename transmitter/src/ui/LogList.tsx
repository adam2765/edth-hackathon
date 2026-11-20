// What this phone has sent, newest first, with the coordinator's answer to each report.
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Candidate } from "../types";
import { Button, type IconName } from "./controls";
import { fmtDistance, fmtTime, type Entry } from "./model";
import { TOUCH, color, radius, space, tabular, type } from "./theme";

function outcomeIcon(e: Entry): { name: IconName; tint: string } {
  if (e.status === "error") return { name: "alert-circle", tint: color.bad };
  if (e.status === "unresolved") return { name: "help-circle", tint: color.textDim };
  if (e.pending) return { name: "help-circle", tint: color.warn };
  return { name: "checkmark-circle", tint: color.ok };
}

/**
 * The coordinator's question, with its choices. Shown directly under the talk button, because a
 * question is the one thing on the screen that is waiting for the person holding the phone.
 */
export function QuestionCard({ entry, onChoose, onNone }: { entry: Entry; onChoose: (entryId: string, c: Candidate) => void; onNone: (entryId: string) => void }) {
  return (
    <View style={styles.question} accessibilityRole="alert">
      <View style={styles.outcome}>
        <Ionicons name="help-circle" size={20} color={color.warn} style={styles.outcomeIcon} />
        <Text style={styles.questionText}>{entry.question ?? "Which one did you mean?"}</Text>
      </View>
      {entry.candidates?.map((c, n) => (
        <Pressable
          key={c.id}
          onPress={() => onChoose(entry.id, c)}
          style={({ pressed }) => [styles.choice, styles.choiceOnCard, pressed && styles.choicePressed]}
          accessibilityRole="button"
          accessibilityLabel={`Choice ${n + 1}: ${c.name}, ${c.category.replace("_", " ")}, ${fmtDistance(c.distance_m)} away`}
        >
          <Text style={styles.choiceN}>{n + 1}</Text>
          <View style={styles.choiceText}>
            <Text style={styles.choiceName}>{c.name}</Text>
            <Text style={[type.footnote, tabular]}>
              {c.category.replace("_", " ")} · {fmtDistance(c.distance_m)}
            </Text>
          </View>
        </Pressable>
      ))}
      <Button label="None of these" kind="quiet" muted onPress={() => onNone(entry.id)} />
    </View>
  );
}

export function LogList({ entries, onClear }: { entries: Entry[]; onClear: () => void }) {
  return (
    <View style={styles.section}>
      {entries.length > 0 ? (
        <View style={styles.head}>
          <Text style={type.footnote}>Newest first</Text>
          <Button label="Clear" kind="quiet" onPress={onClear} />
        </View>
      ) : null}

      {entries.length === 0 ? (
        <Text style={styles.empty}>Nothing sent yet. Hold the button and say where you are, or play a scenario. Each report and the coordinator’s answer will appear here.</Text>
      ) : (
        <View style={styles.panel}>
          {entries.map((e, i) => {
            const icon = outcomeIcon(e);
            return (
              <View key={e.id}>
                {i > 0 ? <View style={styles.hairline} /> : null}
                <View style={styles.entry}>
                  <View style={styles.meta}>
                    <Text style={[type.caption, tabular]}>
                      {fmtTime(e.ts)} · {e.callsign}
                    </Text>
                    <Text style={type.caption}>{e.source === "mic" ? "microphone" : e.source === "scenario" ? "scenario" : "open microphone"}</Text>
                  </View>
                  {e.transcript ? <Text style={type.body}>“{e.transcript}”</Text> : null}
                  <View style={styles.outcome}>
                    <Ionicons name={icon.name} size={18} color={icon.tint} style={styles.outcomeIcon} />
                    <Text style={[styles.outcomeText, e.status === "error" && styles.errorText]}>{e.question && e.pending ? e.question : e.outcome}</Text>
                  </View>
                  {e.timings ? <Text style={[type.caption, tabular]}>{e.timings}</Text> : null}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  head: { minHeight: TOUCH, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: space.lg },
  question: { backgroundColor: color.warnWash, borderRadius: radius.panel, paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.xs, gap: space.sm },
  questionText: { ...type.headline, flex: 1 },
  empty: { ...type.footnote, fontSize: 15, lineHeight: 21, paddingHorizontal: space.lg },
  panel: { backgroundColor: color.surface, borderRadius: radius.panel, overflow: "hidden" },
  hairline: { height: StyleSheet.hairlineWidth, backgroundColor: color.line, marginLeft: space.lg },
  entry: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm - 2 },
  meta: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  outcome: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  outcomeIcon: { marginTop: 2 },
  outcomeText: { ...type.body, fontWeight: "600", flex: 1 },
  errorText: { color: color.bad },
  choice: { minHeight: TOUCH + 4, flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: color.raised, borderRadius: radius.control, paddingHorizontal: space.md, paddingVertical: space.sm },
  /** On the question card the choices are cut into the card, so they keep its warm tint around them. */
  choiceOnCard: { backgroundColor: color.bg },
  choicePressed: { backgroundColor: color.lifted },
  choiceN: { width: 26, height: 26, borderRadius: 13, overflow: "hidden", backgroundColor: color.warn, color: "#1b1b1b", fontWeight: "800", fontSize: 14, lineHeight: 26, textAlign: "center" },
  choiceText: { flex: 1, gap: 1 },
  choiceName: { ...type.body, fontWeight: "600" },
});
