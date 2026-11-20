# Contracts

These are the seams between the parts. Work on either side of one can go ahead independently, as long as the contract holds. Change one on purpose: record it in [DECISIONS.md](../DECISIONS.md) and tell whoever works on the other side.

The types live in `lib/geo/types.ts`. The transmitter imports them as types only, so a change to the reply shape shows up as a type error in the app [67].

## Report endpoint

`POST /api/report`, multipart form:

| Field | Meaning |
|---|---|
| `audio` (file) or `text` | The report. Text skips speech-to-text: it is the test hook and the demo fallback if the hall is too noisy. |
| `area` | `vincennes` (default) or `kyiv` |
| `language` | Optional: `en`, `fr` or `uk`, the language the speaker's device is set to. The question comes back in it. Without it, the language is guessed from the words [104, 106]. |
| `lastPosition` | JSON `{ lat, lon, ts, uncertainty_m?, radius_m? }`. `uncertainty_m` is set only when the last position was an estimate [47, 56]. |
| `clientTs` | Client time, epoch ms |
| `session` | Session code: lower-case letters, digits, `-` and `_`, up to 40. With one, the report is saved to that session's log for the receiver; without one (the web page), it is not saved [99]. |
| `callsign`, `seq` | Who sent it, and the transmitter's own counter. With `clientTs`, `seq` lets the server save a report sent twice only once [102]. |

Reply: `{ transcript, language, intent, resolution, timings_ms: { stt, extract, resolve, total }, report_id? }`. `report_id` is there when the report was saved; send it back with the answer to a question.

Limits: 1 MB per clip (about 15 s), 500 characters of text, 30 requests a minute per IP per server instance [24]. No auth.

## Answer endpoint

`POST /api/answer`, JSON `{ session, report, choice }`: `report` is the `report_id`, `choice` the candidate id tapped, or `null` for "none of these". The phone has already moved its own marker; this closes the question on the receiver and moves the marker there [100]. Reply `{ answer_id }`. The first answer to a question stands. Errors: 400 for a choice that was not offered, 404 for an unknown report, 501 when the coordinator keeps no record.

## Session log

`GET /api/sessions/<code>?after=<n>` returns `{ session, stored, total, entries }`: the entries after the first `n`, and how many there are in all. The receiver polls it every second with `after` set to what it already has. `stored` is false when the coordinator keeps no record (the live site, for now) [101].

Each entry is a `report` (the report endpoint's reply plus `id`, `session`, `callsign`, `seq`, server time `ts`, `clientTs`, `area`, the `lastPosition` sent, and `position`: where it leaves the speaker, or null) or an `answer` (`report_id`, `choice`, `position`). Types in `lib/reports/types.ts`. The log is append-only; nothing is edited or deleted.

## Intent (what the model returns)

`kind` (position, movement, other), `landmark_text` (verbatim), `landmark_name`, `landmark_name_lemma` (the name in dictionary form, for Ukrainian case endings [32]), `landmark_category` (church, metro_station, castle, town_hall, school, park, hospital, police, bridge, street, other), `relation` (at, near, in_front_of, behind, next_to, eight compass relations, towards, between), `distance_m` (only if a distance was said, at most 20 km [51]), `direction` (eight compass points, for movement), `language` (en, fr, uk), `confidence` (not used by anything yet).

## Resolution (what the resolver returns)

`status` (resolved, ambiguous, unresolved), `pin`, `radius_m`, `heading_to` (target of a movement), `estimated` (worked out from the last position, shown with ≈), `candidates` (up to three, each with its own precomputed placement, so tapping a choice needs no second call [18]; a street also carries its `town` when another street has the same name), `question` (the ask-back or the prompt), `evidence` (the rule that fired and the gazetteer id).

## Utterance (transmitter side)

One spoken report, whatever produced it: `seq`, `callsign`, `source` (mic, scenario, open_mic), the audio file or the text, start and end times. Every source feeds the same send path, so a scripted clip goes down exactly the path a recording does [60, 61]. Defined in `transmitter/src/types.ts`.

## Scenario file

`scenarios/<id>.json`: steps with a time offset, call sign, language, the words, the answer the coordinator should give (`status`, `feature_id`, `heading_to`) and which choice to tap if it asks back. Because every step says what should happen, a run gives a score [62]. Format in [scenarios/README.md](../scenarios/README.md).

## Gazetteer file

`data/gazetteer.<area>.json`: `{ source, built_at, area, bbox, count, features }`. Each feature is a `GazetteerFeature` from `lib/geo/types.ts`. Feature ids are stable across rebuilds as long as OpenStreetMap does not change, and scenario files refer to them. How the file is built: [gazetteer.md](gazetteer.md).

## Provider interfaces

`Transcriber.transcribe(audio, mime, biasTerms) → { text, language }` and `IntentExtractor.extract(text) → Intent`. Local mode adds a second implementation of each behind one switch, `PROVIDER_MODE=hosted|local`.
