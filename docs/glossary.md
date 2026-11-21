# Glossary

| Term | Meaning |
|---|---|
| Affiliation | Whose a track is: hostile, suspect, unknown, neutral (civilian) or friendly. Read from the speaker's words in code; unknown when no word was said |
| Ask-back | The question the app asks, aloud and on screen, when a report could mean more than one place |
| Area | A region with its own gazetteer: `vincennes`, `kyiv` or `izium` |
| Bias terms | Up to 100 report words and place names sent to speech-to-text so it spells them right (`context_bias`) |
| Block | The stretch of street from one crossing to the next. "Two blocks east" is counted in crossings along the street lines, never turned into metres [184] |
| Call sign | The name a speaker reports under, such as ALPHA 2. Stored in capitals. On a radio net it is said at the start of the report and read from the words against the mission's roster [202] |
| Check-in | A unit's first report that names a place. It replaces the start point |
| Command post (CP) | The shared map at the base, with every call sign, the tracks and a replay, at `/cp` (`?session=<code>` for one mission). It opens and ends missions, places and edits tracks by hand, and can answer a unit's open question. Called the receiver, at `/receiver`, before 21 Nov; the old address still leads there |
| Clock direction | "At 3 o'clock": a way given as an hour on a clock face. Read in code. 12 o'clock is north, as on the map, or the way the speaker said they face [198, 210] |
| Coordinator | The server endpoint that turns a report into a placement |
| Crossing | Where named streets meet: a point two streets share in OpenStreetMap. Worked out from the street lines, not stored in the gazetteer |
| Dead reckoning | Working out a position from the last one plus a stated distance and compass direction |
| Estimate (≈) | A position worked out from a movement, not from a named place; shown with ≈ |
| Gazetteer | Our local list of named places from OpenStreetMap, one file per area ([gazetteer.md](gazetteer.md)) |
| Gone | A track the command post took off the map. It stays in the list and the log, and comes back when the command post puts it back or a unit reports it again |
| Join | A phone entering a mission with a call sign and its own device id. The transmitter no longer joins: it picks a mission and sends its code, like a radio tuned to a net [208] |
| Local mode | Running the whole pipeline on a laptop with no internet ([plan.md](plan.md#local-mode)) |
| Mission | A run of the demo or an exercise: a code (`vincennes-1`), a name, an area, an optional start point, open or ended. One log. The code calls it a session |
| Plot | A change to a track made by hand at the command post: place, change, move, gone or back. One `plot` line in the log; no model is involved |
| Session | The code's word for a mission: one code, one append-only log |
| Sighting | One report about a track: what, where, by whom, from where, and when |
| Start point | A gazetteer place, picked at the base, where units are assumed to be until their first report names a place; shown with ≈ |
| Suspect | A track thought to be hostile and still to be looked into. Drawn as a dashed hostile frame |
| Town | The admin area inside which street names are unique (the commune in France, the city for Kyiv); it tells two same-name streets apart |
| Track | Something on the map that is not a reporting unit: seen or known of by a unit, reported by voice, numbered by the coordinator ("Track 3"), or placed by hand at the command post. For reconnaissance only. Drawn with its APP-6 symbol |
| Transmitter | Anything that sends a spoken report: the web page, the native app, a scenario clip |
| Wrong-pin rate | Share of reports placed confidently in the wrong place; the headline quality figure |
| Voice turn | A stretch of a transcript spoken by one voice. Whisper on the phone marks where the voice changes with a dash [154] |
