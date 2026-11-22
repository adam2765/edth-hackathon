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
| Command post (CP) | The shared map at the base, with every call sign, the tracks and a replay, at `/cp` (`?session=<code>` for one mission). It opens and ends missions, places and edits tracks by hand, and answers a unit's open question from its Decisions list [240]. Called the receiver, at `/receiver`, before 21 Nov; the old address still leads there |
| Clock direction | "At 3 o'clock": a way given as an hour on a clock face. Read in code. 12 o'clock is north, as on the map, or the way the speaker said they face [198, 224] |
| Bearing | "Bearing 060", "azimut 120", "1600 mils": a way given as an angle from north, in degrees or NATO mils (6400 to the circle). Read in code, to the degree [229] |
| Coordinator | The server endpoint that turns a report into a placement |
| Crossing | Where named streets meet: a point two streets share in OpenStreetMap. Worked out from the street lines, not stored in the gazetteer |
| Dead reckoning | Working out a position from the last one plus a stated distance and compass direction |
| Decisions list | Everything that waits on the operator at the command post, in one list, oldest first: questions with choices, questions with none, held radio reports and requests for recon. One is open at a time; 1 to 9 pick, N drops, Enter confirms [240] |
| Estimate (≈) | A position worked out from a movement, not from a named place; shown with ≈ |
| Gazetteer | Our local list of named places from OpenStreetMap, one file per area ([gazetteer.md](gazetteer.md)) |
| Gone | A track the command post took off the map. It stays in the list and the log, and comes back when the command post puts it back or a unit reports it again |
| Join | A phone entering a mission with a call sign and its own device id. The transmitter no longer joins: it picks a mission and sends its code, like a radio tuned to a net [208] |
| Local mode | Running the whole pipeline on a laptop with no internet ([plan.md](plan.md#local-mode)) |
| Mission | A run of the demo or an exercise: a code (`vincennes-1`), a name, an area, an optional start point, open or ended. One log. The code calls it a session |
| Answer heard | A short spoken answer to a unit's open question ("two", "the metro station"), read in code as one of the choices. It moves nothing: the Decisions list shows the choice picked, and the operator confirms [244] |
| Overtaken | A question the unit has moved past by reporting again: it is closed, leaves the Decisions list, and an answer to it is refused [241] |
| Recon done | The command post ends a drone's task: the line goes, and the drone is free to send again. Only a person ends a task [234] |
| Plot | A change to a track made by hand at the command post: place, change, move, gone or back. One `plot` line in the log; no model is involved |
| Request (for recon) | A unit asking by radio for a drone to look at a track: "send the drone", "request eyes on", «envoyez le drone», «потрібна пташка». Read from the words in code and cut out before the model reads the rest. It waits in the command post's Recon requests tray until a person sends a drone or declines [234] |
| Session | The code's word for a mission: one code, one append-only log |
| Sighting | One report about a track: what, where, by whom, from where, and when |
| Sign-off | The sender's call sign said last, after a pause, as pilots give it: "At the town hall, Alpha 1, over." Read as the sender only when nothing at the start named one [237] |
| Start point | A gazetteer place, picked at the base, where units are assumed to be until their first report names a place; shown with ≈ |
| Suspect | A track thought to be hostile and still to be looked into. Drawn as a dashed hostile frame |
| Task | A friendly drone or drone team sent by a person at the command post to look at a track: a track on the map, or a unit the command post marked as a drone team [235]. Drawn as a solid blue line from the drone to the track. It lasts until the command post says Recon done, sends the drone elsewhere, or the mission ends [234] |
| Town | The admin area inside which street names are unique (the commune in France, the city for Kyiv); it tells two same-name streets apart |
| Track | Something on the map that is not a reporting unit: seen or known of by a unit, reported by voice, numbered by the coordinator ("Track 3"), or placed by hand at the command post. For reconnaissance only [234]. Drawn with its APP-6 symbol |
| Transmitter | Anything that sends a spoken report: the web page, the native app, a scenario clip |
| Unit kind | What a unit on the net is, as a person at the command post said: a foot patrol, a drone team. The same kinds as a track's. Never read from the call sign. A unit marked drone or drone team can be sent to look at a track [235] |
| Wrong-pin rate | Share of reports placed confidently in the wrong place; the headline quality figure |
| Voice turn | A stretch of a transcript spoken by one voice. Whisper on the phone marks where the voice changes with a dash [154] |
