# Voice-to-Map

EDTH Paris 2026, challenge 01 (Lysk): spoken position reports become live map updates.
When a report could mean more than one place, the app asks back instead of guessing.

Live: https://edth-hackathon.vercel.app (stage 1, single user, no auth). Two areas: Vincennes (English, French) and central Kyiv (Ukrainian, English), switched at the top of the page or with `?area=kyiv`.

## How it works

```
phone mic ─► /api/report ─► speech-to-text (Mistral voxtral-mini-transcribe-3, place names as context_bias)
                         ─► intent extraction (Mistral mistral-small-latest, JSON schema; never coordinates)
                         ─► resolver (deterministic, local gazetteer of the chosen area from OpenStreetMap)
                         ◄─ { transcript, language, intent, resolution, timings_ms }
```

- The language model only extracts intent: kind, landmark name (as said, plus its dictionary form for Ukrainian), category, relation, a stated distance in metres, a compass direction of travel, language.
- `lib/geo/resolver.ts` turns intent + last position into a pin with a confidence radius, an arrow, or a question with up to three choices. Every coordinate comes from `data/gazetteer.<area>.json`, or from the last position moved by a distance and compass direction the speaker stated. The phone's GPS is never used.
- The client holds all state (no database in stage 1). Questions are spoken with the browser's `speechSynthesis`. Ukrainian questions use an on-device voice instead when it is loaded (`lib/tts/`, test page at `/tts-lab`).

### Resolver rules

| Situation | Result |
|---|---|
| No place in the report | `unresolved`, prompt to name a street or place |
| Named place, one good match | `resolved` |
| A name said whole, and a longer name that contains it ("Софійського собору": the cathedral, and its bell tower "Дзвіниця Софійського собору") | the whole name wins, even with a Ukrainian case ending that makes it score lower |
| Named place, several good matches (e.g. "Château de Vincennes" = castle and metro station) | `ambiguous`, unless a category word outside the name ("…metro station") narrows it |
| Category only ("the church") | candidates of that category within 1.5 km of the last position (or area centre) |
| Several candidates | `resolved` only if the last position is under 10 min old and nearest < 0.4 × second nearest; otherwise `ambiguous` with the top 3 |
| Name not in gazetteer but a category was said | ask among that category, never a silent guess |
| Same name, same spot (station + the square above it) | one place, no question; the circle widens to cover all of them |
| Street and station share a name ("на Хрещатику") | `ambiguous`: the street is 1.2 km long, the station is one point |
| No place, but a distance and a compass direction ("moved 300 metres north") | `resolved` by dead reckoning from the last position, shown as an estimate |
| The same with no last position | `unresolved`: "I don't know where you started", asks for a place |
| No place, and only a distance or only a direction ("heading north") | `unresolved`: asks for a distance and a compass direction, or a landmark |
| "Passing the next intersection", on a known street | the nearest crossing ahead on that street, if the unit's last two fixes ran along it; otherwise `ambiguous` between the nearest crossing each way |
| The same, street not known | the nearest crossings around the last position, in different directions; a compass direction said in the report picks the one ahead |
| "At the corner of rue X" | the crossings of rue X, those with the unit's own street first, then as for a named place |
| A crossing with no last position | `unresolved`: asks for the streets that cross there |

Radius: at 30 m; near / behind / in front of / next to 80 m; compass relations (eight points) offset 100 m on that bearing with 100 m radius; large features (parks, the château, streets) use at least their own extent.

A stated distance replaces those defaults. "200 metres south of X" pins 200 m out from X's edge, with a circle of 0.4 × the distance (50 m at least): a compass word is one of eight, so it is good to ±22.5°. "200 metres from X", with no side given, keeps the pin on X and widens the circle to X's extent plus 1.25 × the distance. The model only copies a distance that was said; "five minutes north" has none.

Movement ("moving towards X", "I moved towards X") gives a direction, not a distance. The marker moves to the middle of the leg from the last position to X, its circle spans the whole leg, an arrow points at X, and the time is shown at the marker with a ≈. The next report can still use that estimate, but "nearest wins" must hold even if the estimate is off by its full radius.

Movement along a street ("moving down Avenue X", "je remonte la rue X", "йду вулицею X") puts the speaker on the street, not on the way to it: at the point on it nearest the last position, shown with a ≈. The circle is the last position's own, plus the step onto the street, plus 1.25 × any distance said, since the way along it is not known. Only "towards", "heading to" and the like give the arrow.

Movement with a distance is dead reckoning from the last position, and is also shown with a ≈:

- "Moved 300 metres north": 300 m on that bearing. The circle is the last position's own circle plus 0.4 × the distance, so it grows with every leg until a report names a place again.
- "Moved 200 metres towards X": 200 m along the leg, never past X. The circle is the last position's circle plus a quarter of the distance (50 m at least).
- "Moved 300 metres east on rue X": the reckoned point is moved onto that street.
- A place that cannot be found does not stop a move that states its distance and direction; the log says the place was ignored.

