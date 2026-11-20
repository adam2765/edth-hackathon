# Plan: work ahead

What is left, by part. Status as of Friday 20 November, evening. When you start or finish something here, change this file in the same commit.

## Receiver: shared map and replay

First priority on Friday evening, because it is the judged item we miss. About one evening for one person. Agreed with Alex on Friday: view-only to start, laid out for a laptop or projector first.

What the jury would see: a laptop shows the receiver, two or three phones are speakers with call signs, someone speaks and their marker moves on the big screen within seconds. An ambiguous report shows as "awaiting answer" until the speaker taps a choice. Then we drag a slider and replay the last five minutes.

In scope:

- **Shared record:** the coordinator saves every report as one entry in an append-only log, tagged with a session code and call sign.
- **Receiver page:** one coloured marker per call sign, with its name and last-update time, confidence circle, trail and movement arrow.
- **Live feed:** a side list of reports (time, call sign, transcript, outcome); clicking one flies the map to it.
- **Pending questions:** an open ask-back shows on the receiver, with its candidates numbered on the map.
- **Replay:** a time slider and play button that rebuild the map from the log up to any moment.
- **Fading:** a marker dims when its speaker has been silent for a few minutes.
- **Speaker side:** pick a call sign once and join a session by link; nothing else changes.

Out of scope: logins and roles, editing or deleting reports, the receiver talking back, GPS ground truth, grid references, drawing tools.

Design choices:

- **Polling, not push.** The receiver asks for new entries every second. Simpler than a live channel, and it works the same hosted and offline.
- **Storage behind one interface.** A hosted database (Supabase, per the original brief) and a local file for offline mode. A cloud-only store would break the offline demo.
- **Call sign from the words as a fallback.** If Lysk's audio turns out to come from a shared radio channel, the speaker has to be identified from what they say ("Alpha 2, I'm south of the church"), not from the device.

It splits three ways: storage and endpoint, receiver map and feed, replay.

**Status, Friday evening:** built [98 to 103]. Open it at `/receiver?session=demo` on the coordinator the phones send to. Every item in scope above is done except the speaker side: the transmitter always sends to session `demo`, and the call sign is typed on its screen. Also done: tapped choices now reach the server, which the plan had missed [100], and the local file store from track E below [101].

Still to do:

- **Run it with phones.** Two or three phones sending to the Mac, the receiver on a second screen or projector. So far it is checked only with typed reports.
- **Hosted store.** The live site keeps no record, so its receiver stays empty. Supabase in its Paris region is the brief's suggestion; it needs a new project (Alex's call).
- **Remove the phone web page** at `/` and make the receiver the home page, once Alex says so [98]. That also drops the Ukrainian Piper voice, which only the web page uses; the native app speaks with the phone's own voice.
- **Session by link**, if more than one demo runs at once.

## Local mode

The uplink-off demo. Mandatory for Demo Day; target Saturday midday. About 1.5 to 2 person-days; the riskiest part is the network and HTTPS, not the models.

One switch, `PROVIDER_MODE=hosted|local`; nothing else in the app changes. The MacBook (M1 Pro, 32 GB) serves the app; phones reach it over a hotspot or travel router with no internet. Use local mode for the in-hall demo and hosted mode over mobile data for the outdoor field walk.

| Track | Item | Size |
|---|---|---|
| A. Network (do first) | A Wi-Fi network with no internet that the phones join | 0.5 to 1 h |
| A | Serve the app from the MacBook over HTTPS the phones accept | 1 to 3 h |
| A | Prove on iOS and Android, mobile data off, that the microphone opens | 0.5 h |
| B. Models | The `PROVIDER_MODE` switch | done |
| B | Local speech-to-text: Whisper large-v3-turbo (whisper.cpp server or MLX), about 1.6 GB, plus the adapter. Not needed for the transmitter's phone modes | 2 to 3 h |
| B | Local extraction: Ministral 3 3B through Ollama with the same schema, 3 GB. Built; the prompt is not tuned for it yet | done |
| C. Offline map | Save tiles, fonts and icons locally, plus a local map style | 2 to 3 h |
| D. Evidence | Record ten real clips, some with hall noise | 0.5 h |
| D | `scripts/bench-local.ts`: run the clips through both modes, print per-step timings and whether the place matched; rehearse in the hall | 3 h |
| E. Receiver | A local file store behind the storage interface | 1 to 2 h |

A, B and C can run in parallel.

Things already found:

