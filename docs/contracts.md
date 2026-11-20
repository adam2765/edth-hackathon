# Contracts

These are the seams between the parts. Work on either side of one can go ahead independently, as long as the contract holds. Change one on purpose: record it in [DECISIONS.md](../DECISIONS.md) and tell whoever works on the other side.

The types live in `lib/geo/types.ts`. The transmitter imports them as types only, so a change to the reply shape shows up as a type error in the app [67].

## Report endpoint

`POST /api/report`, multipart form:

| Field | Meaning |
|---|---|
| `audio` (file) or `text` | The report. Text skips speech-to-text: it is the test hook and the demo fallback if the hall is too noisy. |
| `area` | `vincennes` (default) or `kyiv`. In a mission, the mission's area is used instead [108]. |
| `language` | Optional: `en`, `fr` or `uk`, the language the speaker's device is set to. The question comes back in it. Without it, the language is guessed from the words [104, 106]. |
| `lastPosition` | JSON `{ lat, lon, ts, uncertainty_m?, radius_m? }`. `uncertainty_m` is set only when the last position was an estimate [47, 56]. Used only with no mission: in a mission the coordinator takes the unit's last position from the log, its latest fix or else the start point [108]. |
| `clientTs` | Client time, epoch ms |
| `session` | The mission's code. With one, the mission has to be open: 404 for an unknown code, 409 with `ended: true` for an ended one [108]. The report is saved to the mission's log for the receiver. Without one (the web page, or a coordinator that keeps no record), nothing is saved [99]. |
| `callsign`, `seq` | Who sent it, and the transmitter's own counter. With `clientTs`, `seq` lets the server save a report sent twice only once [102]. Call signs are stored in capitals [111]. A call sign that has not joined the mission joins with its first report. |

Reply: `{ transcript, language, intent, resolution, timings_ms: { stt, extract, resolve, total }, area, report_id? }`. `area` is the one used. `report_id` is there when the report was saved; send it back with the answer to a question.

Limits: 1 MB per clip (about 15 s), 500 characters of text, 30 requests a minute per IP per server instance [24]. No auth.

## Answer endpoint

`POST /api/answer`, JSON `{ session, report, choice }`: `report` is the `report_id`, `choice` the candidate id tapped, or `null` for "none of these". The phone has already moved its own marker; this closes the question on the receiver and moves the marker there [100]. Reply `{ answer_id }`. The first answer to a question stands. Errors: 400 for a choice that was not offered, 404 for an unknown report, 409 with `ended: true` when the mission has ended, 501 when the coordinator keeps no record.

## Missions

A mission is a session with a name, an area, an optional start point, and an end [107]. Types in `lib/reports/types.ts`; the transmitter imports them as types only [108].

| Endpoint | Does |
|---|---|
| `GET /api/sessions` | `{ stored, missions }`: every mission on this coordinator, open ones first, newest first. Each has `code`, `name`, `area`, `start`, `opened`, `ended` (null while open), `units`, `reports`, `last`. `stored` is false, and the list empty, when the coordinator keeps no record. |
| `POST /api/sessions` | Opens a mission. JSON `{ area, name?, start? }`; `start` is a gazetteer place id or null. 201 with `{ mission }`. The code is `<area>-<n>`, never reused [109]. |
| `POST /api/sessions/<code>/join` | JSON `{ callsign, device }`; `device` is an id the phone made up and keeps (8 to 64 letters, digits, `-`, `_`). Reply `{ mission, callsign, position, positionTs, rejoined }`: where the coordinator has the unit, the start point (≈) on a first join. The same device joining again gets its unit back and nothing is written. 404 for an unknown mission; 409 with `ended: true` for an ended one, or with `taken: true` when another phone has used the call sign in the last 3 minutes [111]. |
| `POST /api/sessions/<code>/end` | Ends the mission: joins, reports and answers are refused after it. Ending it again changes nothing. |
| `DELETE /api/sessions/<code>` | Deletes an ended mission; its file moves to `deleted/` [112]. 409 for an open one. |
| `GET /api/places?area=&q=` | Up to 8 gazetteer places matching `q`, each as the start point it would make: `{ id, name, category, lat, lon, radius_m }`. |

A start point is a circle of 300 m, or the place's own size if larger, and always an estimate [110].

## Session log

`GET /api/sessions/<code>?after=<n>` returns `{ session, stored, total, entries }`: the entries after the first `n`, and how many there are in all. The receiver polls it every second with `after` set to what it already has. `stored` is false when the coordinator keeps no record (the live site, for now) [101].

Each entry has `kind`, `id`, `session` and server time `ts`, and is one of:

- `mission`, the first line: `area`, `name`, `start` (null, or `{ id, name, category, lat, lon, radius_m }`).
- `join`: `callsign`, `device` (null when the call sign joined with its first report), `position` (the start point as an estimate, or null).
- `report`: the report endpoint's reply plus `callsign`, `seq`, `clientTs`, `area`, the `lastPosition` used, and `position`: where it leaves the speaker, or null.
- `answer`: `callsign`, `report_id`, `choice`, `position`.
- `end`: nothing more.

Types in `lib/reports/types.ts`. The log is append-only; nothing in it is edited. A session from before missions has no `mission` line; the receiver still shows it, and reports to it are refused.

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
