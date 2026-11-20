# Voice-to-Map: design document

EDTH Paris 2026, challenge 01 (Lysk). Status as of Friday 20 November, 18:00 Paris.

This is for the whole team: two of us are building from Friday evening, two join on Saturday. It collects what we are building and why, what exists, what is decided, and what is left. It is the source of truth in the repo; coding agents (Claude Code and Codex) reach it through `AGENTS.md`.

Related files:

- [README.md](../README.md): how the pipeline works, the resolver rules, demo scripts, how to run it.
- [DECISIONS.md](../DECISIONS.md): every choice made so far, numbered. A number in brackets below, such as [46], is a decision there.
- [transmitter/README.md](../transmitter/README.md) and [scenarios/README.md](../scenarios/README.md).

## 1. The challenge

Lysk's brief: teams report their position by voice ("I am behind the church", "I moved towards 35th street"), and someone updates the map by hand, which is slow and error-prone. Build a web app that turns short spoken updates into live updates on a shared map, with timestamps and history. The suggested stack (OpenStreetMap, a speech-to-text API, Mistral) is "indicative only". The listed equipment is a headset. Mentors: Henry Heinemann and Florent Ogès (edth@lysk.ai). Eight other teams picked the same challenge.

What the jury will look at, from Lysk's deck ([PDF on Drive](https://drive.google.com/file/d/1RyyaEdsCgXme1-N0GpvC1ipxEhRZ7AZY/view)):

| Judged item | Where we stand |
|---|---|
| It works live: speak, and the map updates within seconds | Met on the live site: about 1 to 3 s from release to pin |
| Natural phrasing is understood ("south of the church", "towards 35th street") | Met for both deck sentences, with a real street in place of "35th street" |
| Marker and path, with timestamps and a browsable history | Partly met. One phone shows a marker, a trail, times and a log. The deck shows a *shared* map, a marker labelled with a call sign (ALPHA 2), and a history "anyone can replay". None of that exists yet. This is our biggest gap. |

Our own differentiators (asking back, Ukrainian, no invented coordinates) come on top of these three, not instead of them. The deck mentions none of them.

## 2. Our approach

- **Ask back instead of guessing.** When a report could mean more than one place, the system asks which one, aloud, with up to three choices. A silently wrong pin is worse than a question.
- **The language model never produces coordinates.** It only extracts intent: place name, category, relation, a stated distance, a compass direction, language. Deterministic code resolves that against a local gazetteer built from OpenStreetMap. Nothing is invented.
- **No GPS.** The app never reads the phone's location, so jamming does not affect it. Position comes from named places, and from dead reckoning off the last known position when a report states a distance and a compass direction [54].
- **Three languages, two areas.** English and French in Vincennes; Ukrainian and English in central Kyiv. A report in Russian is answered in Ukrainian [38].
- **European providers.** Mistral for speech-to-text and extraction, with the server in Vercel's Paris region [25]. ElevenLabs was removed because it is not EU-resident [42]. Vercel itself is a US company; we accept that for now, and moving later is small (plain Next.js, no Vercel-specific packages).
- **Works without a network.** Alex has made an uplink-off demo mandatory for Demo Day. Specified in section 8.2, not built.

## 3. Timeline

| When (Paris) | What |
|---|---|
| Fri, before 18:00 | Prior work: the stage-1 web app. The tag `prior-work-fri-1800` marks it; leave the tag where it is. The jury counts only work done during the event. |
| Fri evening | Shared map and replay (section 8.1). On-device speech-to-text in the transmitter (built; measured in the simulator, not yet on a phone). |
| Sat morning | Two new teammates join. Local mode starts and needs at least two people. |
| Sat midday | Local mode working and tested in the hall |
| Sat afternoon | Field walk for an error figure; show Lysk's mentors a working version |
| Sat 22:00 | Feature freeze |
| Sun 10:00 | Demo video done |
| Sun 11:00 | Deck done |
| Sun 11:30 | Submit (deadline 12:00), file named with the team number |

## 4. System overview

Terms used throughout:

- **Transmitter**: anything that captures a spoken report. Today that is the phone web page and a native app in `transmitter/`. Lysk's real users may well use radios; the coordinator does not care where a report comes from [58].
- **Coordinator**: the server endpoint `POST /api/report`. Speech-to-text, then intent extraction, then the resolver. It stores nothing today.
- **Receiver**: the shared map a person at a command post watches, with every call sign and a replay. Not built yet.
- **Area**: a region with its own gazetteer file (`vincennes`, `kyiv`).

```
transmitters                 coordinator (Next.js, Vercel cdg1)                     receiver (to build)
────────────                 ──────────────────────────────────                     ───────────────────
phone web page ──┐           POST /api/report
native app ──────┼─ audio ──►  1. speech-to-text   Mistral voxtral-mini-transcribe-3,
scenario clip ───┘  or text      (skipped for text)  place names sent as context_bias
                    + area     2. extraction       Mistral mistral-small-latest, strict JSON schema
                    + last     3. resolver         pure code + data/gazetteer.<area>.json
                    position  ◄─ { transcript, language, intent, resolution, timings_ms }
                                                                  ── report log ──►  shared map, replay
```

Where each step runs today:

| Step | Where |
|---|---|
| Recording | On the phone |
| Speech-to-text | Mistral's API, called from our server in Paris |
| Intent extraction | Mistral's API, same route |
| Resolving the place | Our server; plain code, no AI, no outside calls |
| Map | On the phone; tiles, fonts and icons from OpenFreeMap |
| Speaking the question | The browser's voice for English and French; for Ukrainian, a Piper voice that runs in the browser [49] |
| State (position history) | On the phone only; the last position is sent with each report |

## 5. What is built

| Part | Where | Status |
|---|---|---|
| Phone web page: hold to talk, map, pin with confidence circle, ask-back card, log, text box | `app/page.tsx`, `components/VoiceMapApp.tsx` | Live. Checked in a phone-sized desktop browser; no real-phone result is recorded yet. |
| Report endpoint | `app/api/report/route.ts` | Live |
| Speech-to-text and extraction | `lib/providers/transcriber.ts`, `lib/providers/extractor.ts` | Mistral only, behind interfaces so local models can be swapped in |
| Resolver | `lib/geo/resolver.ts` | Pure function. 50 tests pass (resolver and voice). |
| Gazetteers | `data/gazetteer.vincennes.json` (889 places), `data/gazetteer.kyiv.json` (2,112) | Built with `npm run gazetteer -- <area>` from one Overpass query; the running app never calls Overpass |
| Ukrainian voice for questions | `lib/tts/`, test page at `/tts-lab` | Live. Piper `uk_UA-ukrainian_tts-medium`, speaker tetiana, through onnxruntime-web. 77 MB on first load, with nothing on screen to show it. Phones unmeasured. |
| Stated distances, eight compass points, dead reckoning | resolver and extractor | On `main`, **not deployed** |
| Native transmitter (Expo 58, React Native) | `transmitter/` | Runs in the iPhone simulator. The Vincennes scenario scored 4 of 4 and Kyiv 5 of 5 against the live site. Not yet on a real phone or Android. |
| On-device speech-to-text in the transmitter (Whisper via `whisper.rn`) | `transmitter/src/stt.ts` | Built. In the simulator, on the 9 scenario steps: server 9 of 9; phone `small` 8 of 9; phone `base` 8 of 9 with place-name hints and 4 of 9 without. Every miss was a question or "could not place", never a wrong pin. Speed on a real phone is not measured [71 to 74]. |
| Scenarios with expected answers | `scenarios/*.json`; clips in `transmitter/scenarios/audio/` | 2 scenarios, 9 steps, synthetic voices |
| Shared map, call signs, replay | | Not started |
| Local (uplink-off) mode | | Specified, not started |
| Evaluation harness beyond unit tests | | Planned, not started |

**Deploys.** The live site is https://edth-hackathon.vercel.app. It is deployed with the Vercel CLI from Alex's account; the project is not connected to GitHub, so a push does not deploy. Production is at commit `384d7aa`, behind `main`.

**Repo.** https://github.com/beverage/edth-hackathon is public. Commit author emails are therefore public too.