- **No PMTiles needed.** Both areas together are 164 tiles with a margin for panning, so a plain folder of files does. OpenFreeMap allows offline downloads up to 3,000 tiles.
- **Fewer place names for Whisper.** Its prompt holds about 40 to 60 names against the 100 we send Mistral, so send the ones nearest the last position.
- **Extraction was configuration.** Ollama takes the request the extractor already sends, schema included, and every reply was valid JSON. `PROVIDER_MODE=local` is built; see the README's [Offline](../README.md#offline-models-on-this-computer) section, and [setup.md](setup.md#3-offline-mode) to set it up on another computer.
- **3B, not 8B.** On the 9 scenario texts: Mistral Small 9 of 9 at 0.8 s, Ministral 3 8B 8 of 9 at 5.1 s, Ministral 3 3B 8 of 9 at 2.0 s. Both local models miss "Golden Gate" with a question, not a wrong pin [84].
- **On the MacBook now:** Ollama 0.40.16 with `ministral-3:3b` and `ministral-3:8b`; no Whisper; ffmpeg present; no local certificate tool.
- **Target under 4 s** from end of speech to pin. Local extraction leaves about 1.5 s for the phone's speech-to-text, which is not yet measured on a real phone.

Why HTTPS matters: browsers only open the microphone on HTTPS pages (or `localhost`). Offline, no public certificate is possible for a private address. Options:

| Option | What the phone user does | Works for | Effort |
|---|---|---|---|
| Home-made certificate, accept the warning | Taps through a warning once | Any phone | About 15 min; try this first, untested |
| Our own certificate authority installed on the phone | Installs a profile once | Our phones only | 1 to 2 h |
| Real certificate for a domain we own, router points it at the MacBook | Nothing | Any phone, including a judge's | 2 to 3 h, needs a domain and a travel router |

The native transmitter sidesteps this: it may use plain `http://` on the local network, and with on-device speech-to-text (see [Transmitter](#transmitter)) the MacBook only runs extraction and the resolver. The receiver on the MacBook's own screen and typed reports need no certificate at all.

Open calls for Alex: whose phones (ours only, or any phone); travel router or the Mac's hotspot; Ukrainian offline or English and French only (a small model may handle Ukrainian dictionary forms poorly); Mistral's open models first for the European story, or whichever is fastest.

## Transmitter

- **Built:** on-device speech-to-text with Whisper (`whisper.rn`), switchable on screen between the server, `ggml-base-q5_1` (56 MB) and `ggml-small-q5_1` (181 MB). The phone then sends text, and the server skips its own speech-to-text. Results are in [transmitter/README.md](../transmitter/README.md) and `scenarios/results/`. Still to do: measure speed on a real phone, record uncompressed audio on Android (the microphone there still goes through the server), and try pinning the language.
- **Later, about one day:** an open microphone with no button, cutting at pauses. Tuning against hall noise is the risk. The microphone is muted while the app speaks a question, and the coordinator learns to drop non-reports and duplicates. Screen-off listening is another half day and not planned.
- **Stress scenarios** to build as data files: eight to ten call signs at once; late, out-of-order and duplicate reports; several open questions at once; implausible jumps (3 km in 20 s); units that go silent; radio-style audio with static and clipping; mixed languages; a spoken call sign that does not match the device. A laptop script can play many units at once with no phones.
- **Installing:** iPhones by cable from a Mac with Xcode, with a free Apple ID; each phone needs Developer Mode and the install expires after 7 days. Android by install file. Expo Go cannot run it, because on-device speech-to-text and an open microphone need native modules [59].

## Evaluation harness

Planned on Friday and held until the team formed; it can start now. Smaller than levelang's on purpose, because this pipeline has exact answers.

- **Layer 1, resolver unit tests:** exist (`npm test`).
- **Layer 2, text evaluation:** 60 to 80 cases, each a transcript with the expected intent fields and outcome, run through `getExtractor()` and `resolve()` in-process. Flags for area, language, tag, model and repeat count. Needs `MISTRAL_API_KEY`.
- **Layer 3, audio evaluation:** real clips recorded by the team on phones, scored on whether the right place resolves, not on word error rate. This is where the place-name bias list gets tuned.
- **Headline metric: the wrong-pin rate.** Each failure is attributed to a stage (speech-to-text, extraction, resolver) so we know what to tune. Each run is compared with one committed baseline file.
- Pin a dated Mistral model once there is a baseline; `mistral-small-latest` can change underneath us.
- Reuse the scenario files: they already carry expected answers.
- Needs: real voices from the team, and a native Ukrainian speaker to check the Ukrainian cases.

Lessons carried over from levelang: Mistral Small plateaued at 88 to 89% on French there, but that was a harder, generative task; negative framing and explicit named blocks work on Mistral; temperature 0 is not deterministic; the rate limit was 6 requests a second with no client retry.

## Demo and evidence

- Real-phone check of the web page on iOS Safari and Android Chrome over mobile data.
- Field walk with GPS logged silently as ground truth, to give an error figure in metres. GPS is used only to score; the app never reads it.
- The demo scripts in the README (Vincennes, then Kyiv), rehearsed.
- The local-against-hosted benchmark for a feasibility slide.
- Video by Sunday 10:00, deck by 11:00.
