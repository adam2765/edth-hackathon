// React Native ships its core, Hermes and its dependencies as prebuilt Debug and Release copies.
// A build step swaps in the copy the build needs and writes which one is in place to a
// .last_build_configuration file. pod install deletes that file but keeps the copy, and with no
// file the step assumes Debug. So a Release build, then a pod install, then a Debug build links
// the Release core and fails: undefined RCTReconnectingWebSocket and Sealable (decision 254).
//
// This adds a few lines to the Podfile's post_install: after every pod install, mark the copy
// unknown, so the next build puts the right one in place with React Native's own step.
const { withPodfile } = require("@expo/config-plugins");
const { mergeContents } = require("@expo/config-plugins/build/utils/generateCode");

const ruby = `    # Mark React Native's prebuilt Debug/Release copies unknown after every pod install, so the
    # next build swaps in the right one (transmitter/plugins/withPrebuiltFlavorCheck.js).
    {
      'React-Core-prebuilt' => 'ReactNativeCore-artifacts',
      'hermes-engine' => 'hermes-engine-artifacts',
      'ReactNativeDependencies' => 'ReactNativeDependencies-artifacts',
    }.each do |pod, artifacts|
      dir = File.join(installer.sandbox.root.to_s, pod)
      tarballs = File.join(installer.sandbox.root.to_s, artifacts)
      next unless File.directory?(dir)
      next unless %w[debug release].all? { |flavor| Dir.glob(File.join(tarballs, "*-#{flavor}.tar.gz")).any? }
      File.write(File.join(dir, '.last_build_configuration'), 'unknown')
    end`;

/** @type {import("@expo/config-plugins").ConfigPlugin} */
module.exports = function withPrebuiltFlavorCheck(config) {
  return withPodfile(config, (podfile) => {
    const merged = mergeContents({
      tag: "voicetomap-prebuilt-flavor-check",
      src: podfile.modResults.contents,
      newSrc: ruby,
      anchor: /post_install do \|installer\|/,
      offset: 1,
      comment: "#",
    });
    if (!merged.didMerge && !merged.contents.includes("voicetomap-prebuilt-flavor-check")) {
      throw new Error("withPrebuiltFlavorCheck: no post_install block in the Podfile to add to.");
    }
    podfile.modResults.contents = merged.contents;
    return podfile;
  });
};
