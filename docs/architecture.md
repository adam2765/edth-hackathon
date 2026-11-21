# Architecture

One speaker's path works end to end on the live site, in two areas and three languages. The shared receiver works on a coordinator that runs on a computer; the live site does not keep reports yet. Local mode and the evaluation harness are not finished. Status as of Friday 20 November, evening.

## The parts

- **Transmitter**: anything that captures a spoken report. Today that is the phone web page and a native app in `transmitter/`. Lysk's real users may well use radios; the coordinator does not care where a report comes from [58].
- **Coordinator**: the server endpoint `POST /api/report`. Speech-to-text, then intent extraction, then the resolver. It keeps missions: each report in a mission goes to that mission's log, and the unit's last position comes from that log [99, 107, 108].
- **Receiver**: the shared map at the base station, with every call sign and a replay. `/receiver`; it opens and ends missions and otherwise only shows [98, 113].
- **Mission**: one run, with a code, an area and an optional start point. Phones join it before they report [107, 114].
- **Area**: a region with its own gazetteer file (`vincennes`, `kyiv`, and since 21 November `izium`). All three are on the live site.

```
transmitters                 coordinator (Next.js, Vercel cdg1 or the Mac)           receiver (/receiver)
────────────                 ─────────────────────────────────────────────           ────────────────────
phone web page ──┐           POST /api/report
native app ──────┼─ audio ──►  1. speech-to-text   Mistral voxtral-mini-transcribe-3,
scenario clip ───┘  or text      (skipped for text)  place names sent as context_bias
                    + area     2. extraction       Mistral mistral-small-latest, strict JSON schema
                    + last     3. resolver         pure code + data/gazetteer.<area>.json
                    position   4. save             session log, one file per session
                    + session ◄─ { transcript, language, intent, resolution, timings_ms, report_id }
native app ── POST /api/answer (tapped choice) ──►  saved to the same log
                                                   GET /api/sessions/<code> ──►  shared map, feed, replay
                                                                                 (polls every second)
```

## Where each step runs

| Step | Where |
|---|---|
| Recording | On the phone |
| Speech-to-text | Mistral's API, called from our server in Paris; or on the phone, in the native app [71 to 74] |
| Intent extraction | Mistral's API, same route; or Ollama on the same computer in local mode [83] |
| Resolving the place | Our server; plain code, no AI, no outside calls |
| Map | On the phone; tiles, fonts and icons from OpenFreeMap |
| Speaking the question | In the language the phone is set to [106]. The browser's voice for English and French; for Ukrainian, a Piper voice that runs in the browser [49] |
| State (position history) | In a mission, in the mission's log on the coordinator, which the resolver and the receiver both read [108]. With no mission, on the phone, which sends its last position with each report |
| Shared map and replay | The receiver page, rebuilt from the session log in the browser [98] |

## What is built