## 6. Contracts

These are the seams between the parts. Work on either side of one can go ahead independently, as long as the contract holds.

### 6.1 Report endpoint

`POST /api/report`, multipart form:

| Field | Meaning |
|---|---|
| `audio` (file) or `text` | The report. Text skips speech-to-text: it is the test hook and the demo fallback if the hall is too noisy. |
| `area` | `vincennes` (default) or `kyiv` |
| `lastPosition` | JSON `{ lat, lon, ts, uncertainty_m?, radius_m? }`. `uncertainty_m` is set only when the last position was an estimate [47, 56]. |
| `clientTs` | Client time, epoch ms |
| `session`, `callsign`, `seq` | Sent by the transmitter. The server ignores them until it stores reports [63]. |

Reply: `{ transcript, language, intent, resolution, timings_ms: { stt, extract, resolve, total } }`.

Limits: 1 MB per clip (about 15 s), 500 characters of text, 30 requests a minute per IP per server instance [24]. No auth.

The types live in `lib/geo/types.ts`. The transmitter imports them as types only, so a change to the reply shape shows up as a type error in the app [67].

### 6.2 Intent (what the model returns)

`kind` (position, movement, other), `landmark_text` (verbatim), `landmark_name`, `landmark_name_lemma` (the name in dictionary form, for Ukrainian case endings [32]), `landmark_category` (church, metro_station, castle, town_hall, school, park, hospital, police, bridge, street, other), `relation` (at, near, in_front_of, behind, next_to, eight compass relations, towards, between), `distance_m` (only if a distance was said, at most 20 km [51]), `direction` (eight compass points, for movement), `language` (en, fr, uk), `confidence` (not used by anything yet).

### 6.3 Resolution (what the resolver returns)

`status` (resolved, ambiguous, unresolved), `pin`, `radius_m`, `heading_to` (target of a movement), `estimated` (worked out from the last position, shown with ≈), `candidates` (up to three, each with its own precomputed placement, so tapping a choice needs no second call [18]), `question` (the ask-back or the prompt), `evidence` (the rule that fired and the gazetteer id).

### 6.4 Utterance (transmitter side)

One spoken report, whatever produced it: `seq`, `callsign`, `source` (mic, scenario, open_mic), the audio file or the text, start and end times. Every source feeds the same send path, so a scripted clip goes down exactly the path a recording does [60, 61]. Defined in `transmitter/src/types.ts`.

### 6.5 Scenario file

`scenarios/<id>.json`: steps with a time offset, call sign, language, the words, the answer the coordinator should give (`status`, `feature_id`, `heading_to`) and which choice to tap if it asks back. Because every step says what should happen, a run gives a score [62]. Format in [scenarios/README.md](../scenarios/README.md).

### 6.6 Provider interfaces

`Transcriber.transcribe(audio, mime, biasTerms) → { text, language }` and `IntentExtractor.extract(text) → Intent`. Local mode adds a second implementation of each behind one switch, `PROVIDER_MODE=hosted|local`.

## 7. The resolver in brief

The full table is in the README. The main rules:

- A named place with one good match is resolved. Several good matches give a question, unless a category word said outside the name narrows it ("the Château de Vincennes **metro station**") [15].
- A category alone ("the church") looks within 1.5 km of the last position. Several candidates resolve only if the last position is under 10 minutes old and the nearest is under 0.4 times the distance of the second; otherwise the app asks.
- A name not in the gazetteer, but with a category, asks among that category. It never guesses.
- The same name in the same spot (a station and the square above it) counts as one place, with a wider circle [35].
- Radius: "at" 30 m; near, behind, in front of, next to 80 m; compass relations 100 m out with a 100 m circle; a stated distance replaces those defaults [52, 53].
- Movement towards a place moves the marker to the middle of the leg, with a circle spanning the leg and an arrow [46]. A stated distance moves it that far along the leg instead [55].
- Dead reckoning ("moved 300 metres north") moves from the last position; the circle grows with each leg until a report names a place again [54].
- A position that is an estimate only wins "nearest" if that still holds when it is off by its full radius [47].

