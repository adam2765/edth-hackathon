// Small shared controls: segmented choice, grouped list, rows, buttons.
import { Ionicons } from "@expo/vector-icons";
import { Children, type ComponentProps, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { TOUCH, color, radius, space, type } from "./theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

/** A choice between a few options that are all visible at once. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  label,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <View style={[styles.segmented, disabled && styles.dimmed]} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => !disabled && onChange(o.id)}
            style={[styles.segment, on && styles.segmentOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled }}
            accessibilityLabel={o.label}
          >
            <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A titled block of rows with hairlines between them, as in the system Settings app. */
export function Group({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group}>
      {title ? <Text style={styles.groupTitle}>{title}</Text> : null}
      <View style={styles.groupBody}>
        {rows.map((row, i) => (
          <View key={i}>
            {i > 0 ? <View style={styles.hairline} /> : null}
            {row}
          </View>
        ))}
      </View>
      {footer ? <Text style={styles.groupFooter}>{footer}</Text> : null}
    </View>
  );
}

/** One row of a group: a label, an optional second line, and something on the right. */
export function Row({
  label,
  note,
  right,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  note?: string;
  right?: ReactNode;
  /** Shows a checkmark: the row is the current choice. */
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const body = (
    <>
      <View style={styles.rowText}>
        <Text style={type.body}>{label}</Text>
        {note ? <Text style={type.footnote}>{note}</Text> : null}
      </View>
      {right}
      {selected ? <Ionicons name="checkmark" size={20} color={color.accent} /> : null}
    </>
  );
  if (!onPress) return <View style={[styles.row, disabled && styles.dimmed]}>{body}</View>;
  return (
    <Pressable
      onPress={() => !disabled && onPress()}
      style={({ pressed }) => [styles.row, pressed && !disabled && styles.rowPressed, disabled && styles.dimmed]}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={note ? `${label}, ${note}` : label}
    >
      {body}
    </Pressable>
  );
}

export function SwitchRow({ label, note, value, onValueChange }: { label: string; note?: string; value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <Row
      label={label}
      note={note}
      right={<Switch value={value} onValueChange={onValueChange} trackColor={{ true: color.accent, false: color.line }} ios_backgroundColor={color.line} accessibilityLabel={label} />}
    />
  );
}

/**
 * primary: the one thing to do next. secondary: a real action that is not the main one.
 * quiet: a text-only action in a header or beside a title.
 */
export function Button({
  label,
  icon,
  onPress,
  kind = "secondary",
  disabled,
  busy,
  muted,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  kind?: "primary" | "secondary" | "quiet";
  disabled?: boolean;
  busy?: boolean;
  /** For a quiet button that is a way out, not a way forward: plain text, no tint. */
  muted?: boolean;
}) {
  const fg = kind === "primary" ? color.onAccent : kind === "quiet" ? (muted ? color.textDim : color.accent) : color.text;
  return (
    <Pressable
      onPress={() => !disabled && !busy && onPress()}
      style={({ pressed }) => [styles.button, kind === "primary" && styles.buttonPrimary, kind === "secondary" && styles.buttonSecondary, pressed && !disabled && styles.buttonPressed, disabled && styles.dimmed]}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      accessibilityLabel={label}
      hitSlop={kind === "quiet" ? 8 : 0}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={[styles.buttonText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dimmed: { opacity: 0.45 },
  segmented: { flexDirection: "row", backgroundColor: color.raised, borderRadius: radius.control, padding: 2, minHeight: TOUCH },
  segment: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: radius.control - 2, paddingHorizontal: space.sm },
  segmentOn: { backgroundColor: color.lifted },
  segmentText: { ...type.footnote, fontWeight: "600" },
  segmentTextOn: { color: color.text },
  group: { gap: space.sm },
  groupTitle: { ...type.footnote, paddingHorizontal: space.lg },
  groupFooter: { ...type.footnote, paddingHorizontal: space.lg },
  groupBody: { backgroundColor: color.surface, borderRadius: radius.panel, overflow: "hidden" },
  hairline: { height: StyleSheet.hairlineWidth, backgroundColor: color.line, marginLeft: space.lg },
  row: { minHeight: TOUCH, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  rowPressed: { backgroundColor: color.raised },
  rowText: { flex: 1, gap: 2 },
  button: { minHeight: TOUCH, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, paddingHorizontal: space.lg, borderRadius: radius.control },
  buttonPrimary: { backgroundColor: color.accent },
  buttonSecondary: { backgroundColor: color.raised },
  buttonPressed: { opacity: 0.7 },
  buttonText: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
});
