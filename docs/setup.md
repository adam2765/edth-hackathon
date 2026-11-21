# Setup and daily use

Install tools once. Daily use is Build, Start, Stop.
Do not install large tools or download models on someone’s computer without asking first.
Agents never read `.env` files or print keys. Setup does not push or deploy the live site.

## Install once

| Needed for | Tools |
|---|---|
| Everyone | Git, Node.js 24.3+ and npm; a current browser |
| Local inference | Current Ollama and `ministral-3:3b` (about 3 GB; about 4 GB free RAM) |
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
The install expires after seven days; use Reinstall phone when needed.

From the repo root:

```bash
npm ci
npm ci --prefix transmitter
npm run setup --prefix transmitter
ollama pull ministral-3:3b
```

Phone setup downloads and verifies the fixed 57 MB Whisper asset once. The web build
prepares the map worker and browser speech runtime, and tries to fetch a 77 MB Ukrainian
voice; if that voice is unavailable, the browser uses its system voice. No model download
or model selector is needed on the phone. These setup downloads require internet.

## Daily use

From the project directory:

```bash
npm run build
npm start
npm stop
```

- **Build** checks file contents and dependencies. It rebuilds changed components and loads
  the phone app if changed or missing. No connected phone means only the coordinator is built.
- **Start** stops existing project servers and starts all required servers, including the
  phone’s code server. When ready, it prints the receiver URL and opens it; it does not
  launch the phone app or build code.
- **Stop** stops project components, the connected phone app, and the internal controller.
  Mission logs and phone settings are kept. Closing a browser does not stop the servers.

No routine parameters. Use one connected phone; it is remembered. Unlock and approve USB
trust/debugging. After editing code, repeat Build, then Start. If a build stops a service,
Start brings the servers back. A build with unchanged source reuses its output.

On the phone, open Transmitter and tap **Connect** when the coordinator is detected.
If no mission is running, **Waiting for mission** indicates it. On the receiver press
**Start mission**; the phone joins the newest running mission automatically. **Stop mission** stops reports and keeps
the mission log for replay. Restarting the servers preserves open missions.

Hosts lists discovered reachable servers. The phone automatically follows the newest running mission, switching only between reports. Developer tools has a manual
address override, scenarios, test clips and timings. The area comes from the mission.
Voice-to-text on the phone is a fixed development stub, without provider/model controls.

Android USB uses reverse forwarding; Start restores it without launching the app. On an
iPhone the app reaches the host’s `.local` name. iPhone builds still need Mac/Xcode and
signing; free provisioning expires after seven days. Windows and physical-phone deployment
paths need validation on the relevant hardware. Offline inference works without internet;
map tiles still need it.

## Advanced console use

Stop the managed servers before running a component directly. Ctrl+C stops that console’s
component. The three normal commands above remain the daily procedure.

| Component | Direct command |
|---|---|
| Web build | `npm run build:web` |
| Coordinator | `npm run start:coordinator` |
| Ollama | `npm run start:ollama` |
| Phone code server | `npm run start:phone` |
| Web development server | `npm run dev -- -p 3117` |

Direct coordinator commands can use `.env.local`. For managed hosted inference, export
`PROVIDER_MODE=hosted` and your provider key before Start; after changing the environment,
Stop and Start again. Keys never belong in chat, launcher configuration or Git.

For local-only Ollama in a macOS console:

```bash
OLLAMA_NO_CLOUD=1 OLLAMA_KEEP_ALIVE=-1 OLLAMA_CONTEXT_LENGTH=4096 ollama serve
```

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
- **Phone not detected:** unlock, reconnect and accept trust/debugging; use one connected phone.
- **Coordinator without a mission:** use Start mission on the receiver.
- **Unrelated process on a port:** stop it in its own console; unverified processes are not killed.
- **Build/start error:** the console gives the cause; details are in `.run/launcher.log`.

Each command retires old project controllers before using the current code. Shutdown
scans processes by checkout path, working directory and parent/child ownership across all
ports, including servers started directly and orphan workers. It requests a clean stop,
forces termination after a timeout, and rescans before reporting Stopped. Inspection or
cleanup failure is an error; a controller’s old Stopped flag is never accepted as proof.
Ollama on the configured local port and project-owned Ollama processes are included;
unrelated services and the shared ADB server are left alone.
