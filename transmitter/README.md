# Transmitter

A small native app (Expo, React Native) that stands in for a field radio: it sends spoken
position reports to the coordinator (`POST /api/report` on the web app in the folder above)
and shows and speaks the coordinator's answer.

## One path, several sources

Everything the app sends is an **utterance** (`src/types.ts`): audio or text, a call sign,
start and end times and a sequence number. What produces an utterance can change; nothing
after it does.

| Source | What it is | Status |
|---|---|---|
| Scenario clip | A prepared clip bundled with the app, sent as if it had just been recorded. Silent, repeatable, works in the simulator. | built |
| Microphone | Hold the button, speak, release. | built |
| Open microphone | Listens continuously and cuts at pauses. | later |

## The screen

The main screen is only for reporting. Top to bottom:

- **Who and where:** the call sign, the area, the language, and the coordinator with a dot
  (green when it answers, red when it does not). Tapping it, or the gear, opens Setup.
- **A notice**, only when the next report would fail: the coordinator is not answering, or
  speech-to-text is set to the phone and its model is not downloaded.
- **The talk button** and, under it, what happened last and the last known position. While
  recording it turns red, counts the seconds, and a bar shows how much of the 15 seconds is used.
- **A question card**, when the coordinator asks back. It sits directly under the talk button,
  with the choices and "None of these". The choice tapped is sent to the coordinator
  (`POST /api/answer`), so the receiver's question closes too. Every report goes to session `demo`;
  the receiver shows it at `/receiver?session=demo` on the same coordinator.
- **Two tabs:** Scenarios (pick one, play it all, or tap one report) and Sent (every report
  from this phone with the coordinator's answer and timings).

**Setup** is a sheet: call sign, area and language, which coordinator, where speech becomes text
and the model download, sound, and scenario timing. The language is the one you speak, English by
default: it goes with every report, Whisper on the phone listens for it, and questions come back
in it. Scenarios use each report's own language instead ([decision 106](../DECISIONS.md)).

The UI lives in `src/ui/`: `theme.ts` (colours, type and spacing, shared with the web app's
palette), `controls.tsx` (segmented control, grouped rows, buttons), and one file each for the
talk button, the scenario list, the sent list with the question card, and the Setup sheet.
`App.tsx` holds the logic and composes them.

## Run it

```bash
npm install
LANG=en_US.UTF-8 npx expo run:ios      # first build takes a few minutes; needs Xcode
npx expo start --dev-client            # the dev server the app loads its code from
```

`LANG=en_US.UTF-8` matters: CocoaPods fails without a UTF-8 locale.
Android: `npx expo run:android`. This is a native build, so Expo Go cannot run it.

On a phone, sign with your own Apple ID: set `APPLE_TEAM_ID` and your own `TRANSMITTER_BUNDLE_ID`
before `npx expo run:ios --device`, because `dev.voicetomap.transmitter` belongs to Alex's team
(`app.config.ts`). Every step, with checks: [../docs/setup.md](../docs/setup.md).

## Which coordinator it talks to

A development build loads its code from the computer running the dev server, so it knows that
computer's address. It sends reports to the coordinator on that same computer, port 3117
(`npm run dev -- -p 3117` in the folder above). Setup switches between "This Mac" and
"Live site" (`https://edth-hackathon.vercel.app`), and the dot beside the call sign shows whether
the coordinator answers (re-checked every 15 seconds). `EXPO_PUBLIC_SERVER_URL` overrides the default.

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
internet and a key. In offline mode (`PROVIDER_MODE=local`) it needs neither, but it takes text
only: use "Phone: base" or "Phone: small", not "Server" ([../docs/setup.md](../docs/setup.md), part 3).

Checked on 20 Nov on an iPhone 13 mini through the coordinator on the Mac: the Kyiv scenario
ran twice, 10 of 10 steps as expected, round trip 1.2 to 1.9 s (median 1.5 s), with server
speech-to-text. Results: `../scenarios/results/iphone13mini-via-mac-coordinator-2026-11-20.jsonl`.
On-phone speech-to-text has not been run on a real phone yet.

## Speech-to-text: on the server or on the phone

Setup chooses where speech becomes text (`src/stt.ts`).

| Mode | What happens | Needs |
|---|---|---|
| Server | The clip is uploaded and the coordinator transcribes it (Mistral). | A connection good enough for audio |
| Phone: base | Whisper `ggml-base-q5_1` runs on the phone; only the words are sent. | A one-time 56 MB download |
| Phone: small | Whisper `ggml-small-q5_1`, slower and more accurate. | A one-time 181 MB download |

Models come from `ggerganov/whisper.cpp` on Hugging Face and are kept in the app's documents.
"Place-name hints" gives Whisper a short list of the area's place names (`src/hints.generated.json`,
the head of the list the server sends Mistral).

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

Phone modes transcribe scenario clips on both platforms. The microphone uses them on iOS only for
now: Whisper needs uncompressed audio, which Android's recorder cannot write.

## What you hear

A scenario sends its clips as data, so by default nothing is played: that is what makes it
usable in a quiet room. The phone speaks only the coordinator's question ("Speak questions"
in Setup), and only when the coordinator asks one. "Play scenario clips aloud" plays each clip
through the phone's speaker before it is sent, for an audience. Sound comes out even with the ring switch on silent.

## Scenarios

`../scenarios/*.json` describe scripted reports and what the coordinator should answer.
`npm run scenarios` (in the folder above, on a Mac) makes the clips with synthetic voices and
writes `scenarios/index.ts` here. "Play scenario" sends every step and marks each one ✓ or ✗
against its expected answer.
