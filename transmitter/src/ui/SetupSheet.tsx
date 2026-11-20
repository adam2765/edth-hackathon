// Everything you set once and then leave alone: who you are, which coordinator, where speech
// becomes text, and sound. Kept off the main screen so that screen is only for reporting.
import { Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { PHONE_MODELS, STT_MODES, type PhoneMode, type SttMode } from "../stt";
import type { AreaId } from "../types";
import { Button, Group, Row, Segmented, SwitchRow } from "./controls";
import type { Reach } from "./model";
import { color, space, type } from "./theme";

export interface SetupProps {
  visible: boolean;
  onClose: () => void;
  /** True while a report is being recorded or sent: choices that would change it are locked. */
  locked: boolean;

  callsign: string;
  onCallsign: (v: string) => void;
  areas: { id: AreaId; label: string }[];
  area: AreaId;
  onArea: (a: AreaId) => void;

  serverUrl: string;
  onServerUrl: (v: string) => void;
  /** The coordinator on the computer this app was loaded from, when known. */
  localCoordinator: string | null;
  liveSite: string;
  reach: Reach;

  sttMode: SttMode;
  onSttMode: (m: SttMode) => void;
  modelReady: Record<PhoneMode, boolean>;
  downloadPct: number | null;
  onDownload: () => void;
  useHints: boolean;
  onUseHints: (v: boolean) => void;

  speakReplies: boolean;
  onSpeakReplies: (v: boolean) => void;
  playClips: boolean;
  onPlayClips: (v: boolean) => void;
  realTime: boolean;
  onRealTime: (v: boolean) => void;
}

const STT_NOTES: Record<SttMode, string> = {
  server: "On the coordinator. The recording is sent.",
  "phone-base": "On this phone, the faster model. Only the words are sent.",
  "phone-small": "On this phone, the more accurate model. Only the words are sent.",
};

function host(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export function SetupSheet(p: SetupProps) {
  const phoneMode = p.sttMode === "server" ? null : p.sttMode;
  const needsModel = phoneMode !== null && !p.modelReady[phoneMode];
  const reachText =
    p.reach === "ok"
      ? "The coordinator is answering."
      : p.reach === "checking"
        ? "Checking the coordinator…"
        : "No answer from the coordinator at this address. Check that it is running, and that this phone and the computer are on the same network.";

  return (
    <Modal visible={p.visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={p.onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.sheet} edges={Platform.OS === "ios" ? ["bottom"] : ["top", "bottom"]}>
          <View style={styles.bar}>
            <Text style={type.headline} accessibilityRole="header">
              Setup
            </Text>
            <View style={styles.done}>
              <Button label="Done" kind="quiet" onPress={p.onClose} />
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
            <Group title="This unit" footer="The area decides which place names the coordinator looks reports up in.">
              <Row
                label="Call sign"
                right={
                  <TextInput
                    style={styles.input}
                    value={p.callsign}
                    onChangeText={(t) => p.onCallsign(t.toUpperCase())}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    returnKeyType="done"
                    maxLength={16}
                    placeholder="ALPHA 1"
                    placeholderTextColor={color.textDim}
                    selectionColor={color.accent}
                    accessibilityLabel="Call sign"
                  />
                }
              />
              <View style={styles.padded}>
                <Segmented label="Area" options={p.areas} value={p.area} onChange={p.onArea} disabled={p.locked} />
              </View>
            </Group>

            <Group title="Coordinator" footer={reachText}>
              {p.localCoordinator ? (
                <Row
                  label="This Mac"
                  note={`The computer this app loads from: ${host(p.localCoordinator)}`}
                  selected={p.serverUrl === p.localCoordinator}
                  onPress={() => p.onServerUrl(p.localCoordinator as string)}
                  disabled={p.locked}
                />
              ) : null}
              <Row label="Live site" note={host(p.liveSite)} selected={p.serverUrl === p.liveSite} onPress={() => p.onServerUrl(p.liveSite)} disabled={p.locked} />
              <Row
                label="Address"
                right={
                  <TextInput
                    style={[styles.input, styles.address]}
                    value={p.serverUrl}
                    onChangeText={p.onServerUrl}
                    editable={!p.locked}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="done"
                    selectionColor={color.accent}
                    accessibilityLabel="Coordinator address"
                  />
                }
              />
            </Group>

            <Group title="Speech-to-text" footer="Phone models are downloaded once from Hugging Face and kept on this phone.">
              {STT_MODES.map((m) => {
                // A full sentence, so a line break can never leave a stray separator at the start of a line.
                const size = m.id === "server" ? "" : ` ${PHONE_MODELS[m.id].mb} MB, ${p.modelReady[m.id] ? "downloaded" : "not downloaded yet"}.`;
                return (
                  <Row
                    key={m.id}
                    label={m.label}
                    note={`${STT_NOTES[m.id]}${size}`}
                    selected={p.sttMode === m.id}
                    onPress={() => p.onSttMode(m.id)}
                    disabled={p.locked || p.downloadPct !== null}
                  />
                );
              })}
              {needsModel && phoneMode ? (
                <View style={styles.padded}>
                  <Button
                    kind="primary"
                    icon="cloud-download-outline"
                    label={p.downloadPct === null ? `Download the model (${PHONE_MODELS[phoneMode].mb} MB)` : `Downloading… ${p.downloadPct}%`}
                    busy={p.downloadPct !== null}
                    onPress={p.onDownload}
                  />
                </View>
              ) : null}
              {phoneMode ? <SwitchRow label="Place-name hints" note="Gives the phone’s model the area’s place names" value={p.useHints} onValueChange={p.onUseHints} /> : null}
            </Group>

            <Group title="Sound">
              <SwitchRow label="Speak questions" note="Reads the coordinator’s question aloud" value={p.speakReplies} onValueChange={p.onSpeakReplies} />
              <SwitchRow label="Play scenario clips aloud" note="Before each one is sent, so the room hears the report" value={p.playClips} onValueChange={p.onPlayClips} />
            </Group>

            <Group title="Scenarios">
              <SwitchRow label="Keep the script’s timing" note="Wait between reports as the script says" value={p.realTime} onValueChange={p.onRealTime} />
            </Group>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: color.bg },
  bar: { minHeight: 56, alignItems: "center", justifyContent: "center", paddingHorizontal: space.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  done: { position: "absolute", right: space.sm, top: 6 },
  body: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xxl, gap: space.xl, maxWidth: 560, width: "100%", alignSelf: "center" },
  padded: { paddingHorizontal: space.lg, paddingVertical: space.md },
  input: { ...type.body, minWidth: 120, textAlign: "right", paddingVertical: 6 },
  address: { flex: 1, fontSize: 15, color: color.textDim },
});
