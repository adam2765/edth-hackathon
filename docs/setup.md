# Setting up a computer

Step-by-step setup for a teammate's computer, written so a coding agent (Claude Code or Codex) can follow it. A person can follow it too. Checked on Friday 20 November on a MacBook (M1 Pro, macOS, Xcode 27.2, Node 24).

## For the agent doing this

- **A Mistral key is optional.** Offline mode (part 3) needs no key and no account. Hosted mode (part 4) is the only part that needs one. Never stop or wait for a key: if the person has none, set up offline mode and skip part 4.
- **Work through the parts in order and stop at the last one the person needs.** Every step ends with a check. Do not go on until the check passes.
- **Steps marked (person) need the human.** Say exactly what to do, wait until they say it is done, then run the check.
- **Ask before anything large or system-wide:** Homebrew packages, Xcode, Android Studio, or a model download. Say the size.
- **If the person does have a key, never ask for it in chat, and never print it.** They paste it into `.env.local` themselves.
- **Long-running servers** (the coordinator, Ollama, Metro) go in their own terminal or in the background. Do not wait for them to exit.
- **Setup changes no tracked file**, apart from the block `next dev` writes into `AGENTS.md` (leave that). Do not commit, push or deploy as part of setup.
- **At the end, tell the person** what now runs, the versions, anything skipped or failed, and the daily start commands (part 7).

## Which parts

| Part | Needed for | Time |
|---|---|---|
| 1. Tools | everyone | 5 min, more if Node is missing |
| 2. Web app | everyone | 5 min |
| 3. Offline mode | everyone; needs no key | 20 min, plus 3.6 GB of downloads |
| 4. Hosted mode | only with a Mistral key; optional | 5 min |
| 5. Transmitter on an iPhone | testing on a phone; Mac only | 30 to 45 min the first time |
| 6. Transmitter on Android | Android phones | |
| 7. Daily start | everyone | |

The coordinator runs in one of two modes. **Offline mode** runs speech-to-text (Whisper, in whisper-server) and intent extraction (Ollama) on this computer and calls nothing outside it [83, 195]. **Hosted mode** calls Mistral for both, and needs a key. Both place reports the same way.

## 1. Tools

```bash
git --version
node --version     # 22.13 or newer in the 22 line, or 24.3 or newer (Expo's range); 24 is what we use
npm --version
```

If Node is missing or too old, ask the person how they install tools: Homebrew (`brew install node@24`), nvm, or the installer from nodejs.org. On a Mac, Homebrew is the easiest way to get the rest of the tools below.

## 2. Web app

```bash
git clone git@github.com:beverage/edth-hackathon.git    # or the https:// address, the repo is public
cd edth-hackathon
npm install
npm test
```

Check: every test passes. The tests need no key and no network. No `.env.local` is needed for offline mode.

## 3. Offline mode

No key needed. Two servers run beside the coordinator: Ollama for extraction, and whisper-server for speech-to-text, so the transmitter's Server mode and the browser's microphone work offline too. The transmitter's phone modes send text and need only Ollama. The two models need about 5 GB of free memory.

Install Ollama 0.40 or newer. Version 0.8 cannot run Ministral 3.

```bash
brew install ollama        # or `brew upgrade ollama`; on Linux or Windows, the installer from ollama.com
ollama --version
```

If the Ollama desktop app is running, quit it: it holds port 11434 and ignores the settings below. Then start the server in its own terminal:

```bash
OLLAMA_NO_CLOUD=1 OLLAMA_KEEP_ALIVE=-1 ollama serve
```

`OLLAMA_NO_CLOUD=1` stops Ollama from handing a request to its hosted models [42]. `OLLAMA_KEEP_ALIVE=-1` keeps the model in memory between reports.

Check: `curl -s http://127.0.0.1:11434/api/version` prints a version of 0.40 or newer.

Download the model (3 GB, once):

```bash
ollama pull ministral-3:3b
ollama run ministral-3:3b "Reply with OK"
```

Check: the second command answers.