## 8. Work ahead

### 8.1 Receiver: shared map and replay (judged; first priority tonight)

Agreed with Alex on Friday: view-only to start, laid out for a laptop or projector first.

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

Size: about one evening for one person. It splits three ways: storage and endpoint, receiver map and feed, replay.

### 8.2 Local mode: uplink-off demo (mandatory for Demo Day; target Saturday midday)

One switch, `PROVIDER_MODE=hosted|local`; nothing else in the app changes. The MacBook (M1 Pro, 32 GB) serves the app; phones reach it over a hotspot or travel router with no internet. Use local mode for the in-hall demo and hosted mode over mobile data for the outdoor field walk.

| Track | Item | Size |
|---|---|---|
| A. Network (do first) | A Wi-Fi network with no internet that the phones join | 0.5 to 1 h |
| A | Serve the app from the MacBook over HTTPS the phones accept | 1 to 3 h |
| A | Prove on iOS and Android, mobile data off, that the microphone opens | 0.5 h |
| B. Models | The `PROVIDER_MODE` switch | 0.5 h |
| B | Local speech-to-text: Whisper large-v3-turbo (whisper.cpp server or MLX), about 1.6 GB, plus the adapter | 2 to 3 h |
| B | Local extraction: a 7B to 8B model through Ollama with schema-constrained output, about 5 GB; tune the prompt | 2 to 4 h |
| C. Offline map | Save tiles, fonts and icons locally, plus a local map style | 2 to 3 h |
| D. Evidence | Record ten real clips, some with hall noise | 0.5 h |
| D | `scripts/bench-local.ts`: run the clips through both modes, print per-step timings and whether the place matched; rehearse in the hall | 3 h |
| E. Receiver | A local file store behind the storage interface | 1 to 2 h |

About 1.5 to 2 person-days in all. A, B and C can run in parallel.

Things already found:

- **No PMTiles needed.** Both areas together are 164 tiles with a margin for panning, so a plain folder of files does. OpenFreeMap allows offline downloads up to 3,000 tiles.
- **Fewer place names for Whisper.** Its prompt holds about 40 to 60 names against the 100 we send Mistral, so send the ones nearest the last position.
- **Extraction is mostly configuration.** Ollama accepts the request shape the current extractor sends. Not yet tried.
- **Starting point on the MacBook:** Ollama 0.8.0 installed but no models; no Whisper; ffmpeg present; no local certificate tool.
- **Target under 4 s** from end of speech to pin. If the benchmark is over, drop to a 3B to 4B extraction model before touching anything else.

Why HTTPS matters: browsers only open the microphone on HTTPS pages (or `localhost`). Offline, no public certificate is possible for a private address. Options:

| Option | What the phone user does | Works for | Effort |
|---|---|---|---|
| Home-made certificate, accept the warning | Taps through a warning once | Any phone | About 15 min; try this first, untested |
| Our own certificate authority installed on the phone | Installs a profile once | Our phones only | 1 to 2 h |
| Real certificate for a domain we own, router points it at the MacBook | Nothing | Any phone, including a judge's | 2 to 3 h, needs a domain and a travel router |

The native transmitter sidesteps this: it may use plain `http://` on the local network, and with on-device speech-to-text (section 8.3) the MacBook only runs extraction and the resolver. The receiver on the MacBook's own screen and typed reports need no certificate at all.

Open calls for Alex: whose phones (ours only, or any phone); travel router or the Mac's hotspot; Ukrainian offline or English and French only (a small model may handle Ukrainian dictionary forms poorly); Mistral's open models first for the European story, or whichever is fastest.

### 8.3 Transmitter

