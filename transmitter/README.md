# Transmitter

A small native app (Expo, React Native) that stands in for a field radio: it sends spoken
position reports to the coordinator (`POST /api/report` on the web app in the folder above).
Like a radio on a net, it does not join or name itself, and it does not answer questions
([decision 208](../DECISIONS.md)). The speaker says the call sign ("Alpha 1, at the château"),
the coordinator reads it from the words against the mission's roster, and the operator on the
command post (`/cp`) places what it is unsure of and answers questions.

## One path, several sources

Everything the app sends is an **utterance** (`src/types.ts`): audio or text, start and end
times and a sequence number. Only a scenario step names a call sign, since a script speaks for
several units; a report from the microphone has none. What produces an utterance can change; nothing
after it does.

| Source | What it is | Status |
|---|---|---|
| Scenario clip | A prepared clip bundled with the app, sent as if it had just been recorded. Silent, repeatable, works in the simulator. | built |
| Microphone | Hold the button, speak, release. | built |
| Open microphone | Listens continuously and cuts at pauses. | later |

## The screen

The main screen is only for reporting. Top to bottom:

- **Where:** the mission's name, the area, the language, and the coordinator with a dot
  (green when it answers, red when it does not). Tapping it, or the gear, opens Setup.
- **Pick a mission**, like tuning to a net, until one is picked: a card lists the coordinator's
  open missions, and the talk button says "Pick a mission". With only one open, it is picked for
  you. Tapping one picks it: there is no call sign to type and nothing to join. The phone keeps
  the code in `transmitter.json` in its documents, picks it again on start, and sends it with
  each report. With other missions open, "Change" offers them. When the base ends the mission,
  the phone says so within 5 seconds and offers the open ones; it waits for a pick, so it never
  moves to another mission by itself. A coordinator that keeps no record (the live site) has no
  missions: the phone reports without one [114, 208].
- **A notice**, only when the next report would fail: the coordinator is not answering, or
  speech-to-text is set to the phone and its model is not downloaded.
- **The talk button** and, under it, one status line: listening, sending, sent, held for the
  operator, or not sent and why. While recording it turns red, counts the seconds, and a bar
  shows how much of the 15 seconds is used. The phone shows no answer: a question, and a report
  the coordinator could not give to a unit, wait for the operator on the command post at `/cp`
  [178, 203].
- **Scenarios** for the mission's area: pick one, play it all, or tap one report. Each step
  shows whether the coordinator answered as the script expects. A question stays open for the
  operator: a step that expects one passes when the expected choice was offered. A later step
  that depends on the answer passes only once the operator gives it.

**Setup** is a sheet: area and language, which coordinator, where speech becomes text and the
model download, and scenario sound and timing. In a mission, the mission's area counts. The
language is the one you speak, English by default: it goes with every report, Whisper on the
phone listens for it, and the operator's questions are written in it. Scenarios use each
report's own language instead ([decision 106](../DECISIONS.md)).

The UI lives in `src/ui/`: `theme.ts` (colours, type and spacing, shared with the web app's
palette), `controls.tsx` (segmented control, grouped rows, buttons), and one file each for the
talk button, the scenario list, the mission card, and the Setup sheet. `src/mission.ts` lists
missions and keeps the one picked. `src/speech.ts` is not used for now: it stays for hearing the
operator's calls later.
`App.tsx` holds the logic and composes them.

## Run it

```bash
npm install
LANG=en_US.UTF-8 npx expo run:ios      # first build takes a few minutes; needs Xcode
npx expo start --dev-client            # the dev server the app loads its code from
```

