// Expo reads app.json first and passes it in here. Each teammate signs the app with their own
// Apple ID, and an iOS bundle ID belongs to one Apple team, so both can come from the environment
// (decision 96; steps in ../docs/setup.md):
//   TRANSMITTER_BUNDLE_ID  your own, e.g. dev.voicetomap.transmitter.sam (default: the one in app.json)
//   APPLE_TEAM_ID          the 10-character team ID Xcode has for your Apple ID
// Keep them in transmitter/.env.local, which Expo's commands and `npm run phones` read. That script
// makes ios/ again when either changes; by hand, run `npx expo prebuild --clean --platform ios` (decision 199).
import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const bundleIdentifier = process.env.TRANSMITTER_BUNDLE_ID?.trim() || config.ios?.bundleIdentifier;
  const appleTeamId = process.env.APPLE_TEAM_ID?.trim() || config.ios?.appleTeamId;
  return {
    ...config,
    name: config.name ?? "Transmitter",
    slug: config.slug ?? "transmitter",
    ios: { ...config.ios, bundleIdentifier, ...(appleTeamId ? { appleTeamId } : {}) },
  };
};
