// Joining a mission: pick one of the coordinator's open missions, check the call sign, join.
// Shown in place of the talk button's notice until the phone has joined, because a report to a
// coordinator that keeps missions needs one.
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { MissionSummary } from "../types";
import { Button } from "./controls";
import { fmtTime } from "./model";
import { TOUCH, color, radius, space, type } from "./theme";

export function JoinCard({
  missions,
  selected,
  onSelect,
  callsign,
  onCallsign,
  onJoin,
  busy,
  error,
  receiverUrl,
}: {
  /** Open missions only. */
  missions: MissionSummary[];
  selected: string | null;
  onSelect: (code: string) => void;
  callsign: string;
  onCallsign: (s: string) => void;
  onJoin: () => void;
  busy: boolean;
  error: string | null;
  /** Where the operator opens a mission, to say so when none is open. */
  receiverUrl: string;
}) {
  if (!missions.length) {
    return (
      <View style={styles.card} accessibilityRole="alert">
        <View style={styles.head}>
          <Ionicons name="flag-outline" size={20} color={color.warn} />
          <Text style={type.headline}>No mission is open</Text>
        </View>
        <Text style={type.footnote}>The base opens one on the receiver ({receiverUrl}). This list updates by itself.</Text>
      </View>
    );
  }
  const name = callsign.trim();
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="flag-outline" size={20} color={color.accent} />
        <Text style={type.headline}>Join a mission</Text>
      </View>
      <View style={styles.list} accessibilityRole="radiogroup" accessibilityLabel="Open missions">
        {missions.map((m) => {
          const on = m.code === selected;
          return (
            <Pressable
              key={m.code}
              onPress={() => onSelect(m.code)}
              style={[styles.mission, on && styles.missionOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${m.name}, ${m.units} units, opened ${fmtTime(m.opened)}`}
            >
              <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? color.accent : color.textDim} />
              <View style={styles.missionText}>
                <Text style={type.body} numberOfLines={1}>
                  {m.name}
                </Text>
                <Text style={type.footnote} numberOfLines={1}>
                  {m.start ? `Start: ${m.start.name}` : "No start point"} · {m.units} {m.units === 1 ? "unit" : "units"}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.callRow}>
        <Text style={type.footnote}>Call sign</Text>
        <TextInput
          style={styles.input}
          value={callsign}
          onChangeText={(t) => onCallsign(t.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="join"
          onSubmitEditing={onJoin}
          maxLength={16}
          placeholder="ALPHA 1"
          placeholderTextColor={color.textDim}
          selectionColor={color.accent}
          accessibilityLabel="Call sign"
        />
      </View>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button label={name ? `Join as ${name}` : "Join"} kind="primary" onPress={onJoin} busy={busy} disabled={!selected || !name} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.surface, borderRadius: radius.panel, padding: space.lg, gap: space.md, marginHorizontal: space.lg, marginTop: space.md },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  list: { gap: space.xs },
  mission: { minHeight: TOUCH, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.control, backgroundColor: color.raised },
  missionOn: { backgroundColor: color.lifted },
  missionText: { flex: 1, gap: 2 },
  callRow: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.control, backgroundColor: color.raised },
  input: { ...type.body, flex: 1, textAlign: "right", paddingVertical: 6 },
  error: { ...type.footnote, color: color.bad },
});
