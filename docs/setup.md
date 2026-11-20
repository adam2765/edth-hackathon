# Setting up a computer

Step-by-step setup for a teammate's computer, written so a coding agent (Claude Code or Codex) can follow it. A person can follow it too. Checked on Friday 20 November on a MacBook (M1 Pro, macOS, Xcode 27.2, Node 24).

## For the agent doing this

- **Work through the parts in order and stop at the last one the person needs.** Every step ends with a check. Do not go on until the check passes.
- **Steps marked (person) need the human.** Say exactly what to do, wait until they say it is done, then run the check.
- **Ask before anything large or system-wide:** Homebrew packages, Xcode, Android Studio, or a model download. Say the size.
- **Never ask for the Mistral key in chat, and never print it.** The person pastes it into `.env.local` themselves.
- **Long-running servers** (the coordinator, Ollama, Metro) go in their own terminal or in the background. Do not wait for them to exit.
- **Setup changes no tracked file**, apart from the block `next dev` writes into `AGENTS.md` (leave that). Do not commit, push or deploy as part of setup.
- **At the end, tell the person** what now runs, the versions, anything skipped or failed, and the daily start commands (part 6).

## Which parts

| Part | Needed for | Time |
|---|---|---|
| 1. Tools | everyone | 5 min, more if Node is missing |
| 2. Web app and coordinator | everyone | 10 min |
| 3. Offline mode | the offline demo, or testing with no Mistral key | 15 min, plus a 3 GB download |
| 4. Transmitter on an iPhone | testing on a phone; Mac only | 30 to 45 min the first time |
| 5. Transmitter on Android | Android phones; not yet tried by us | |
| 6. Daily start | everyone | |

## 1. Tools

```bash
git --version
node --version     # 22.13 or newer in the 22 line, or 24.3 or newer (Expo's range); 24 is what we use
npm --version
```

If Node is missing or too old, ask the person how they install tools: Homebrew (`brew install node@24`), nvm, or the installer from nodejs.org. On a Mac, Homebrew is the easiest way to get the rest of the tools below.

## 2. Web app and coordinator

```bash
git clone git@github.com:beverage/edth-hackathon.git    # or the https:// address, the repo is public
cd edth-hackathon
npm install
npm test
```

Check: every test passes. The tests need no key and no network.

(person) Create `.env.local` and add a Mistral key. Ask in the team chat if you do not have one.

```bash
cp .env.example .env.local
```

Check, without printing the key: `grep -c '^MISTRAL_API_KEY=.' .env.local` prints `1`. A key exported in the shell works too. Skip the key if this computer will only run offline mode (part 3).

Start the coordinator on port 3117, not 3000, in its own terminal:

```bash
npm run dev -- -p 3117
```

Before it starts, `predev` copies the browser voice's runtime into `public/` and tries to download the 77 MB Ukrainian voice. A failed download is only a warning: the page then uses the system voice.

Check that a typed report is placed:

```bash
curl -s -X POST http://localhost:3117/api/report --form-string area=vincennes --form-string "text=I'm at Bérault metro."
```

Expect JSON with `"status":"resolved"` and `"feature_id":"node/9415191169"`. (person) Open http://localhost:3117 in a browser to see the map.

## 3. Offline mode

The coordinator runs intent extraction on this computer through Ollama and calls nothing outside it [83]. There is no speech-to-text on the computer yet, so reports must arrive as text: the transmitter's phone modes, or typed. The model needs about 4 GB of free memory.

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

Stop any coordinator already on port 3117 (`lsof -nP -iTCP:3117 -sTCP:LISTEN` shows it), then start it in local mode:

```bash
PROVIDER_MODE=local npm run dev -- -p 3117
```

Check: within about 10 s its log shows `[extractor] ollama:ministral-3:3b ready for Vincennes, France` and the same for `central Kyiv, Ukraine`. The `curl` from part 2 then gives the same answer, with `timings_ms.extract` around 2,000 on an M1 Pro. A report with audio gets HTTP 501 and a message saying to use the phone's speech-to-text.

(person) To prove nothing leaves the computer, turn off Wi-Fi and send the `curl` again. It should still be placed.

`LOCAL_EXTRACT_MODEL=ministral-3:8b` uses the larger model: same accuracy on our scenarios, about 5 s per report [84].

## 4. Transmitter on an iPhone

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

(person) Play the Vincennes scenario: Server mode with the hosted coordinator (part 2), or a Phone mode with either. The phone modes download a Whisper model once, inside the app (56 or 181 MB), so the phone needs the internet that first time.

## 5. Transmitter on Android

Not yet tried by us. It needs Android Studio, an Android SDK and a JDK; follow Expo's Android setup for SDK 58. Then `cd transmitter && npx expo run:android`. On Android the phone modes transcribe scenario clips, but the microphone still goes through the coordinator [75], so a microphone report fails in offline mode.

## 6. Daily start

Each in its own terminal, from the repo root:

```bash
OLLAMA_NO_CLOUD=1 OLLAMA_KEEP_ALIVE=-1 ollama serve     # offline mode only
PROVIDER_MODE=local npm run dev -- -p 3117              # drop PROVIDER_MODE=local for hosted mode
cd transmitter && npx expo start --dev-client            # phone testing only
```

## When something fails

| What you see | Why | Fix |
|---|---|---|
| `pod install` fails with an encoding error | No UTF-8 locale | Prefix the build with `LANG=en_US.UTF-8` [66] |
| Xcode: the bundle identifier is not available | Another team owns that bundle ID | Set your own `TRANSMITTER_BUNDLE_ID`, then `npx expo prebuild --clean --platform ios` |
| Expo asks to choose a development team | `APPLE_TEAM_ID` is not set | Set it (part 4, Signing) |
| The phone will not open the app | Developer Mode is off, or the Apple ID is not trusted yet | Part 4, The phone; then VPN & Device Management |
| Expo Go cannot open the app | It needs native modules | Use the development build [59] |
| App: "no answer from the coordinator" | Opened with a numeric address, local network access denied, or no coordinator on 3117 | Launch with the `.local` name; allow local network; check `lsof -nP -iTCP:3117 -sTCP:LISTEN` |
| `ollama pull ministral-3:3b` asks for a newer version | Ollama older than 0.40 | `brew upgrade ollama` |
| Ollama settings have no effect | The desktop app is serving port 11434 | Quit the app, then `ollama serve` |
| The first report after a start is slow or times out | The model is still loading | Wait for the two `ready for` lines |
| A report with audio gets HTTP 501 | Offline mode has no speech-to-text on the computer yet | Use a phone mode, or type the report |
| `Processing failed` in hosted mode | Missing or wrong Mistral key, or no internet | Check `.env.local`; restart the coordinator |
| Port 3117 is busy | A coordinator is already running | Use that one, or stop it |
