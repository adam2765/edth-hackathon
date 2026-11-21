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

The phone detects reachable coordinators from the USB/Metro host and its LAN Bonjour
service directory. Tap Connect beside a server; multiple servers appear as separate rows.
The phone automatically joins the newest running mission and follows newer missions
between reports. There is no mission picker or Join/Leave control. With no running mission,
it shows Waiting for mission and joins when the server starts one.

The header shows the server and mission code. Green Reporting means the server confirmed
the mission join. A report counts as received only after the server acknowledges saving it.
The receiver flags recent reports arriving in another mission and can open that mission.

Setup contains call sign, language, detected Hosts, spoken questions and Developer tools.
Developer tools contains host override, scenarios, test clips and technical timings.
The mission sets the area. Phone speech-to-text is replaced by audio capture and coordinator transcription.

## Run it

From the repo root: `npm run build`, then `npm start`. Build checks source and dependencies
and loads the phone app if changed or missing. Start restarts servers without opening the
phone app. Open Transmitter yourself and tap **Connect** when it finds the coordinator.
If no mission is running, it says so. Start one on the receiver and the phone joins the newest running mission automatically.
`npm stop` stops project processes and the connected phone app, preserving settings/data.

No routine parameters. Connect only the phone being used. Tools and signing are in
[setup](../docs/setup.md). The host remembers the phone. iPhone compilation requires a
Mac with Xcode; free Apple provisioning expires after seven days. No EAS.

Advanced developers can still run the component commands listed in
[setup](../docs/setup.md#advanced-console-use). Phone JavaScript is served by Metro;
only native changes need a new native binary. Voice-to-text runs on the coordinator.

## Which coordinator it talks to

The server startup supplies the coordinator address. Android USB uses loopback plus forwarding;
iPhone uses the host’s `.local` name. Direct development builds can still infer the host
from Metro, and `EXPO_PUBLIC_SERVER_URL` overrides that default. A manually selected host
is remembered. There is no automatic fallback to the public site.

Setup → Hosts lists discovered reachable coordinators. A manual override remains in
Developer tools. No new native phone dependency is needed for discovery: the existing
Metro/USB host browses LAN advertisements and the phone verifies each candidate.

## Speech-to-text on the coordinator

Microphone and scenario utterances send audio through the same report path. The phone
records 16 kHz mono AAC/m4a and sends it with the selected language; it does not load a
speech model or transcribe. In local mode, the coordinator uses Whisper base (temporary RAM workaround)
through whisper-server with Silero VAD and ffmpeg conversion. Hosted mode uses Mistral.
A report counts as successful only after the coordinator acknowledges saving it.

Build prepares the host’s models. Start/Stop manage the speech server with the other
components. The native package dependencies are retained for compatibility with installed
builds; the active recording and scenario paths no longer import the phone transcriber.
No speech mode, model download or test-clip selector is needed on the phone.

### Historical model comparison

The following measurements predate the fixed-model app; the compared modes are no longer
user-selectable.

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

The measurements above describe the old on-phone path. They are not measurements of
the merged coordinator path. Live microphone recognition on this Mac/phone pair remains
to check after the coordinator tools and models are installed.

## What you hear

A scenario sends its clips as data, so by default nothing is played: that is what makes it
usable in a quiet room. The phone speaks only the coordinator's question ("Speak questions"
in Setup), and only when the coordinator asks one. In Developer tools, "Play scenario clips aloud" plays each clip
through the phone's speaker before it is sent, for an audience. Sound comes out even with the ring switch on silent.

## Scenarios

`../scenarios/*.json` describe scripted reports and what the coordinator should answer.
`npm run scenarios` (in the folder above, on a Mac) makes the clips with synthetic voices and
writes `scenarios/index.ts` here. "Play scenario" sends every step and marks each one ✓ or ✗
against its expected answer.