Install whisper.cpp and ffmpeg (ffmpeg turns the browser's webm into the WAV Whisper reads):

```bash
brew install whisper-cpp ffmpeg     # on Linux, build whisper.cpp from github.com/ggml-org/whisper.cpp and install ffmpeg
whisper-server --help | head -3
```

Check: the second command prints whisper-server's usage.

Start speech-to-text in its own terminal. The first start downloads two models into `models/`, once, and checks their checksums: Whisper large-v3-turbo (574 MB) and Silero VAD (1 MB), which finds the speech so that silence comes back as no words. If the Whisper file is already on the computer, set `WHISPER_MODEL_FILE` to its path to copy it instead.

```bash
npm run stt
```

Check: it prints `Whisper large-v3-turbo and Silero VAD ready (checksums verified)`, and after a few seconds `curl -s http://127.0.0.1:3118/health` prints `{"status":"ok"}`. It listens on this computer only. `WHISPER_URL` moves it to another port; set the same value for the coordinator.

Start the coordinator in offline mode on port 3117, not 3000, in its own terminal. If one is already on 3117 (`lsof -nP -iTCP:3117 -sTCP:LISTEN` shows it), stop it first.

```bash
PROVIDER_MODE=local npm run dev -- -p 3117
```

Before it starts, `predev` copies the browser voice's runtime into `public/` and tries to download the 77 MB Ukrainian voice. A failed download is only a warning: the page then uses the system voice.

Check: its log shows `[stt] whisper-server ready at http://127.0.0.1:3118`, and within about 10 s `[extractor] ollama:ministral-3:3b ready for Vincennes, France` and the same for `central Kyiv, Ukraine`. Then send a typed report:

```bash
curl -s -X POST http://localhost:3117/api/report --form-string area=vincennes --form-string "text=I'm at Bérault metro."
```

Expect JSON with `"status":"resolved"` and `"feature_id":"node/9415191169"`, and `timings_ms.extract` around 2,000 on an M1 Pro. Then send a spoken one, a scenario clip:

```bash
curl -s -X POST http://localhost:3117/api/report --form-string area=vincennes --form-string language=fr -F audio=@transmitter/scenarios/audio/vincennes-tracks/t2.m4a
```

Expect `"transcript":"Je suis à la mairie de Vincennes."`, `"status":"resolved"` at the Mairie de Vincennes, and `timings_ms.stt` around 1,000 to 1,500 on an M1 Pro (more while something else uses the GPU). (person) Open http://localhost:3117 in a browser to see the map, and type or say a report there.

(person) To prove nothing leaves the computer, turn off Wi-Fi and send the `curl` again. It should still be placed.

`LOCAL_EXTRACT_MODEL=ministral-3:8b` uses the larger model: same accuracy on our scenarios, about 5 s per report [84].

## 4. Hosted mode

Optional. Only if the person has a Mistral key; otherwise skip to part 5. Hosted mode adds speech-to-text on the server, so the browser's microphone and the transmitter's Server mode work. It needs the internet.

(person) Create `.env.local` and paste the key after `MISTRAL_API_KEY=`.

```bash
cp .env.example .env.local
```

Check (person), without printing the key: `grep -c '^MISTRAL_API_KEY=.' .env.local` prints `1`. An agent cannot run this: a guard hook stops agents reading `.env` files. The check after the next step shows whether the key works. A key exported in the shell works too.

Stop the offline coordinator, then start it without `PROVIDER_MODE`:

```bash
npm run dev -- -p 3117
```

Check: the `curl` from part 3 gives the same answer, with `timings_ms.extract` under about 1,500. If the log says `No extraction key`, the key is missing; go back to offline mode, or fix `.env.local` and restart.

## 5. Transmitter on an iPhone

Mac only. The transmitter is a native development build; Expo Go cannot run it [59]. See [transmitter/README.md](../transmitter/README.md) for what the app does.

### Tools

(person) Install Xcode from the App Store and open it once, so it finishes installing its parts.

```bash
xcode-select -p            # expect /Applications/Xcode.app/Contents/Developer
brew install cocoapods     # if `pod --version` fails; a warning about UTF-8 is expected, the build sets LANG
```

If `xcode-select -p` shows `/Library/Developer/CommandLineTools`, (person) run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.

Optional check without a phone: `cd transmitter && npm install && LANG=en_US.UTF-8 npx expo run:ios` builds for the simulator and needs no signing.

### Signing

Each of us signs the app with our own Apple ID; a free one works. A bundle ID belongs to one Apple team, and `dev.voicetomap.transmitter` is already Alex's, so everyone else picks their own [96].

(person) In Xcode: Settings → Accounts → add your Apple ID.

Find the team ID:

```bash
defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier | grep -E 'teamID|teamName|isFreeProvisioningTeam'
```

It is the 10-character `teamID`. With several teams, ask the person which one.

### The phone

(person) On the iPhone:

1. Connect it to the Mac with a cable, unlock it, and tap Trust.
2. Settings → Privacy & Security → Developer Mode → on. The phone restarts.

Check: `xcrun devicectl list devices` lists the phone, and its state is not `unavailable`.

### Build and install

```bash
cd transmitter
npm install
export APPLE_TEAM_ID=<team ID>
export TRANSMITTER_BUNDLE_ID=dev.voicetomap.transmitter.<first name>
LANG=en_US.UTF-8 npx expo run:ios --device "<phone name from devicectl>"
```

- `LANG=en_US.UTF-8` matters: CocoaPods fails without a UTF-8 locale [66].
- The first build takes several minutes.
- `ios/` is generated and ignored by git. If you change the team or bundle ID after a build, run `npx expo prebuild --clean --platform ios` first.

(person) With a free Apple ID, the first launch is refused until you allow it on the phone: Settings → General → VPN & Device Management → your Apple ID → Trust.

### Run it

The app loads its code from Metro on the Mac. Keep Metro running in its own terminal:

```bash
cd transmitter && npx expo start --dev-client
```

Open the app with the Mac's network name. That works over the cable alone, and it survives address changes:

```bash
xcrun devicectl device process launch --device "<phone>" --terminate-existing \
  --payload-url "exp+transmitter://?__expo_url=http%3A%2F%2F$(scutil --get LocalHostName).local%3A8081&__expo_disable_fab=1&__expo_disable_onboarding=1" \
  "$TRANSMITTER_BUNDLE_ID"
```

(person) When iOS asks to "find devices on your local network", allow it.

Check: the app opens, and the dot beside the call sign turns green. The app sends reports to the coordinator on this Mac, port 3117 [78].

(person) Open `http://localhost:3117/cp` on the Mac and open a mission from its Missions menu (Vincennes, any name; a start point is optional). In the app, the mission appears under "Join a mission"; tap Join.

Check: the app shows the mission's name with Leave, the talk button says "Hold to talk", and the command post lists the call sign. Reports need a mission on this coordinator [114].

(person) Choose "Phone: base" or "Phone: small" and play the Vincennes scenario. That works in either mode. The first time, the app downloads its Whisper model (56 or 181 MB), so the phone needs the internet once. The "Server" mode works only with hosted mode (part 4).

## 6. Transmitter on Android

Install the Android tools listed in the [README](../README.md#run-locally), then use [Build and try changes without Android Studio](../README.md#build-and-try-changes-without-android-studio). It sets Node, JDK and SDK paths, generates the Android project, builds with Gradle and installs over USB; Studio stays closed. Check: `adb devices -l` lists the phone as `device`, and the native build installs Transmitter. If authorization is stuck, revoke USB debugging authorizations on the phone, reconnect and accept the prompt.

For later starts, use [Daily use: USB Android phone, no Studio](../README.md#daily-use-usb-android-phone-no-studio). It runs the built coordinator instead of the development reloader, and Metro on 8082 over USB. Check: the command post stays Connected, and the phone shows a green coordinator dot. Android's microphone now records PCM WAV for Whisper, so **Phone: base** works with the offline coordinator; **Server** still needs hosted mode. Check: join the same mission, hold the button until red, say a place, release, and look for the report on the command post. Recognition can ask back if it mishears a name.

## 7. Daily start

Each in its own terminal, from the repo root:

```bash
OLLAMA_NO_CLOUD=1 OLLAMA_KEEP_ALIVE=-1 ollama serve     # offline mode
npm run stt                                             # offline mode: speech-to-text on this computer
PROVIDER_MODE=local npm run dev -- -p 3117              # offline mode; with a key, `npm run dev -- -p 3117` is hosted mode
cd transmitter && npx expo start --dev-client            # phone testing only
```

## When something fails

| What you see | Why | Fix |
|---|---|---|
| Coordinator log: `No extraction key` or `No speech-to-text key` | Hosted mode with no Mistral key | Run offline mode, `PROVIDER_MODE=local` (part 3), or add a key (part 4) |
| `Processing failed` in hosted mode | Missing or wrong Mistral key, or no internet | Check `.env.local` and restart the coordinator, or use offline mode |
| `pod install` fails with an encoding error | No UTF-8 locale | Prefix the build with `LANG=en_US.UTF-8` [66] |
| Xcode: the bundle identifier is not available | Another team owns that bundle ID | Set your own `TRANSMITTER_BUNDLE_ID`, then `npx expo prebuild --clean --platform ios` |
| Expo asks to choose a development team | `APPLE_TEAM_ID` is not set | Set it (part 5, Signing) |
| The phone will not open the app | Developer Mode is off, or the Apple ID is not trusted yet | Part 5, The phone; then VPN & Device Management |
| Expo Go cannot open the app | It needs native modules | Use the development build [59] |
| App: "no answer from the coordinator" | Opened with a numeric address, local network access denied, or no coordinator on 3117 | Launch with the `.local` name; allow local network; check `lsof -nP -iTCP:3117 -sTCP:LISTEN` |
| `ollama pull ministral-3:3b` asks for a newer version | Ollama older than 0.40 | `brew upgrade ollama` |
| Ollama settings have no effect | The desktop app is serving port 11434 | Quit the app, then `ollama serve` |
| The first report after a start is slow or times out | The model is still loading | Wait for the two `ready for` lines |
| A report with audio gets HTTP 503, "Speech-to-text on the coordinator is not running" | whisper-server is not started, or still loading its model | `npm run stt` (part 3); wait for `curl -s http://127.0.0.1:3118/health` to print `{"status":"ok"}` |
| `npm run stt`: `whisper-server not found` or `ffmpeg not found` | whisper.cpp or ffmpeg is not installed | `brew install whisper-cpp ffmpeg` |
| Port 3117 is busy | A coordinator is already running | Use that one, or stop it |
