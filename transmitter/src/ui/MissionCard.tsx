// Picking a mission, like tuning a radio to a net: tap one of the coordinator's open missions and
// reports go to it. There is no call sign to type and nothing to join: the coordinator reads who
// spoke from the words [202]. Shown while no mission is picked; with one open, it is picked for you.
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MissionSummary } from "../types";
import { fmtTime } from "./model";
import { TOUCH, color, radius, space, type } from "./theme";

/** An older coordinator sends no roster [201]. */
const onRoster = (m: MissionSummary) => m.roster?.length ?? 0;

export function MissionCard({
  missions,
  onPick,
  note,
  commandPostUrl,
}: {
  /** Open missions only. */
  missions: MissionSummary[];
  onPick: (code: string) => void;
  /** Why the phone is off its mission, if it was on one ("Patrol 2 has ended."). */
  note: string | null;
  /** Where the operator opens a mission, to say so when none is open. */
  commandPostUrl: string;
}) {
  if (!missions.length) {
    return (
      <View style={styles.card} accessibilityRole="alert">
        <View style={styles.head}>
          <Ionicons name="flag-outline" size={20} color={color.warn} />
          <Text style={type.headline}>No mission is open</Text>
        </View>
        <Text style={type.footnote}>
          {note ? `${note} ` : ""}The base opens one on the command post ({commandPostUrl}). This list updates by itself.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="flag-outline" size={20} color={color.accent} />
        <Text style={type.headline}>Pick a mission</Text>
      </View>
      {note ? <Text style={type.footnote}>{note}</Text> : null}
      <View style={styles.list} accessibilityLabel="Open missions">
        {missions.map((m) => (
          <Pressable
            key={m.code}
            onPress={() => onPick(m.code)}
            style={({ pressed }) => [styles.mission, pressed && styles.missionPressed]}
            accessibilityRole="button"
            accessibilityLabel={`${m.name}, ${onRoster(m)} on the roster, opened ${fmtTime(m.opened)}`}
            accessibilityHint="Sends reports to this mission"
          >
            <Ionicons name="radio-outline" size={20} color={color.textDim} />
            <View style={styles.missionText}>
              <Text style={type.body} numberOfLines={1}>
                {m.name}
              </Text>
              <Text style={type.footnote} numberOfLines={1}>
                {m.start ? `Start: ${m.start.name}` : "No start point"} · {onRoster(m)} on the roster
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={color.textDim} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.surface, borderRadius: radius.panel, padding: space.lg, gap: space.md, marginHorizontal: space.lg, marginTop: space.md },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  list: { gap: space.xs },
  mission: { minHeight: TOUCH, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.control, backgroundColor: color.raised },
  missionPressed: { backgroundColor: color.lifted },
  missionText: { flex: 1, gap: 2 },
});