| Part | Where | Status |
|---|---|---|
| Phone web page: hold to talk, map, pin with confidence circle, ask-back card, log, text box | `app/page.tsx`, `components/VoiceMapApp.tsx` | Live. Checked in a phone-sized desktop browser; no real-phone result is recorded yet. |
| Report endpoint | `app/api/report/route.ts` | Live |
| Speech-to-text and extraction | `lib/providers/transcriber.ts`, `lib/providers/extractor.ts` | Mistral, or extraction through Ollama on the computer with `PROVIDER_MODE=local`; behind interfaces |
| Resolver | `lib/geo/resolver.ts` | Pure function, unit-tested (`npm test`) |
| Gazetteers | `data/gazetteer.vincennes.json` (1,108 places), `data/gazetteer.kyiv.json` (2,840), rebuilt 20 November; `data/gazetteer.izium.json` (714), built Saturday 21 November | Built with `npm run gazetteer -- <area>`; the running app never calls Overpass. See [gazetteer.md](gazetteer.md). Izium is a town near the front in Kharkiv Oblast; its 9 demo reports were typed into the coordinator with hosted Mistral, 9 of 9. Not spoken yet. |
| Ukrainian voice for questions | `lib/tts/`, test page at `/tts-lab` | Live. Piper `uk_UA-ukrainian_tts-medium`, speaker tetiana, through onnxruntime-web in a worker, so the page keeps responding [105]. 77 MB on first load, with nothing on screen to show it. Phones unmeasured. |
| Stated distances, eight compass points, dead reckoning | resolver and extractor | Live since the deploy of 21 November |
| Native transmitter (Expo 58, React Native) | `transmitter/` | iPhone 13 mini through the Mac coordinator: Kyiv scenario 10 of 10 steps on 20 Nov, round trip 1.2 to 1.9 s [79]. On 21 Nov a Galaxy S10 recorded PCM WAV through a local Expo module; two live town-hall reports reached the offline coordinator and placed its unit on the receiver. |
| On-device speech-to-text in the transmitter (Whisper via `whisper.rn`) | `transmitter/src/stt.ts` | Built. In the simulator, on the 9 scenario steps: server 9 of 9; phone `small` 8 of 9; phone `base` 8 of 9 with place-name hints and 4 of 9 without. Every miss was a question or "could not place", never a wrong pin. Speed on a real phone is not measured [71 to 74]. |
| Scenarios with expected answers | `scenarios/*.json`; clips in `transmitter/scenarios/audio/` | 2 scenarios, 9 steps, synthetic voices. A third, `izium-demo.json` (9 steps, 21 November), has no clips yet: `npm run scenarios` makes them. |
| Shared map, call signs, replay | `app/receiver/page.tsx`, `components/Receiver.tsx`, `lib/reports/`, `app/api/answer`, `app/api/sessions/[code]` | Built 20 Nov. Checked in a desktop browser with typed reports from three call signs: markers, open question, answered movement with its arrow, dimming, replay. A Galaxy S10 sent two live reports on 21 Nov; not yet checked on a projector. Works only where the coordinator keeps a file (the Mac); the live site keeps no record [101]. |
| Missions: open, join, check in, end | `lib/reports/record.ts`, `lib/reports/mission.ts`, `app/api/sessions`, `app/api/places`, `components/MissionPanel.tsx`, `transmitter/src/mission.ts`, `transmitter/src/ui/JoinCard.tsx` | Built 20 Nov, evening [107 to 114]. Checked with curl, in a desktop browser (open a mission with a start point, joins, check-in, question, end) and in the iPhone simulator (join, check-in from a scenario step, the mission ending under the phone). Rejoining after the app restarts, and two phones at once, not tried yet. |
| Local (uplink-off) mode | | Local extraction built (`PROVIDER_MODE=local`, [83, 84]); network, HTTPS and offline map not started. See [plan.md](plan.md#local-mode). |
| Evaluation harness beyond unit tests | | Planned, not started |

**Deploys.** The live site is https://edth-hackathon.vercel.app. It is deployed with the Vercel CLI from Alex's account; the project is not connected to GitHub, so a push does not deploy. Production is at commit `e030cc3`, deployed on Saturday 21 November at 09:10 and checked with typed reports in all three areas. The live site keeps no reports, so it has no missions and its receiver stays empty [101]. `.vercelignore` says what the CLI must not upload: it does not read `.gitignore` [144]. Before changing it, look at what would go up with `vercel deploy --prod --dry`.

**Repo.** https://github.com/beverage/edth-hackathon is public. Commit author emails are therefore public too.

## The resolver in brief

The full rule table is in the [README](../README.md#resolver-rules). A report resolves only when one place clearly fits; otherwise the app asks. The main rules:

- A named place with one good match is resolved. Several good matches give a question, unless a category word said outside the name narrows it ("the Château de Vincennes **metro station**") [15].
- A category alone ("the church") looks within 1.5 km of the last position. Several candidates resolve only if the last position is under 10 minutes old and the nearest is under 0.4 times the distance of the second; otherwise the app asks.
- A name not in the gazetteer, but with a category, asks among that category. It never guesses.
- The same name in the same spot (a station and the square above it) counts as one place, with a wider circle [35].
- Two streets with the same name in different towns are two places: the question names the towns ([gazetteer.md](gazetteer.md#same-name-streets)).
- Radius: "at" 30 m; near, behind, in front of, next to 80 m; compass relations 100 m out with a 100 m circle; a stated distance replaces those defaults [52, 53].
- Movement towards a place moves the marker to the middle of the leg, with a circle spanning the leg and an arrow [46]. A stated distance moves it that far along the leg instead [55].
- Dead reckoning ("moved 300 metres north") moves from the last position; the circle grows with each leg until a report names a place again [54].
- A position that is an estimate only wins "nearest" if that still holds when it is off by its full radius [47].
