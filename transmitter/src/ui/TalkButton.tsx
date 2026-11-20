// The push-to-talk button: the one primary control on the screen.
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_CLIP_MS } from "../sources";
import { color, space, tabular, type } from "./theme";

export type TalkState = "idle" | "starting" | "recording" | "sending" | "scenario";

const SIZE = 148;
const RING = 10;

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function TalkButton({
  state,
  blocked,
  onPressIn,
  onPressOut,
}: {
  state: TalkState;
  /** Why talking is not possible right now (shown on the button), or null. */
  blocked: string | null;
  onPressIn: () => void;
  onPressOut: () => void;
}) {
  const recording = state === "recording";
  const [elapsed, setElapsed] = useState(0);
  // How much of the 15 second clip is used: the bar under the button fills as you speak.
  const used = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!recording) {
      used.stopAnimation();
      used.setValue(0);
      return;
    }
    const started = Date.now();
    setElapsed(0);
    const tick = setInterval(() => setElapsed(Date.now() - started), 250);
    Animated.timing(used, { toValue: 1, duration: MAX_CLIP_MS, easing: Easing.linear, useNativeDriver: false }).start();
    return () => clearInterval(tick);
  }, [recording, used]);

  const disabled = !!blocked || state === "sending" || state === "scenario";
  const label = blocked ?? (state === "starting" ? "Opening mic" : recording ? "Release to send" : state === "sending" ? "Sending" : state === "scenario" ? "Scenario running" : "Hold to talk");
  const quiet = disabled || state === "starting";
  const fill = recording ? color.bad : quiet ? color.raised : color.accent;
  const ink = recording ? color.onBad : quiet ? color.textDim : color.onAccent;

  return (
    <View style={styles.wrap}>
      <View style={[styles.ring, { borderColor: recording ? color.bad : quiet ? color.line : color.accentRing }]}>
        <Pressable
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          disabled={disabled}
          style={({ pressed }) => [styles.button, { backgroundColor: fill }, pressed && !disabled && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={recording ? `Recording, ${clock(elapsed)}. Release to send` : label}
          accessibilityState={{ disabled, busy: state === "sending" || state === "starting" }}
          accessibilityHint={disabled ? undefined : "Hold while you say where you are, then release"}
        >
          {state === "sending" || state === "scenario" ? (
            <ActivityIndicator color={ink} />
          ) : recording ? (
            <Text style={[styles.clock, { color: ink }]} maxFontSizeMultiplier={1.2}>
              {clock(elapsed)}
            </Text>
          ) : (
            <Ionicons name="mic" size={40} color={ink} />
          )}
          <Text style={[styles.label, { color: ink }]} maxFontSizeMultiplier={1.2} numberOfLines={2}>
            {label}
          </Text>
        </Pressable>
      </View>
      <View style={[styles.budget, recording && styles.budgetTrack]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Animated.View style={[styles.budgetUsed, { width: used.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }), opacity: recording ? 1 : 0 }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: space.sm },
  ring: { width: SIZE + RING * 2, height: SIZE + RING * 2, borderRadius: (SIZE + RING * 2) / 2, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  button: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: "center", justifyContent: "center", gap: space.xs, paddingHorizontal: space.md },
  pressed: { transform: [{ scale: 0.97 }] },
  label: { ...type.footnote, fontWeight: "700", fontSize: 15, lineHeight: 19, textAlign: "center" },
  clock: { fontSize: 34, lineHeight: 40, fontWeight: "700", ...tabular },
  budget: { width: SIZE, height: 3, borderRadius: 2, backgroundColor: "transparent", overflow: "hidden" },
  /** The track appears only while recording, so the bar reads as "this much of 15 seconds used". */
  budgetTrack: { backgroundColor: color.line },
  budgetUsed: { height: 3, borderRadius: 2, backgroundColor: color.bad },
});
