# Voice-to-Map

EDTH Paris 2026, challenge 01 (Lysk): spoken position reports become live map updates.
When a report could mean more than one place, the app asks back instead of guessing.

Live: https://edth-hackathon.vercel.app (single user, no auth; it keeps no reports, so its command post stays empty). Three areas, switched at the top of the page or with `?area=kyiv`: Vincennes (English, French), central Kyiv (Ukrainian, English) and Izium (Ukrainian, English), a town near the front in Kharkiv Oblast (`?area=izium`). Deployed from `main` on 21 November.

## How it works

```
phone mic ─► /api/report ─► speech-to-text (Mistral voxtral-mini-transcribe-3, report words and place names as context_bias)
                         ─► intent extraction (Mistral mistral-small-latest, JSON schema; never coordinates)
                         ─► resolver (deterministic, local gazetteer of the chosen area from OpenStreetMap)
                         ◄─ { transcript, language, intent, resolution, timings_ms }
```

- The language model only extracts intent: kind, landmark name (as said, plus its dictionary form for Ukrainian), category, relation, a stated distance in metres, a compass direction of travel, language.
- `lib/geo/resolver.ts` turns intent + last position into a pin with a confidence radius, an arrow, or a question with up to three choices. Every coordinate comes from `data/gazetteer.<area>.json`, or from the last position moved by a distance and compass direction the speaker stated. The phone's GPS is never used.
- A report can also be about a **track**: something the speaker sees or knows of ("enemy vehicle in front of the town hall", "drone 300 metres north of me"). The coordinator numbers it and says the number back ("Track 3, hostile vehicle, Mairie de Vincennes."), and the command post draws it with its NATO symbol. Tracks are for reconnaissance only: who saw what, where, when, and how sure the place is. See [Tracks](#tracks).
- The client holds all state (no database in stage 1). Questions are spoken with the browser's `speechSynthesis`. Ukrainian questions use an on-device voice instead when it is loaded (`lib/tts/`, test page at `/tts-lab`).

### Resolver rules

| Situation | Result |
|---|---|
| No place in the report | `unresolved`, prompt to name a street or place |
| Named place, one good match | `resolved` |
| A name said whole, and a longer name that contains it ("Софійського собору": the cathedral, and its bell tower "Дзвіниця Софійського собору") | the whole name wins, even with a Ukrainian case ending that makes it score lower |
| Named place, several good matches (e.g. "Château de Vincennes" = castle and metro station) | `ambiguous`, unless a category word outside the name ("…metro station") narrows it |
| "Metro" said, and the whole name is a train station ("Vincennes metro": the RER station is "Vincennes", the metro is "Château de Vincennes") | `ambiguous` between the two, even when one is near; "Vincennes station" and "Vincennes RER" still mean the RER [181] |
| Category only ("the church") | candidates of that category within 1.5 km of the last position (or area centre) |
| Several candidates | `resolved` only if the last position is under 10 min old and nearest < 0.4 × second nearest; otherwise `ambiguous` with the top 3 |
| Name not in gazetteer but a category was said | ask among that category, never a silent guess |
| Two voices in one clip name different places (Whisper marks the change of voice) | `ambiguous`: "I heard more than one voice. Which place is yours?" ([voices](docs/voices.md)) |
| Same name, same spot (station + the square above it) | one place, no question; the circle widens to cover all of them |
| Street and station share a name ("на Хрещатику") | `ambiguous`: the street is 1.2 km long, the station is one point |
| No place, but a distance and a compass direction ("moved 300 metres north") | `resolved` by dead reckoning from the last position, shown as an estimate |
| The same with no last position | `unresolved`: "I don't know where you started", asks for a place |
| No place, and only a distance or only a direction ("heading north") | `unresolved`: asks for a distance and a compass direction, or a landmark |
| "Passing the next intersection", on a known street | the nearest crossing ahead on that street, if the unit's last two fixes ran along it; otherwise `ambiguous` between the nearest crossing each way |
| The same, street not known | the nearest crossings around the last position, in different directions; a compass direction said in the report picks the one ahead |
| "At the corner of rue X" | the crossings of rue X, those with the unit's own street first, then as for a named place |
| A crossing with no last position | `unresolved`: asks for the streets that cross there |
| "Two blocks east", "deux rues à l'est", "два квартали на схід" | counted in code along the street the unit is on that runs east, never turned into metres by the model [51]. "Two blocks" is the second crossing counting every street that meets it, or the second counting only streets that cross it right through. Both the same crossing: placed there, with a ≈; two crossings: `ambiguous` between them [184] |
| "Two blocks east of rue X" | the same, along rue X if it runs east, or from where a street that runs east crosses rue X: the unit's own street if it is one, else the nearest when it is much nearer than the next, else `ambiguous` |
| Blocks that cannot be counted: "a few blocks", more than six, no street running that way, fewer crossings than blocks, or counted from a place that is not a street | `unresolved`: asks how far ("How far east of Rue de Fontenay? Or name a place near it.") [184] |

Radius: at 30 m; near / behind / in front of / next to 80 m; compass relations (eight points) offset 100 m on that bearing with 100 m radius; large features (parks, the château, streets) use at least their own extent.

A stated distance replaces those defaults. "200 metres south of X" pins 200 m out from X's edge, with a circle of 0.4 × the distance (50 m at least): a compass word is one of eight, so it is good to ±22.5°. "200 metres from X", with no side given, keeps the pin on X and widens the circle to X's extent plus 1.25 × the distance. The model only copies a distance that was said; "five minutes north" has none.

Movement ("moving towards X", "I moved towards X") gives a direction, not a distance. The marker moves to the middle of the leg from the last position to X, its circle spans the whole leg, an arrow points at X, and the time is shown at the marker with a ≈. The next report can still use that estimate, but "nearest wins" must hold even if the estimate is off by its full radius.

Movement along a street ("moving down Avenue X", "je remonte la rue X", "йду вулицею X") puts the speaker on the street, not on the way to it: at the point on it nearest the last position, shown with a ≈. The circle is the last position's own, plus the step onto the street, plus 1.25 × any distance said, since the way along it is not known. Only "towards", "heading to" and the like give the arrow.

Movement with a distance is dead reckoning from the last position, and is also shown with a ≈:

- "Moved 300 metres north": 300 m on that bearing. The circle is the last position's own circle plus 0.4 × the distance, so it grows with every leg until a report names a place again.
- "Moved 200 metres towards X": 200 m along the leg, never past X. The circle is the last position's circle plus a quarter of the distance (50 m at least).
- "Moved 300 metres east on rue X": the reckoned point is moved onto that street.
- A place that cannot be found does not stop a move that states its distance and direction; the log says the place was ignored.

### Tracks

A track is something on the map that is not a reporting unit. `lib/geo/tracks.ts` holds the rules; none of them is left to the model.

| Situation | Result |
|---|---|
| "Enemy vehicle in front of the town hall" | a track at that place, found as for a position report, measured from the observer |
| "I see a drone about 300 metres north of me" | a track by dead reckoning from the observer, shown as an estimate; the circle is the observer's own plus 0.4 × the distance |
| "Enemy vehicle to the east", "heading towards the bridge" | no point can be given: the app asks how far ("How far east is it?"), or for a place near it |
| "Unknown contact, two blocks east" | a track whatever the model reads: "contact" opening the report, or next to whose it is, unknown, new or a count, is something seen [180]. "Two blocks" is counted along the observer's street [184]; when it cannot be, the app asks how far east. "Lost contact with BRAVO 2" stays about the speaker |
| No word for whose it is ("a vehicle near the church") | unknown. Hostile only when a hostile word was said; "suspicious" or "possible enemy" is a suspect; "our" and "friendly" are friendly; "civilian" is neutral |
| "Track 3 moved to the station" | a new sighting of Track 3, with a trail from the last one |
| "Track 3 is hostile" | only what it is changes |
| "Track 9 …" when the mission has no Track 9 | `unresolved`: "There is no Track 9 in this mission." |
| The model reads a track but no word names a thing ("I can see the church"), or reads the speaker's position when a hostile word was said, or when the words name a thing and whose it is ("our drone team is at the station") | `unresolved`: "Is that where you are, or something you see?" |

A report about a track never moves the speaker. The number is given when the report is saved, one count per mission, and carries no affiliation, so Track 3 keeps its number when it turns from unknown to hostile. On the command post a track has its APP-6 symbol (drawn by `milsymbol`), its number, what it is in words, who saw it and when, its circle, a dashed trail of earlier sightings and a dotted line of sight from the observer. A symbol that would hide a unit or another track is drawn a little way off, with a thin line back to its point; the point itself does not move [167]. After 10 minutes with no report it is shown as old. The command post can also place, change, move and take off a track by hand [177]. Not built yet: a question when a new sighting is close to an old track, "Track 3 is gone" said by a unit, and range rings. Screenshots and diagrams: [docs/tracks.md](docs/tracks.md).

Crossings are not in the gazetteer. `lib/geo/crossings.ts` finds them where two named streets share a point in OpenStreetMap; a bridge shares none, so it is not a crossing. In a mission the coordinator remembers the street each unit is on (from a report that named a street, kept through crossings on it) and the way it last moved, and passes both with the last position. A crossing within 20 m is the one the unit is at, never the next one. The pin is the crossing, with a 30 m circle.

## Demo script

Chosen from the real gazetteer (1,130 features: 6 rail/metro stations, 11 churches, 2 town halls, 1 castle, 31 stops, 38 pharmacies). Start from a fresh page (or "Clear map and log").

| # | Say | Expected |
|---|---|---|
| 1 | "I'm at Bérault metro." | Unique named place: pin at Bérault, ±30 m |
| 2 | "Now I'm at the château de Vincennes." | Ambiguous: phone asks "castle or station?" aloud; tap **Château de Vincennes (metro station)** |
| 3 | "Moving towards the town hall." | Movement: the marker moves half way to Mairie de Vincennes (±174 m, the whole leg), with a dashed line from the station and an arrow on to the mairie (nearest town hall wins: 347 m vs 1.45 km to Saint-Mandé) |
| 4 | "Je suis devant la mairie." | French: pin in front of Mairie de Vincennes, ±80 m |

If hall noise defeats transcription, type the same sentences in the text box; text and voice go through the same pipeline.

### Kyiv, in Ukrainian

Switch to **Київ** (2,840 features: 26 stations, 67 churches, 317 streets, 44 stops, 142 pharmacies, 104 hotels) and start from a fresh page. Checked with a synthetic Ukrainian voice, not yet with a native speaker.

| # | Say | Expected |
|---|---|---|
| 1 | «Я на Хрещатику.» | Asks «вулиця Хрещатик чи Хрещатик (станція)?»; tap **вулиця Хрещатик** |
| 2 | «Рухаюсь до Софійського собору.» | The marker moves half way, with an arrow to Saint Sophia Cathedral |
| 3 | «Я біля станції метро Хрещатик.» | Pin at Khreshchatyk station, ±80 m |
| 4 | «Я на Майдані Незалежності.» | Pin ±249 m, no question: station, square and street are one place |
| 5 | "I'm at the Golden Gate." | English in the same session: pin at Золоті ворота, ±30 m |

Order matters for step 1: said within 10 minutes of a fix at the station, «Я на Хрещатику» resolves to the station without asking (nearest wins).

### Izium, in Ukrainian

Switch to **Ізюм** (714 features: 1 railway station, 6 churches, 503 streets, 16 stops, 16 pharmacies, 11 fuel stations, the Siverskyi Donets) and start from a fresh page. A made-up walk from the station to the hospital. Typed into the coordinator on 21 November with hosted Mistral: 9 of 9, three times. Not yet spoken, and not checked with a native speaker. Why Izium, and what it still lacks (no bridge has a name), is in [docs/gazetteer.md](docs/gazetteer.md#izium-added-saturday-21-november).

| # | Say | Expected |
|---|---|---|
| 1 | "I'm at Izium station." | Pin at the railway station, ±30 m; the bus station of the same name is a stop, so no question |
| 2 | «Рухаюсь до Європейської вулиці.» | An arrow to Європейська вулиця; the marker moves 40 m, as the street runs past the station |
| 3 | «Я на південь від Свято-Вознесенського собору.» | Pin 120 m south of the Ascension Cathedral, ±100 m |
| 4 | «Пройшов п'ятсот метрів на схід.» | Dead reckoning: 500 m east, ≈, ±300 m |
| 5 | «Рухаюсь до Сіверського Дінця.» | The marker moves half way to the nearest bank, with an arrow. «До річки» would ask: three waterways are near |
| 6 | «Я на Центральній площі.» | Pin on the central square, ±82 m |
| 7 | «Я біля церкви.» | Asks «Яка церква: Спасо-Преображенський собор чи Хрестовоздвиженська церква?»; tap **Спасо-Преображенський собор** |
| 8 | "Passing the next intersection, heading west." | The next crossing to the west, Залікарняна вулиця / Старопоштова вулиця. In three runs of four the model read "passing" as moving: an arrow to it and the marker half way (≈). In the other, a pin on it, ±30 m |
| 9 | «Я біля Центральної районної лікарні.» | Pin at the district hospital, ±80 m, not one of the eight other clinics nearby |

### Vincennes, with tracks

`scenarios/vincennes-tracks.json`. Two units report what they see; every sighting is made up. It is set in Vincennes, not Izium, where the demo names no unit or position [140]. Start a new mission so the numbers count from 1. Checked on 21 November: 11 of 11 typed through hosted Mistral and through the local 3B model, and 11 of 11 as synthetic-voice clips through the coordinator. On the local model, step 11 needs the compass-only tune [196]: checked again after it, 11 of 11 typed through the coordinator in offline mode. Not yet spoken by a person or sent from a phone.

| # | Who | Say | Expected |
|---|---|---|---|
| 1 | ALPHA 1 | "I'm at Bérault metro." | Check-in: pin at Bérault |
| 2 | BRAVO 2 | «Je suis à la mairie de Vincennes.» | Check-in: pin at the town hall |
| 3 | ALPHA 1 | "Two enemy vehicles on Avenue de Paris, moving east." | "Track 1, hostile vehicle, count 2, Avenue de Paris." ALPHA 1 does not move |
| 4 | BRAVO 2 | "I see a drone about 300 metres north of me." | "Track 2, unknown drone, 300 metres north of you." An estimate, ≈ |
| 5 | BRAVO 2 | "Suspicious vehicle near the church." | "Track 3, suspect vehicle, Église Notre-Dame." Dashed hostile frame |
| 6 | ALPHA 1 | "Enemy patrol near the cemetery." | Asks "Track 4. Which cemetery: Cimetière Nord de Saint-Mandé, or Cimetière ancien?"; tap **Cimetière Nord de Saint-Mandé** |
| 7 | ALPHA 1 | "Track 1 moved to Avenue de Nogent." | "Track 1, now Avenue de Nogent." A dashed trail back to Avenue de Paris |
| 8 | BRAVO 2 | "Track 2 is hostile." | "Track 2, hostile." The symbol turns red; the place stays |
| 9 | BRAVO 2 | «Voiture civile devant la mairie.» | «Piste 5, véhicule civil, Mairie de Vincennes.» Neutral |
| 10 | ALPHA 1 | "Friendly drone team at Vincennes station." | "Track 6, friendly drone team, Vincennes." A track, not ALPHA 1's position |
| 11 | BRAVO 2 | "Enemy vehicle to the east." | No track: "How far east is it? Or name a place near it." |

At the end the map has six tracks and both units are still where they checked in. Step 7 names a street, not the castle: "moved to the castle" makes the local model ask castle or station.

## Run locally

The daily procedure is for this Mac and a USB Android phone. For a new computer, start
with [Install and build once](#install-and-build-once).

### Daily use: USB Android phone, no Studio

Use **three Terminal windows**, one for each service. Leave all three open. Android Studio
and an emulator are not needed. Connect the phone to the Mac with a **USB data cable**
(not a charging-only cable), unlock it, and keep it connected throughout this procedure.

**1. Ollama — runs the local language model.** Paste into the first window:

```bash
OLLAMA_NO_CLOUD=1 OLLAMA_KEEP_ALIVE=-1 OLLAMA_CONTEXT_LENGTH=4096 /opt/homebrew/bin/ollama serve
```

**2. Coordinator — runs the command post and processes reports.** In the second window:

```bash
cd ~/Projects/edth-hackathon
PROVIDER_MODE=local npm run start -- -p 3117
```

Wait for `Ready`, then open **http://localhost:3117/cp** in the Mac's browser.

**3. Phone connection — serves the transmitter over USB.** In the third window:

```bash
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/Library/Android/sdk/platform-tools:$PATH"
adb -d reverse tcp:3117 tcp:3117
adb -d reverse tcp:8082 tcp:8082
cd ~/Projects/edth-hackathon/transmitter
CI=1 EXPO_PUBLIC_SERVER_URL=http://127.0.0.1:3117 npx expo start --dev-client --localhost --port 8082 --max-workers 2
```

Open **Transmitter** on the phone. If asked for a development server, enter
`http://127.0.0.1:8082`. In Setup choose **This Mac** and **Phone: base**; download its
model once. Create a mission on the command post and join it on the phone. Hold the talk
button, wait for red, speak, then release. The report appears on the command post.

To stop, press **Ctrl+C** in each Terminal window. If a port is already in use, stop its
old server before starting another. After reconnecting USB, repeat the two `adb reverse`
commands in a free terminal.

This uses the built coordinator to avoid the command post flicker seen with `next dev`.
After coordinator code changes, stop its server, run `npm run build` at the repo root,
and start it again. After phone JavaScript changes, restart window 3 and reopen the app.

### Install and build once

Skip this on a computer already set up. Install the tools for the parts you use;
versions checked against the project on 21 November 2026.

| Part | Install once |
|---|---|
| Everyone | Git, Node.js 24.3+ in the 24.x line (recommended; 22.13+ in 22.x or 26.x also work), and npm (included with Node). |
| Web app and command post | A current browser. All JavaScript libraries and development tools are installed by the npm commands below. |
| Offline coordinator | Current [Ollama](https://ollama.com/download) with `ministral-3:3b` (`ollama pull ministral-3:3b`, about 3 GB). |
| Hosted coordinator | A Mistral API key in `.env.local`; no Ollama needed. |
| Android transmitter | [Android Studio](https://developer.android.com/studio) with its bundled JDK. In SDK Manager: SDK Platform **37**, Build-Tools **37.0.0**, Platform-Tools, Command-line Tools, NDK **27.1.12297006**, CMake **3.22.1**. For an emulator, also Android Emulator and a system image (ARM64 on Apple Silicon). Accept SDK licenses. |
| iOS transmitter (Mac only) | Xcode with Command Line Tools and an iOS simulator runtime, plus CocoaPods (`brew install cocoapods`). A real iPhone also needs your Apple ID for signing; see [setup](docs/setup.md#5-transmitter-on-an-iphone). |
| Speech models | Phone mode: download Whisper base (56 MB) or small (181 MB) in the app's Setup. The web app tries to download its Ukrainian voice (77 MB) on first start; it falls back to the system voice if unavailable. |
| Rebuild scenario audio only | macOS `say` and `afconvert` (built in), with Daniel, Jacques and Lesya voices installed in System Settings → Accessibility → Spoken Content / Read & Speak. Existing clips are included. |

Homebrew is needed only for the `brew` commands. Internet is needed for installs, model downloads, hosted mode, map tiles and rebuilding gazetteers. Gradle, Expo CLI and Whisper's native code come from the project; no separate global install is needed.

From the repo root, install both sets of npm dependencies ([web](package.json), [transmitter](transmitter/package.json)):

```bash
npm ci
npm ci --prefix transmitter
```

For an offline coordinator, start Ollama in window 1, then run
`ollama pull ministral-3:3b` once in another window (about 3 GB).
Before the first daily startup, build the coordinator from the repo root:

```bash
npm run build
```

Build and install the native Android app with the command-line steps below.
Full setup and iPhone signing: [docs/setup.md](docs/setup.md).

### Build and try changes without Android Studio

Studio supplies the installed JDK and SDK, but **leave Studio closed**. Use this for the
first Android install, or after changing native code, native dependencies or app config.
Install npm dependencies as above first. **Installation requires the phone connected to
the Mac with a USB data cable.** Enable **Developer options → USB debugging** on the
phone, unlock it, and accept its debugging authorization prompt. Keep the cable connected
for the daily startup below; this procedure uses USB for both installation and communication.
Stop the three servers with Ctrl+C before a native build, especially on an 8 GB Mac.

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="/usr/local/bin:/opt/homebrew/bin:$ANDROID_HOME/platform-tools:$PATH"
cd ~/Projects/edth-hackathon/transmitter
npx expo prebuild --platform android
cd android
./gradlew --stop
./gradlew :app:assembleDebug --max-workers=2
adb -d install -r app/build/outputs/apk/debug/app-debug.apk
./gradlew --stop
```

Then use the [three-window daily startup](#daily-use-usb-android-phone-no-studio) and open
Transmitter on the phone. The last Gradle command frees build memory before Ollama starts.

- **Phone JavaScript/TypeScript changes:** restart window 3 and reopen the app; no native build.
- **Coordinator/web changes:** stop window 2, then paste there:

```bash
cd ~/Projects/edth-hackathon
npm run build
PROVIDER_MODE=local npm run start -- -p 3117
```

If a USB phone is missing: in its Developer options, revoke USB debugging authorizations,
re-enable USB debugging, reconnect and accept the authorization prompt.

### Android Studio on macOS

Optional, for developers who want the IDE. Quit Studio with **⌘Q** first.
From the repo root, paste into Terminal; keep it open:

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="/usr/local/bin:/opt/homebrew/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
# First time only, if transmitter/android does not exist:
[ -d transmitter/android ] || (cd transmitter && npx expo prebuild --platform android)
cd transmitter/android
./gradlew --stop
"/Applications/Android Studio.app/Contents/MacOS/studio" "$PWD"
```

Sync Gradle. In Device Manager, press ▶ beside your emulator (or connect a phone with USB debugging). Leave optional AGP upgrades alone.

In a second terminal, from the repo root:

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="/usr/local/bin:/opt/homebrew/bin:$ANDROID_HOME/platform-tools:$PATH"
cd transmitter
npx expo run:android       # build, install and start Metro
# On later starts, if the native app is already installed:
# npx expo start --dev-client
```

The transmitter needs a native development build; Expo Go cannot run it. Keep the coordinator running on port 3117. Open `http://localhost:3117/cp`, create a mission and join it in the app.

### Web development and checks

The daily procedure above uses a build. For web development, run one of these at the
repo root instead of window 2:

```bash
PROVIDER_MODE=local npm run dev -- -p 3117    # offline; needs Ollama
npm run dev -- -p 3117                        # hosted; needs MISTRAL_API_KEY
```

```bash
npm test             # resolver unit tests
npm run eval:extract # score intent extraction on evals/extraction.cases.json (needs a key, or PROVIDER_MODE=local)
npm run gazetteer -- kyiv   # rebuild data/gazetteer.<area>.json from Overpass (vincennes, kyiv or izium)
```

Environment options are in `.env.example`. Hosted mode needs `MISTRAL_API_KEY` in
`.env.local`; never commit a key. Without one, use offline mode. Extraction can also
use `FEATHERLESS_API_KEY`. Optional model overrides: `MISTRAL_STT_MODEL`, `MISTRAL_EXTRACT_MODEL`. `MISTRAL_STT_DIARIZE=0` stops asking Mistral to tell speakers apart.

### Offline: models on this computer

`PROVIDER_MODE=local` makes the coordinator call nothing outside this computer. Intent extraction runs through Ollama with the same prompt and schema. Speech-to-text runs through whisper-server, whisper.cpp's server, with Whisper large-v3-turbo [195]: `npm run stt` fetches the model once (574 MB, checksum checked) and starts it on 127.0.0.1:3118 (`WHISPER_URL`). It is needed for audio sent to the coordinator: the transmitter's Server mode and the browser's microphone. The transmitter's phone modes send text and work without it. Without it, audio gets HTTP 503 and a clear message. Turbo takes about 1.2 s per clip on an M1 Pro, so a spoken report takes 3 to 5 s offline ([stt-comparison.md](docs/stt-comparison.md#offline-on-the-coordinator)).

Install current Ollama (0.40 or newer; `brew install ollama` on macOS) and, for speech-to-text, `brew install whisper-cpp ffmpeg`, then use the daily startup above, with `npm run stt` in a window of its own. The model downloads are needed only once.

`LOCAL_EXTRACT_MODEL` picks another model (for example `ministral-3:8b`), `OLLAMA_URL` another address. At start the server loads the model and each area's prompt in the background, which takes about 10 s.

Measured on 20 Nov on the MacBook (M1 Pro, 32 GB), the 9 scenario texts through extraction and the resolver:

| Extraction | As expected | Median | Slowest |
|---|---|---|---|
| Mistral Small (hosted) | 9 of 9 | 0.8 s | 1.8 s |
| Ministral 3 8B (local) | 8 of 9 | 5.1 s | 16 s |
| Ministral 3 3B (local, default) | 8 of 9 | 2.0 s | 6.3 s |

Both local models miss "I'm at the Golden Gate." (8B leaves the name out, 3B translates it and calls it a bridge); the app asks back or says it could not place it, never a wrong pin. The time is spent writing the answer (75 to 95 tokens), not reading the prompt.

## Transmitter app and scenarios

`transmitter/` is a small native app (Expo) that stands in for a field radio. It sends spoken reports to the same `/api/report` and shows and speaks the answer. A report comes from the microphone (hold to talk) or from a prepared clip, and both go down the same path, so the whole pipeline can be driven silently in a simulator. See [transmitter/README.md](transmitter/README.md) for how to build and run it.

`scenarios/*.json` are scripted reports with the answer each one should get. `npm run scenarios` (on a Mac) makes the clips with synthetic English, French and Ukrainian voices. In the app, "Play scenario" sends every step and marks it ✓ or ✗; tapping one step sends it alone and leaves any question for you to answer.

Checked in the iPhone simulator against the live site on 20 Nov: the Vincennes script scored 4 of 4 and the Kyiv script 5 of 5. The full scenario suite has not been checked on Android. On 21 Nov a Galaxy S10 sent two live town-hall reports through the offline Mac coordinator; both appeared at Mairie de Vincennes on the command post.

## Command post

The shared map for the base station: open `http://localhost:3117/cp` on the computer that runs the coordinator, ideally on a big screen. It was called the receiver; `/receiver` still leads here [176].

A run is a **mission**. Open one from the Missions menu: an area, a name, and, if you like, a start point picked by name (the château, a metro station). Phones then join it from the transmitter: it lists the open missions, and the talk button waits until the phone has joined. A unit that joins starts around the start point, shown with ≈, and the phone asks it to check in by saying where it is. In a mission the coordinator keeps each unit's last position itself, so the phone's does not matter. End mission stops reports; the mission stays under "Ended" for replay, and can be deleted from there [107 to 114].

Every report shows up within about a second: one coloured marker per call sign with its time, circle and trail, a list of units, and a feed of what was said. The dashed trail runs from fix to fix and ends at the marker, the middle of its circle; a movement's arrow starts there and points at where the unit is heading. A question shows as "awaiting answer", with its choices numbered on the map, until the speaker taps one. The bar at the bottom replays the session at 1×, 10× or 30×, or from any moment on the slider; Live goes back to now. A unit silent for 3 minutes fades.

**Tracks by hand** [177]. **Place track** (or P) opens a palette: whose (it starts on Unknown), what, how many and how sure. Click the map or find a place by name, drag the symbol if needed, add a source if you have one, and press Place. The track gets the next number. Click any track for its card: Change, Move, Gone (off the map, kept in the list and the log) and Put back. Every change is a `plot` line in the log, marked CP in the feed. The command post never places a unit.

**Answering for a unit** [178]. Under an open question the command post has the same choices and "None of these". After a confirm it answers for the unit, as on a radio net; the feed says "CP answered". The first answer stands, the phone's or the command post's.

The coordinator keeps each mission in `.data/sessions/<code>.jsonl`: its opening, joins, reports, answers, tracks placed by hand and end, one line each, never edited. A deleted mission's file moves to `.data/sessions/deleted/`. The live site keeps no record yet, so it has no missions, phones report to it without one, and its command post stays empty [101].

## Layout

```
transmitter/                               native transmitter app (own package.json and tooling)
scenarios/, scripts/build-scenarios.mjs    scripted reports and the clip generator
app/page.tsx, components/VoiceMapApp.tsx   one mobile-first page: map, talk button, ask-back card, log
app/cp/, components/CommandPost.tsx        the command post: shared map, units, tracks, feed, replay; TrackTools.tsx, MissionPanel.tsx
app/api/report/route.ts                    POST multipart: audio | text, lastPosition, clientTs, session
app/api/answer/route.ts                    POST the choice for a question, tapped or chosen at the command post
app/api/sessions/                          list and open missions; [code]: the log, join, end, delete, tracks by hand
app/api/places/route.ts                    GET places by name, for a start point or a track; or the name of a point
lib/reports/                               missions and their logs: entry types, store, record, position rule, plot, foldLog
lib/geo/tracks.ts, lib/geo/trackKinds.ts   tracks: who a report is about, whose a track is, where it is; kinds and symbol codes
lib/providers/transcriber.ts               Transcriber interface + Mistral
lib/providers/extractor.ts                 IntentExtractor interface + prompt + JSON schema
lib/geo/areas.ts                           areas: centre, bounding box, hint text
lib/geo/gazetteer.ts                       name search, category words (en, fr, uk), bias terms
lib/geo/crossings.ts                       street crossings, from the points streets share
lib/geo/resolver.ts                        pure resolver
scripts/build-gazetteer.ts                 one Overpass query → data/gazetteer.<area>.json
docs/                                      design docs, one file per topic; start at docs/README.md
CONTRIBUTING.md                            setup, checks and working agreements for the team
DECISIONS.md                               every choice made, one line each
AGENTS.md                                  instructions for coding agents (Claude Code and Codex read the same file)
```

Map data © OpenStreetMap contributors (ODbL). Tiles by OpenFreeMap / OpenMapTiles.