Crossings are not in the gazetteer. `lib/geo/crossings.ts` finds them where two named streets share a point in OpenStreetMap; a bridge shares none, so it is not a crossing. In a mission the coordinator remembers the street each unit is on (from a report that named a street, kept through crossings on it) and the way it last moved, and passes both with the last position. A crossing within 20 m is the one the unit is at, never the next one. The pin is the crossing, with a 30 m circle.

## Demo script

Chosen from the real gazetteer (1,108 features: 6 rail/metro stations, 11 churches, 2 town halls, 1 castle, 31 stops, 38 pharmacies). Start from a fresh page (or "Clear map and log").

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

## Run locally

The short version is below. [docs/setup.md](docs/setup.md) has every step with a check, including offline mode and the transmitter on a phone.

A Mistral key is optional. Without one, run offline mode ([below](#offline-models-on-this-computer)).

```bash
npm install
npm run dev -- -p 3117                         # hosted mode: needs MISTRAL_API_KEY in .env.local
PROVIDER_MODE=local npm run dev -- -p 3117     # offline mode: no key, needs Ollama (below)
```

```bash
npm test             # resolver unit tests
npm run gazetteer -- kyiv   # rebuild data/gazetteer.<area>.json from Overpass (vincennes or kyiv)
```

Environment (all optional; see `.env.example`): `MISTRAL_API_KEY` for hosted mode, the default; copy `.env.example` to `.env.local` and paste it there, never in a commit. Without it, use offline mode. Extraction falls back to `FEATHERLESS_API_KEY` behind the same interface if it is absent. Optional overrides: `MISTRAL_STT_MODEL`, `MISTRAL_EXTRACT_MODEL`.

### Offline: models on this computer

`PROVIDER_MODE=local` makes the coordinator call nothing outside this computer. Intent extraction runs through Ollama with the same prompt and schema. There is no speech-to-text on the computer yet, so reports must arrive as text: the transmitter's phone modes, or typed. Audio gets a clear error.

```bash
brew install ollama                                   # 0.40 or newer; 0.8 cannot run Ministral 3
OLLAMA_NO_CLOUD=1 OLLAMA_KEEP_ALIVE=-1 ollama serve   # its own terminal; no cloud models, keep the model loaded
ollama pull ministral-3:3b                            # 3 GB, once
PROVIDER_MODE=local npm run dev -- -p 3117
```

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

Checked in the iPhone simulator against the live site on 20 Nov: the Vincennes script scored 4 of 4 and the Kyiv script 5 of 5. Not yet run on a real phone or on Android.

## Receiver

The shared map for the base station: open `http://localhost:3117/receiver` on the computer that runs the coordinator, ideally on a big screen.

A run is a **mission**. Open one from the Missions menu: an area, a name, and, if you like, a start point picked by name (the château, a metro station). Phones then join it from the transmitter: it lists the open missions, and the talk button waits until the phone has joined. A unit that joins starts around the start point, shown with ≈, and the phone asks it to check in by saying where it is. In a mission the coordinator keeps each unit's last position itself, so the phone's does not matter. End mission stops reports; the mission stays under "Ended" for replay, and can be deleted from there [107 to 114].

Every report shows up within about a second: one coloured marker per call sign with its time, circle and trail, a list of units, and a feed of what was said. The dashed trail runs from fix to fix and ends at the marker, the middle of its circle; a movement's arrow starts there and points at where the unit is heading. A question shows as "awaiting answer", with its choices numbered on the map, until the speaker taps one. The bar at the bottom replays the session at 1×, 10× or 30×, or from any moment on the slider; Live goes back to now. A unit silent for 3 minutes fades.

The coordinator keeps each mission in `.data/sessions/<code>.jsonl`: its opening, joins, reports, answers and end, one line each, never edited. A deleted mission's file moves to `.data/sessions/deleted/`. The live site keeps no record yet, so it has no missions, phones report to it without one, and its receiver stays empty [101].

## Layout

```
transmitter/                               native transmitter app (own package.json and tooling)
scenarios/, scripts/build-scenarios.mjs    scripted reports and the clip generator
app/page.tsx, components/VoiceMapApp.tsx   one mobile-first page: map, talk button, ask-back card, log
app/receiver/, components/Receiver.tsx     the receiver: shared map, units, feed, replay; MissionPanel.tsx opens missions
app/api/report/route.ts                    POST multipart: audio | text, lastPosition, clientTs, session
app/api/answer/route.ts                    POST the choice tapped for a question
app/api/sessions/                          list and open missions; [code]: the log, join, end, delete
app/api/places/route.ts                    GET places by name, to pick a start point
lib/reports/                               missions and their logs: entry types, store, record, position rule, foldLog
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
