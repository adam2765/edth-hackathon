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
| Named place, several good matches (e.g. "Château de Vincennes" = castle and metro station) | `ambiguous`, unless a category word outside the name ("…metro station") narrows it |
| Category only ("the church") | candidates of that category within 1.5 km of the last position (or area centre) |
| Several candidates | `resolved` only if the last position is under 10 min old and nearest < 0.4 × second nearest; otherwise `ambiguous` with the top 3 |
| Name not in gazetteer but a category was said | ask among that category, never a silent guess |
| Same name, same spot (station + the square above it) | one place, no question; the circle widens to cover all of them |
| Street and station share a name ("на Хрещатику") | `ambiguous`: the street is 1.2 km long, the station is one point |
| No place, but a distance and a compass direction ("moved 300 metres north") | `resolved` by dead reckoning from the last position, shown as an estimate |
| The same with no last position | `unresolved`: "I don't know where you started", asks for a place |
| No place, and only a distance or only a direction ("heading north") | `unresolved`: asks for a distance and a compass direction, or a landmark |

Radius: at 30 m; near / behind / in front of / next to 80 m; compass relations (eight points) offset 100 m on that bearing with 100 m radius; large features (parks, the château, streets) use at least their own extent.

A stated distance replaces those defaults. "200 metres south of X" pins 200 m out from X's edge, with a circle of 0.4 × the distance (50 m at least): a compass word is one of eight, so it is good to ±22.5°. "200 metres from X", with no side given, keeps the pin on X and widens the circle to X's extent plus 1.25 × the distance. The model only copies a distance that was said; "five minutes north" has none.

Movement ("moving towards X", "I moved towards X") gives a direction, not a distance. The marker moves to the middle of the leg from the last position to X, its circle spans the whole leg, an arrow points at X, and the time is shown at the marker with a ≈. The next report can still use that estimate, but "nearest wins" must hold even if the estimate is off by its full radius.

Movement with a distance is dead reckoning from the last position, and is also shown with a ≈:

- "Moved 300 metres north": 300 m on that bearing. The circle is the last position's own circle plus 0.4 × the distance, so it grows with every leg until a report names a place again.
- "Moved 200 metres towards X": 200 m along the leg, never past X. The circle is the last position's circle plus a quarter of the distance (50 m at least).
- "Moved 300 metres east on rue X": the reckoned point is moved onto that street.
- A place that cannot be found does not stop a move that states its distance and direction; the log says the place was ignored.

## Demo script

Chosen from the real gazetteer (911 features: 6 rail/metro stations, 11 churches, 2 town halls, 1 castle). Start from a fresh page (or "Clear map and log").

| # | Say | Expected |
|---|---|---|
| 1 | "I'm at Bérault metro." | Unique named place: pin at Bérault, ±30 m |
| 2 | "Now I'm at the château de Vincennes." | Ambiguous: phone asks "castle or station?" aloud; tap **Château de Vincennes (metro station)** |
| 3 | "Moving towards the town hall." | Movement: the marker moves half way to Mairie de Vincennes (±174 m, the whole leg), with an arrow from the station to the mairie (nearest town hall wins: 347 m vs 1.45 km to Saint-Mandé) |
| 4 | "Je suis devant la mairie." | French: pin in front of Mairie de Vincennes, ±80 m |

If hall noise defeats transcription, type the same sentences in the text box; text and voice go through the same pipeline.

### Kyiv, in Ukrainian

Switch to **Київ** (2,112 features: 26 stations, 67 churches, 317 streets) and start from a fresh page. Checked with a synthetic Ukrainian voice, not yet with a native speaker.

| # | Say | Expected |
|---|---|---|
| 1 | «Я на Хрещатику.» | Asks «вулиця Хрещатик чи Хрещатик (станція)?»; tap **вулиця Хрещатик** |
| 2 | «Рухаюсь до Софійського собору.» | The marker moves half way, with an arrow to Saint Sophia Cathedral |
| 3 | «Я біля станції метро Хрещатик.» | Pin at Khreshchatyk station, ±80 m |
| 4 | «Я на Майдані Незалежності.» | Pin ±249 m, no question: station, square and street are one place |
| 5 | "I'm at the Golden Gate." | English in the same session: pin at Золоті ворота, ±30 m |

Order matters for step 1: said within 10 minutes of a fix at the station, «Я на Хрещатику» resolves to the station without asking (nearest wins).

## Run locally

```bash
npm install
cp .env.example .env.local   # then fill in MISTRAL_API_KEY; never commit it
npm run dev -- -p 3117
```

```bash
npm test             # resolver unit tests
npm run gazetteer -- kyiv   # rebuild data/gazetteer.<area>.json from Overpass (vincennes or kyiv)
```

Environment: `MISTRAL_API_KEY` (required for speech-to-text). Extraction falls back to `FEATHERLESS_API_KEY` behind the same interface if it is absent. Optional overrides: `MISTRAL_STT_MODEL`, `MISTRAL_EXTRACT_MODEL`.

## Transmitter app and scenarios

`transmitter/` is a small native app (Expo) that stands in for a field radio. It sends spoken reports to the same `/api/report` and shows and speaks the answer. A report comes from the microphone (hold to talk) or from a prepared clip, and both go down the same path, so the whole pipeline can be driven silently in a simulator. See [transmitter/README.md](transmitter/README.md) for how to build and run it.

`scenarios/*.json` are scripted reports with the answer each one should get. `npm run scenarios` (on a Mac) makes the clips with synthetic English, French and Ukrainian voices. In the app, "Play scenario" sends every step and marks it ✓ or ✗; tapping one step sends it alone and leaves any question for you to answer.

Checked in the iPhone simulator against the live site on 20 Nov: the Vincennes script scored 4 of 4 and the Kyiv script 5 of 5. Not yet run on a real phone or on Android.

## Layout

```
transmitter/                               native transmitter app (own package.json and tooling)
scenarios/, scripts/build-scenarios.mjs    scripted reports and the clip generator
app/page.tsx, components/VoiceMapApp.tsx   one mobile-first page: map, talk button, ask-back card, log
app/api/report/route.ts                    POST multipart: audio | text, lastPosition, clientTs
lib/providers/transcriber.ts               Transcriber interface + Mistral
lib/providers/extractor.ts                 IntentExtractor interface + prompt + JSON schema
lib/geo/areas.ts                           areas: centre, bounding box, hint text
lib/geo/gazetteer.ts                       name search, category words (en, fr, uk), bias terms
lib/geo/resolver.ts                        pure resolver
scripts/build-gazetteer.ts                 one Overpass query → data/gazetteer.<area>.json
docs/                                      design docs, one file per topic; start at docs/README.md
CONTRIBUTING.md                            setup, checks and working agreements for the team
DECISIONS.md                               every choice made, one line each
AGENTS.md                                  instructions for coding agents (Claude Code and Codex read the same file)
```

Map data © OpenStreetMap contributors (ODbL). Tiles by OpenFreeMap / OpenMapTiles.
