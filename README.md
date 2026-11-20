# Voice-to-Map

EDTH Paris 2026, challenge 01 (Lysk): spoken position reports become live map updates.
When a report could mean more than one place, the app asks back instead of guessing.

Live: https://edth-hackathon.vercel.app (stage 1, single user, no auth)

## How it works

```
phone mic ─► /api/report ─► speech-to-text (Mistral voxtral-mini-transcribe-3, place names as context_bias)
                         ─► intent extraction (Mistral mistral-small-latest, JSON schema; never coordinates)
                         ─► resolver (deterministic, local gazetteer of Vincennes from OpenStreetMap)
                         ◄─ { transcript, language, intent, resolution, timings_ms }
```

- The language model only extracts intent: kind, landmark name/category, relation, language.
- `lib/geo/resolver.ts` turns intent + last position into a pin with a confidence radius, an arrow, or a question with up to three choices. Every coordinate comes from `data/gazetteer.vincennes.json`.
- The client holds all state (no database in stage 1). Questions are spoken with the browser's `speechSynthesis`.

### Resolver rules

| Situation | Result |
|---|---|
| No place in the report | `unresolved`, prompt to name a street or place |
| Named place, one good match | `resolved` |
| Named place, several good matches (e.g. "Château de Vincennes" = castle and metro station) | `ambiguous`, unless a category word outside the name ("…metro station") narrows it |
| Category only ("the church") | candidates of that category within 1.5 km of the last position (or area centre) |
| Several candidates | `resolved` only if the last position is under 10 min old and nearest < 0.4 × second nearest; otherwise `ambiguous` with the top 3 |
| Name not in gazetteer but a category was said | ask among that category, never a silent guess |

Radius: at 30 m; near / behind / in front of / next to 80 m; compass relations offset 100 m on that bearing with 100 m radius; large features (parks, the château, streets) use at least their own extent. "Towards" keeps the pin and draws an arrow.

## Demo script

Chosen from the real gazetteer (889 features: 6 rail/metro stations, 11 churches, 2 town halls, 1 castle). Start from a fresh page (or "Clear map and log").

| # | Say | Expected |
|---|---|---|
| 1 | "I'm at Bérault metro." | Unique named place: pin at Bérault, ±30 m |
| 2 | "Now I'm at the château de Vincennes." | Ambiguous: phone asks "castle or station?" aloud; tap **Château de Vincennes (metro station)** |
| 3 | "Moving towards the town hall." | Movement: arrow from the station to Mairie de Vincennes (nearest town hall wins: 347 m vs 1.45 km to Saint-Mandé) |
| 4 | "Je suis devant la mairie." | French: pin in front of Mairie de Vincennes, ±80 m |

If hall noise defeats transcription, type the same sentences in the text box; text and voice go through the same pipeline.

## Run locally

```bash
npm install
export MISTRAL_API_KEY=...   # never commit it
npm run dev -- -p 3117
```

```bash
npm test             # resolver unit tests
npm run gazetteer    # rebuild data/gazetteer.vincennes.json from Overpass (only when changing the area)
```

Environment: `MISTRAL_API_KEY` (preferred). Fallbacks behind the same interfaces: `ELEVENLABS_API_KEY` for speech-to-text, `FEATHERLESS_API_KEY` for extraction. Optional overrides: `MISTRAL_STT_MODEL`, `MISTRAL_EXTRACT_MODEL`.

## Layout

```
app/page.tsx, components/VoiceMapApp.tsx   one mobile-first page: map, talk button, ask-back card, log
app/api/report/route.ts                    POST multipart: audio | text, lastPosition, clientTs
lib/providers/transcriber.ts               Transcriber interface + Mistral (ElevenLabs fallback)
lib/providers/extractor.ts                 IntentExtractor interface + prompt + JSON schema
lib/geo/gazetteer.ts                       name search, category words, bias terms
lib/geo/resolver.ts                        pure resolver
scripts/build-gazetteer.ts                 one Overpass query → data/gazetteer.vincennes.json
DECISIONS.md                               every choice made, one line each
```

Map data © OpenStreetMap contributors (ODbL). Tiles by OpenFreeMap / OpenMapTiles.
