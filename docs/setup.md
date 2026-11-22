# Setup and daily use

Install tools once. Daily use is Build, Start, Stop.
Do not install large tools or download models on someone’s computer without asking first.
Agents never read `.env` files or print keys. Setup does not push or deploy the live site.

## Install once

| Needed for | Tools |
|---|---|
| Everyone | Git, Node.js 24.3+ and npm; a current browser |
| Local inference | Current Ollama and `ministral-3:3b` (about 3 GB on disk; about 4 GB of RAM once running, with the 8,192-token context and the areas' prompts kept [254]); whisper.cpp’s `whisper-server` and ffmpeg on PATH; Whisper turbo by default, base with `npm start light` and Silero VAD (about 635 MB for both speech models and VAD, checksum-verified by Build) |
| Android builds | Android SDK Platform 37, Build-Tools 37.0.0, Platform-Tools, Command-line Tools, NDK 27.1.12297006, CMake 3.22.1; a JDK, such as Android Studio’s bundled JDK |
| iPhone builds | macOS, Xcode, Command Line Tools, CocoaPods, Apple ID |

On Android, enable Developer options → USB debugging, connect a USB data cable, unlock,
and approve debugging. Check: `adb devices -l` lists the phone as `device`.
Android Studio supplies the tools but can stay closed during builds and daily use.
On Windows, set `ANDROID_HOME` and `JAVA_HOME` if they differ from the normal Studio paths.

On an iPhone, connect to the Mac, tap Trust, enable Developer Mode and allow local network
access. Add your Apple ID in Xcode → Settings → Accounts. Export `APPLE_TEAM_ID` and your
own `TRANSMITTER_BUNDLE_ID` before starting; do not change app.json for personal signing.
Check: `xcrun devicectl list devices` lists the phone as available. With a free account,
trust the developer under Settings → General → VPN & Device Management after installation.
The install expires after seven days; expired signing needs a fresh signed native install
(see advanced console use).

From the repo root:

```bash
npm ci
npm ci --prefix transmitter
npm run setup --prefix transmitter
ollama pull ministral-3:3b
npm run basemap -- vincennes
```

The last line saves the map for offline mode: the Vincennes tiles, fonts and icons from
OpenFreeMap, 28 MB of download, into `public/basemap/`, which is not in git. Run it once on
each computer, with internet, before Start. Run it again for `kyiv` (13 MB) and `izium`
(6 MB), one area a run; the three are 75 MB on disk. Check: each run ends with "Done" and
the areas saved so far. Without it the map uses OpenFreeMap when there is internet, and a
plain background with the units when there is none.

The phone records compressed audio and sends it to the coordinator; no speech model is
prepared or downloaded on the phone. Its setup command prepares the native launcher’s project-specific startup instructions. Existing native libraries stay compatible, so this change needs a JavaScript reload,
not a native rebuild. Scenarios use their compressed audio through the same report path.

For local speech, install whisper.cpp and ffmpeg once (on macOS: `brew install whisper.cpp ffmpeg`). Build prepares the pinned Whisper turbo, base and VAD models on the host, about 635 MB for both speech models and VAD.
Ask before these system installs and large downloads. Start validates existing models and
starts whisper-server; it does not download them. `WHISPER_MODEL_FILE` can provide a local
copy of the pinned turbo model instead of a download.

The web build prepares the map worker and browser speech runtime, and tries to fetch a
77 MB Ukrainian reply voice. If unavailable, the browser uses its system voice. Setup
and model downloads need internet; runtime local transcription does not.

## Daily use

From the project directory:

```bash
npm run build
npm start
npm stop
```

- **Build** checks file contents and dependencies. It rebuilds changed components and loads
  the phone app if changed or missing. No connected phone means only the coordinator is built.
- **Start** stops existing project servers and starts all required servers, including local Whisper speech-to-text and the
  phone’s code server. When ready, it prints the command-post URL and opens it; it does not
  launch the phone app or build code.
- **Stop** stops project components, the connected phone app, and the internal controller.
  Mission logs and phone settings are kept. Closing a browser does not stop the servers.

Use `npm start light` for lower memory use; plain `npm start` selects regular mode. Use one connected phone; it is remembered. Unlock and approve USB
trust/debugging. After editing code, repeat Build, then Start. If a build stops a service,
Start brings the servers back. A build with unchanged source reuses its output.

On the phone, open Transmitter and tap **Connect** when the coordinator is detected.
If no mission is running, **Waiting for mission** indicates it. On the command post press
**Start mission**; the phone follows the newest running mission automatically, with no join step. **Stop mission** stops reports and keeps
the mission log for replay. Restarting the servers preserves open missions.

Hosts lists discovered reachable servers. The phone automatically follows the newest running mission, switching only between reports. Developer tools has a manual
address override, scenarios, test clips and timings. The area comes from the mission.
Voice-to-text is on the coordinator, with no phone provider/model controls.

Android USB uses reverse forwarding; Start restores it without launching the app. On an
iPhone the app reaches the host’s `.local` name. Both phones also search the local network for
coordinators themselves; after Connect the app follows that coordinator to a new address, so a Mac
that macOS renamed, or that moved to another network, is found again. An Android phone off the
cable needs a release build: `transmitter/README.md`, "An Android phone off the cable". iPhone builds still need Mac/Xcode and
signing; free provisioning expires after seven days. Windows and physical-phone deployment
paths need validation on the relevant hardware. Offline inference works without internet,
and so does the map for an area saved with `npm run basemap -- <area>`. The map's corner says
"Map saved on this computer" when it is in use. `BASEMAP=hosted` or `BASEMAP=local` before
Start picks the map whatever the mode.

## Advanced console use

Stop the managed servers before running a component directly. Ctrl+C stops that console’s
component. The three normal commands above remain the daily procedure.

| Component | Direct command |
|---|---|
| Web build | `npm run build:web` |
| Coordinator | `npm run start:coordinator` |
| Ollama | `npm run start:ollama` |
| Local speech-to-text | `npm run start:stt` (after Build prepares models) |
| Phone code server | `npm run start:phone` |
| Web development server | `npm run dev -- -p 3117` |
| Save the map for offline mode | `npm run basemap -- vincennes` (then restart the coordinator) |

`npm start` selects regular mode: Whisper large-v3-turbo and a resident Ollama model.
`npm start light` selects Whisper base and releases Ollama after 30 seconds of inactivity;
the next report reloads it, adding latency. Base may recognize speech less accurately.
The choice applies to that start only; the next plain Start returns to regular mode.
Build prepares both speech models once, so changing mode needs only Start.

The remembered provider mode is local. Keys never belong in chat, launcher configuration
or Git. Direct coordinator commands can use `.env.local` if needed.

For local-only Ollama in a macOS console:

```bash
OLLAMA_NO_CLOUD=1 OLLAMA_KEEP_ALIVE=-1 OLLAMA_CONTEXT_LENGTH=8192 ollama serve
```

The coordinator asks Ollama for a context of 8,192 tokens on every call, so the extraction
prompt (about 4,560 tokens) is never cut, however Ollama was started. Starting Ollama at the same
size saves one reload of the model at the first report. At 4,096, Ollama cut the prompt to
2,051 tokens without an error, and `.run/launcher.log` said `truncating input prompt` (decision 254).

On PowerShell set the corresponding `$env:` variables first. Native builds remain available
in transmitter with `npm run android` or `npm run ios` (Mac only). For iOS set
`LANG=en_US.UTF-8`, `APPLE_TEAM_ID` and `TRANSMITTER_BUNDLE_ID` first. After changing signing,
regenerate the iOS project with Expo prebuild. No EAS is used.

The optional `.run/config.json` stores the remembered phone and ports. Most users never
edit it. Detailed logs are in `.run/launcher.log`. Build fingerprints and runtime process
records live in `.run`; the coordinator’s normal build stays in `.next`, and mission data
stays in `.data/sessions`. There are no release checkouts or separate launcher screen.

## When something fails

- **Missing coordinator build:** run Build, then Start.
- **Missing Ollama model:** install `ministral-3:3b` once, then Start.
- **Phone not detected:** unlock, reconnect and accept trust/debugging; use one connected phone. An iPhone counts as connected when `xcrun xctrace list devices` lists it under `== Devices ==`. One under `== Devices Offline ==` is only remembered by Xcode and does not count.
- **"More than one phone is connected":** leave only the phone you use connected. An iPhone that Xcode reaches over Wi-Fi is under `== Devices ==` too and counts with no cable, so the second phone can be one on the same network. Phones that Xcode only remembers no longer cause this.
- **Coordinator without a mission:** use Start mission on the command post.
- **Map is a plain background, "Base map not available":** no internet and no saved map. Run `npm run basemap -- vincennes` with internet, then Start again. Units and tracks draw meanwhile.
- **Map is coarse or empty away from the area:** only the tiles around the area are saved.
- **Unrelated process on a port:** stop it in its own console; unverified processes are not killed.
- **Build/start error:** the console gives the cause; details are in `.run/launcher.log`.

Each command retires old project controllers before using the current code. Shutdown
scans processes by checkout path, working directory and parent/child ownership across all
ports, including servers started directly and orphan workers. It requests a clean stop,
forces termination after a timeout, and rescans before reporting Stopped. Inspection or
cleanup failure is an error; a controller’s old Stopped flag is never accepted as proof.
Ollama and Whisper on their configured local ports and project-owned model processes are included;
unrelated services and the shared ADB server are left alone.

To reclaim old speech-model storage on an Android development build, first load the updated
app, then run this with the phone connected. It removes only the two old model files and
keeps app settings:

```bash
adb shell run-as dev.voicetomap.transmitter rm -f files/models/ggml-base-q5_1.bin files/models/ggml-small-q5_1.bin
```

Whisper keeps upstream port 3118. The private controller uses 3116 and migrates an old
conflicting setting automatically. The receiver remains on 3117 and Metro on 8082.

Several Safari tabs can have established connections to one coordinator listener on 3117.
Those client connections are not extra servers. Cleanup targets server listeners and owned
workers, leaving browser processes alone. Startup requires the newly launched coordinator
to confirm it bound its port; an old server’s healthy response cannot produce a false Ready.
Cleanup finishes even when the operation that requested it was cancelled.

The native phone launcher now says `npm start`, with `npm start light` in its help text.
This wording is compiled into the app; run Build once to install the updated binary.

The transmitter is a radio: begin live reports with the sender’s call sign. The coordinator
reads it from the words against the mission roster; held reports and questions are handled
on the command post. Green Reporting means a connected coordinator and an active mission.
Advanced fleet updates remain available with `npm run phones --prefix transmitter`; keep
the normal Build/Start/Stop procedure for daily use.
