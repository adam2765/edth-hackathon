This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## This app

The transmitter: it stands in for a field radio and sends spoken reports to the coordinator (`POST /api/report` in the web app one folder up). Read `README.md` here, the Transmitter section of `../docs/plan.md`, `../docs/contracts.md`, and decisions 58 to 67 in `../DECISIONS.md`. The root `AGENTS.md` rules apply here too.

Where this app differs from the Expo template advice below:

- **Connection:** detect coordinators through the Metro/USB host, LAN discovery and, on iPhone, the phone's own Bonjour search (`modules/coordinator-search`, decision 248), show Connect per server, then automatically follow the newest running mission between reports. No mission picker or Join/Leave controls.
- **One screen, no Expo Router** (decision 65). Ignore the routing section below unless the app grows a second screen.
- **Transcription runs on the coordinator:** send compressed microphone/scenario audio. Do not restore phone model setup or transcription controls. The existing native dependencies are retained for installed-build compatibility.
- **Native development build, not Expo Go** (decision 59): installed builds still include the existing native audio dependencies. Build locally with `LANG=en_US.UTF-8 npx expo run:ios` (CocoaPods fails without a UTF-8 locale, decision 66) or `npx expo run:android`, then `npx expo start --dev-client`. iOS builds need a Mac with Xcode.
- **Signing comes from the environment** (decision 96): each teammate signs with their own Apple ID, so `app.config.ts` takes `TRANSMITTER_BUNDLE_ID` and `APPLE_TEAM_ID` over `app.json`. Do not change the bundle ID in `app.json` for one person's build. Setup steps: `../docs/setup.md`.
- **Update iPhones with `npm run phones`** (decision 207): it reopens the app on every connected iPhone, and builds and installs only after a native change. Use it rather than running `expo run:ios` and `devicectl` by hand. The choices live in `scripts/phones-plan.mjs`, tested in `../tests/phones-plan.test.ts`.
- **No EAS.** There is no paid Apple account, so iPhones get the app by cable from a Mac and Android by install file. Do not set up EAS build, submit or update.
- **A radio on the net, not a unit** (decision 208): the phone picks a mission and sends its code as `session`, but never joins, never sends a `callsign` from the microphone (the coordinator reads the sender from the words), never answers or speaks a question (the operator does, on the command post), and sends `lastPosition` only with no mission. Do not add these back. Scenario steps still send their own call sign.
- **Every source makes an `Utterance`** (`src/types.ts`) and goes down one send path. Add a new source (for example an open microphone) as another producer of utterances, not as a second path.
- **Reply types come from `../lib/geo/types.ts`** as type-only imports (decision 67). Do not copy them here.
- **Uploads use expo-file-system's `File`** (decision 64); React Native's `{ uri, name, type }` form part is rejected by Expo 58's fetch.
- Check with `npx tsc --noEmit` before calling a task done. There is no lint setup here yet.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