- **Built:** on-device speech-to-text with Whisper (`whisper.rn`), switchable on screen between the server, `ggml-base-q5_1` (56 MB) and `ggml-small-q5_1` (181 MB). The phone then sends text, and the server skips its own speech-to-text. Results are in [transmitter/README.md](../transmitter/README.md) and `scenarios/results/`. Still to do: measure speed on a real phone, record uncompressed audio on Android (the microphone there still goes through the server), and try pinning the language.
- **Later, about one day:** an open microphone with no button, cutting at pauses. Tuning against hall noise is the risk. The microphone is muted while the app speaks a question, and the coordinator learns to drop non-reports and duplicates. Screen-off listening is another half day and not planned.
- **Stress scenarios** to build as data files: eight to ten call signs at once; late, out-of-order and duplicate reports; several open questions at once; implausible jumps (3 km in 20 s); units that go silent; radio-style audio with static and clipping; mixed languages; a spoken call sign that does not match the device. A laptop script can play many units at once with no phones.
- **Installing:** iPhones by cable from a Mac with Xcode, with a free Apple ID; each phone needs Developer Mode and the install expires after 7 days. Android by install file. Expo Go cannot run it, because on-device speech-to-text and an open microphone need native modules [59].

### 8.4 Evaluation harness

Planned on Friday and held until the team formed; it can start now. Smaller than levelang's on purpose, because this pipeline has exact answers.

- **Layer 1, resolver unit tests:** exist (`npm test`).
- **Layer 2, text evaluation:** 60 to 80 cases, each a transcript with the expected intent fields and outcome, run through `getExtractor()` and `resolve()` in-process. Flags for area, language, tag, model and repeat count. Needs `MISTRAL_API_KEY`.
- **Layer 3, audio evaluation:** real clips recorded by the team on phones, scored on whether the right place resolves, not on word error rate. This is where the place-name bias list gets tuned.
- **Headline metric: the wrong-pin rate.** Each failure is attributed to a stage (speech-to-text, extraction, resolver) so we know what to tune. Each run is compared with one committed baseline file.
- Pin a dated Mistral model once there is a baseline; `mistral-small-latest` can change underneath us.
- Reuse the scenario files: they already carry expected answers.
- Needs: real voices from the team, and a native Ukrainian speaker to check the Ukrainian cases.

Lessons carried over from levelang: Mistral Small plateaued at 88 to 89% on French there, but that was a harder, generative task; negative framing and explicit named blocks work on Mistral; temperature 0 is not deterministic; the rate limit was 6 requests a second with no client retry.

### 8.5 Demo and evidence

- Real-phone check of the web page on iOS Safari and Android Chrome over mobile data.
- Field walk with GPS logged silently as ground truth, to give an error figure in metres. GPS is used only to score; the app never reads it.
- The demo scripts in the README (Vincennes, then Kyiv), rehearsed.
- The local-against-hosted benchmark for a feasibility slide.
- Video by Sunday 10:00, deck by 11:00.

### 8.6 Suggested split for four

A proposal to agree on, not a decision:

| Stream | Friday evening | Saturday |
|---|---|---|
| 1. Receiver and storage (8.1) | Shared log, receiver page, live feed | Replay, fading, local file store (track E) |
| 2. Transmitter (8.3) | On-device speech-to-text (in progress) | Stress scenarios, multi-unit player, real phones |
| 3. Local mode (8.2) | | Network and HTTPS (A), offline map (C), local models (B) |
| 4. Evaluation and demo (8.4, 8.5) | | Text cases, team voice clips, benchmark, field walk, deck |

Streams 1, 3 and 4 are TypeScript in the Next.js app and run headless with `npm test`, so they suit any setup, including Codex. Stream 2 needs a Mac with Xcode for iOS builds.

## 9. Open questions

### For the team

1. **Priority.** Shared map and replay (judged) against local mode (mandatory for the demo). Current plan: receiver tonight, local mode from Saturday morning with two people.
2. **Deploy access.** Connect the Vercel project to GitHub so pushes deploy, or keep CLI deploys from Alex's account.
3. **Mistral key.** One shared team key, or each person their own.
4. **Git workflow for four.** Everyone commits to `main` in small commits and runs `git pull --rebase` before pushing, or short branches with pull requests.
5. **Test area.** Lysk may test outside Vincennes and central Kyiv. A new area is one command and about a minute once we know where.
6. **Licence.** The repo is public with no licence file, and Lysk's IP terms are unknown.

### For Lysk

If there are only two minutes, ask 1, 4 and 5.