`LANG=en_US.UTF-8` matters: CocoaPods fails without a UTF-8 locale.
Android: `npx expo run:android`. This is a native build, so Expo Go cannot run it.
For the Mac USB workflow with Studio closed, use the root README's
[command-line build and rebuild steps](../README.md#build-and-try-changes-without-android-studio).

On a phone, sign with your own Apple ID: put `APPLE_TEAM_ID` and your own `TRANSMITTER_BUNDLE_ID`
in `transmitter/.env.local` (ignored by git), because `dev.voicetomap.transmitter` belongs to
Alex's team (`app.config.ts`). Expo's commands and `npm run phones` read that file; a value set in
the shell wins. Every step, with checks: [../docs/setup.md](../docs/setup.md).

## Updating the phones

One command on the Mac, with Metro and the coordinator running:

```bash
cd transmitter && npm run phones
```

It updates every iPhone connected to the Mac, by cable or on the same network, and opens the
app on Metro there. A development build loads its code from Metro, so most updates need no
install: after a change to `App.tsx` or `src/`, or a pull, the script only reopens the app. While
Metro runs, saved changes also reach the open apps by themselves.

The app is built and installed again only when its native side changed: a native package,
`app.json`, `app.config.ts` and the variables it reads, or Expo itself. Expo's fingerprint of
those is kept in `.expo/phones.json`, so the script knows. After such a change it runs
`npx expo prebuild --platform ios --clean` once, then builds for each phone (decision 207). The
first build takes several minutes; each further phone takes less. A phone that does not have
the app yet gets it the same way, so a teammate's iPhone only needs to be plugged in, unlocked,
trusted, and in Developer Mode.

| Option | Does |
|---|---|
| `--check` | Says what it would do for each phone, and changes nothing |
| `--rebuild` | Builds and installs again. With a free Apple ID the app stops opening after 7 days; the script warns a day before |
| `--device "<name or UDID>"` | One phone only |

Android phones are not covered yet: use the root README's steps.

## Which coordinator it talks to

A development build loads its code from the computer running the dev server, so it knows that
computer's address. It sends reports to the coordinator on that same computer, port 3117
(`npm run dev -- -p 3117` in the folder above). Setup switches between "This Mac" and
"Live site" (`https://edth-hackathon.vercel.app`), and the dot beside the coordinator's name
shows whether it answers (re-checked every 5 seconds). `EXPO_PUBLIC_SERVER_URL` overrides the default.

For a phone, open the app with the computer's network name, not a numeric address:

```bash
xcrun devicectl device process launch --device <phone id> --terminate-existing \
  --payload-url "exp+transmitter://?__expo_url=http%3A%2F%2F$(scutil --get LocalHostName).local%3A8081&__expo_disable_fab=1&__expo_disable_onboarding=1" \
  dev.voicetomap.transmitter
```

`__expo_disable_fab=1` hides Expo's floating developer button, which otherwise sits over the
top right of the screen; leave it off when you want the developer menu.

The name keeps working when addresses change, and it works over the USB cable alone, with no
shared Wi-Fi. A numeric address does not: over the cable the Mac's address changes every time
the link re-forms, and the app then reports "no answer from the coordinator". iOS must be
allowed to "find devices on your local network" when it asks. A plain `http://` address on the local
network is allowed. In hosted mode the coordinator calls Mistral, so the computer needs the
internet and a key. In offline mode (`PROVIDER_MODE=local`) it needs neither. In Server mode the
coordinator then transcribes with whisper-server, which must be running (`npm run stt`,
[../docs/setup.md](../docs/setup.md), part 3); the phone modes send text and do not need it.

Checked on 20 Nov on an iPhone 13 mini through the coordinator on the Mac: the Kyiv scenario
ran twice, 10 of 10 steps as expected, round trip 1.2 to 1.9 s (median 1.5 s), with server
speech-to-text. Results: `../scenarios/results/iphone13mini-via-mac-coordinator-2026-11-20.jsonl`.
The Android microphone check is recorded below.

## Speech-to-text: on the server or on the phone

Setup chooses where speech becomes text (`src/stt.ts`).

| Mode | What happens | Needs |
|---|---|---|
| Server | The clip is uploaded and the coordinator transcribes it: Mistral, or whisper-server in offline mode [195]. | A connection good enough for audio |
| Phone: base | Whisper `ggml-base-q5_1` runs on the phone; only the words are sent. | A one-time 56 MB download |
| Phone: small | Whisper `ggml-small-q5_1`, slower and more accurate. | A one-time 181 MB download |

Phone models come from `ggerganov/whisper.cpp` on Hugging Face and are kept in the app's documents.
"Place-name hints" gives Whisper the area's place names and report words (`src/hints.generated.json`),
fitted to its prompt budget (below). `npm run setup` fetches the base model to `assets/models/` on
the Mac and checks its SHA-256, for `../scripts/build-transmitter-hints.ts` to count tokens with; the
app does not use that copy.

### Model comparison (20 Nov)

A newer comparison, on 21 Nov, with the language pinned and against Parakeet and
Voxtral, is in [../docs/stt-comparison.md](../docs/stt-comparison.md).

Measured on 20 Nov in the iPhone simulator, on the 9 scenario steps (synthetic voices, clean audio).
A step counts when the coordinator's answer is the expected one.

| Mode | Vincennes (4) | Kyiv (5) | Total |
|---|---|---|---|
| Server (Mistral) | 4 | 5 | 9 of 9 |
| Phone: small, with hints | 3 | 5 | 8 of 9 |
| Phone: small, no hints | 3 | 5 | 8 of 9 |
| Phone: base, with hints | 3 | 5 | 8 of 9 |
| Phone: base, no hints | 0 | 4 | 4 of 9 |

- Every miss was a question back or "could not place that"; none put a pin in the wrong place.
- The one step no phone mode got: "Bérault" was heard as "Bayreauld" or "Beiraud".
- Phone transcripts are rough ("Ruchaj z do Sofijskiego Soboru" for «Рухаюсь до Софійського собору»)
  and still resolve, because extraction and name matching tolerate the errors.
- Time per clip in the simulator was about 4 s (base) and 15 s (small). The simulator has no GPU, so
  this says nothing about a real phone; that still has to be measured. The server takes about 0.3 s.
- The raw results are in `../scenarios/results/stt-comparison-2026-11-20.jsonl`.

### The prompt for Whisper base (21 Nov)

Whisper keeps only the last 223 tokens of its prompt. The Vincennes list was 268 tokens, so its
first seven names (the stations and the château) never reached it. The list is now fitted to the
budget and ends with the area's report phrases ("hostile drone", "Track 2") [189].

Measured on the Mac with whisper.cpp built from `whisper.rn`'s own source, `ggml-base-q5_1`,
language on auto. Clips: the scenario steps and 61 synthetic reports in macOS voices.

| Vincennes, 51 clips | Word error rate | Report words heard |
|---|---|---|
| Before: 40 names, the first 7 cut | 0.345 | 33 of 66 |
| After: 29 names, then 8 report phrases | 0.223 | 56 of 66 |

- "Hostile" now comes back as said in every English voice. Before, one voice gave "Hospital drone" and
  "Hospital vehicle", and a real voice on the phone gave "Hostel Drone". "Enemy patrol" no longer
  comes back as "Avenue patrol". One clip got worse: "Hostiles at the Château de Vincennes" lost
  the château in one voice.
- Kyiv and Izium, 19 clips: the same or better on all but one ("Об'єкт 2 біля Золотих воріт" lost
  "Об'єкт 2"). All 24 Kyiv names still fit.
- French report clips in synthetic voices are poor with every prompt ("Véhicule hostile devant la
  mairie" came back as "avec une oscillation de la mérite"). Real French voices are not checked.
- Putting the most useful names last did worse: "devant la mairie" became "devant la mérie".
- The raw results are in `../scenarios/results/whisper-prompt-2026-11-21.jsonl`.

Phone modes transcribe both scenario clips and the microphone on Android and iOS. Android uses
the local Expo module in `modules/pcm-recorder` to write 16 kHz mono 16-bit PCM WAV with
`AudioRecord`; iOS uses expo-audio. Both call the same Whisper function and send text through
the existing report path. Rebuild the Android development app after adding the native module.

Checked on 21 Nov on a Samsung Galaxy S10 (SM-G973U): microphone audio reaches the offline
coordinator as text (`timings_ms.stt: 0`). Two live reports, "I am at the town hall in Vincennes",
placed the unit at Mairie de Vincennes (±31 m) on the command post. This verifies build and connections;
recognition accuracy, old question cards and transcription speed remain separate runtime work.
Small and the iOS path were not tested in this Android change.

## What you hear

A scenario sends its clips as data, so by default nothing is played: that is what makes it
usable in a quiet room. The phone speaks nothing: a radio hears the operator, not the
coordinator, and the operator's calls do not reach the phone yet [208]. "Play clips aloud"
(Setup, Scenarios) plays each clip through the phone's speaker before it is sent, for an audience. Sound comes out even with the ring switch on silent.

## Scenarios

`../scenarios/*.json` describe scripted reports and what the coordinator should answer.
`npm run scenarios` (in the folder above, on a Mac) makes the clips with synthetic voices and
writes `scenarios/index.ts` here. "Play scenario" sends every step and marks each one ✓ or ✗
against its expected answer.
