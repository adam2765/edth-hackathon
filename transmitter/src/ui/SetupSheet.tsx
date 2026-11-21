// Everything you set once and then leave alone: language, coordinator, and developer tools. Kept off the main screen so that screen is only for reporting.
import { useState } from "react";
import { Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { FoundHost } from "../hosts";
import type { Lang } from "../types";
import { Button, Group, Row, Segmented, SwitchRow } from "./controls";
import type { Reach } from "./model";
import { color, space, type } from "./theme";

export interface SetupProps {
  visible: boolean;
  onClose: () => void;
  /** True while a report is being recorded or sent: choices that would change it are locked. */
  locked: boolean;

  languages: { id: Lang; label: string }[];
  language: Lang;
  onLanguage: (l: Lang) => void;

  hosts: FoundHost[];
  onConnectHost: (host: FoundHost) => void;
  serverUrl: string;
  onServerUrl: (v: string) => void;
  reach: Reach;

  developer: boolean;
  onDeveloper: (enabled: boolean) => void;

  playClips: boolean;
  onPlayClips: (v: boolean) => void;
  realTime: boolean;
  onRealTime: (v: boolean) => void;
}

function host(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export function SetupSheet(p: SetupProps) {
  const [hostsOpen, setHostsOpen] = useState(false);
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
            <Group
              title="Reports"
              footer="The area decides which place names the coordinator looks reports up in; in a mission, the mission’s area counts. The language is the one you speak: speech-to-text listens for it, and the operator’s questions are written in it. Scenarios use each report’s own language."
            >
              <View style={styles.padded}>
                <Segmented label="Language" options={p.languages} value={p.language} onChange={p.onLanguage} disabled={p.locked} />
              </View>
            </Group>

            <Group title="Coordinator" footer={reachText}>
              <Row label="Hosts" note={host(p.serverUrl)} onPress={() => setHostsOpen(!hostsOpen)} disabled={p.locked} />
              {hostsOpen ? <View>
                {p.hosts.map((host) => <Row key={host.id} label={host.name} note={host.ready ? host.url : "Starting…"} selected={p.serverUrl === host.url} onPress={() => { p.onConnectHost(host); setHostsOpen(false); }} disabled={p.locked || !host.ready} />)}
                {!p.hosts.length ? <Text style={[type.footnote, styles.padded]}>Looking for coordinators…</Text> : null}
              </View> : null}
            </Group>

            <Group title="Development">
              <SwitchRow label="Developer tools" note="Shows scenarios and connection override" value={p.developer} onValueChange={p.onDeveloper} disabled={p.locked} />
            </Group>
            {p.developer ? <Group title="Developer and demo settings" footer="The phone records audio; the coordinator transcribes it.">
              <Row label="Host override" right={<TextInput style={[styles.input, styles.address]} value={p.serverUrl} onChangeText={p.onServerUrl} editable={!p.locked} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="Coordinator address" />} />
              <SwitchRow label="Play scenario clips aloud" value={p.playClips} onValueChange={p.onPlayClips} disabled={p.locked} />
              <SwitchRow label="Keep the script’s timing" value={p.realTime} onValueChange={p.onRealTime} disabled={p.locked} />
            </Group> : null}
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