1. Where does the audio come from: each person's own device, or a shared radio channel heard at the command post?
2. Do speakers say their call sign in each report? Is there a standard phrasing?
3. Who looks at the map? Do the speakers ever see it?
4. When a report is unclear today, what happens? Which is worse: a marker in the wrong place, or no marker until someone clarifies? Could the system ask back itself, and to whom?
5. How will you test on Sunday: your sentences and places or ours? In which area?
6. How do people name places: landmarks, streets, grid references, distance and bearing?
7. For "I moved towards 35th street", where should the marker end up? (We put it half way with a wide circle.)
8. Which languages do reports come in? Ever mixed in one sentence?
9. Is there internet where this is used? Must audio stay on the device or in Europe?
10. Is "web app" a requirement for capturing the voice, or only for the map?
11. Do you have sample recordings, ideally real radio audio?
12. What do you want from history: a replay, a log, an export?
13. What IP terms apply to what we build?
14. Can we show you a working version on Saturday afternoon?

## 10. Known gaps and risks

- **Mixed languages in one clip:** in one synthetic test the English half of a Ukrainian-then-English clip was dropped.
- **One place per report:** intersections, "between A and B" and "at A, going to B" keep only one place.
- **Spoken coordinates and grid references** are not parsed.
- **Real Ukrainian speech is untested;** all Ukrainian tests used a synthetic voice. Short clips sometimes came back misspelled, though the place still resolved.
- **Language tagging:** an English sentence with a French street name was tagged as French, so a follow-up question would have been in French.
- **No retry on Mistral rate limits;** a refused call fails the report. Most calls take under a second, but one took 8.3 s against a 10 s timeout.
- **Interface text is English only;** only the question and place names follow the speaker's language [39].
- **The Ukrainian voice downloads 77 MB** the first time with nothing on screen to show it.
- **No auth;** the rate limit is per server instance and is not a security control.
- **The live site lags `main`** until someone deploys.

## 11. Getting started

Web app and coordinator:

```bash
git clone git@github.com:beverage/edth-hackathon.git
cd edth-hackathon
npm install
cp .env.example .env.local   # then fill in MISTRAL_API_KEY; never commit it
npm run dev -- -p 3117
```

Checks to run before pushing:

```bash
npm test && npx tsc --noEmit && npm run lint
```

The transmitter has its own `package.json` and tooling; see [transmitter/README.md](../transmitter/README.md). iOS builds need a Mac with Xcode.

**Coding agents.** `AGENTS.md` at the root, plus `transmitter/AGENTS.md` inside that folder, is the one instruction file for both Claude Code and Codex. Put project rules there, not in a tool-specific file, so every agent sees the same ones. Unit tests need no network or key; anything that calls Mistral or Overpass needs both, so an agent in a sandbox without network can run the tests but not the evaluation or the gazetteer build.

**Working agreements (proposed).**

- Record every choice in `DECISIONS.md`: one numbered line, appended at the end. If two people add one at the same time, keep both and renumber yours.
- Run the checks above before pushing.
- Secrets live in env vars only. The repo is public.
- Changing `lib/geo/types.ts` or the endpoint's fields changes the contract for the transmitter and the receiver: say so to whoever works on the other side.
- Leave the `prior-work-fri-1800` tag alone.

## 12. Glossary

| Term | Meaning |
|---|---|
| Ask-back | The question the app asks, aloud and on screen, when a report could mean more than one place |
| Area | A region with its own gazetteer: `vincennes` or `kyiv` |
| Bias terms | Up to 100 place names sent to speech-to-text so it spells them right (`context_bias`) |
| Coordinator | The server endpoint that turns a report into a placement |
| Dead reckoning | Working out a position from the last one plus a stated distance and compass direction |
| Estimate (≈) | A position worked out from a movement, not from a named place; shown with ≈ |
| Gazetteer | Our local list of named places from OpenStreetMap, one file per area |
| Receiver | The shared map with every call sign and a replay (to build) |
| Transmitter | Anything that sends a spoken report: the web page, the native app, a scenario clip |
| Wrong-pin rate | Share of reports placed confidently in the wrong place; the headline quality figure |
