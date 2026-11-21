# Glossary

| Term | Meaning |
|---|---|
| Ask-back | The question the app asks, aloud and on screen, when a report could mean more than one place |
| Area | A region with its own gazetteer: `vincennes` or `kyiv` |
| Bias terms | Up to 100 place names sent to speech-to-text so it spells them right (`context_bias`) |
| Call sign | The name a speaker reports under, such as ALPHA 2. Stored in capitals; one phone per call sign in a mission |
| Check-in | A unit's first report that names a place. It replaces the start point |
| Coordinator | The server endpoint that turns a report into a placement |
| Crossing | Where named streets meet: a point two streets share in OpenStreetMap. Worked out from the street lines, not stored in the gazetteer |
| Dead reckoning | Working out a position from the last one plus a stated distance and compass direction |
| Estimate (≈) | A position worked out from a movement, not from a named place; shown with ≈ |
| Gazetteer | Our local list of named places from OpenStreetMap, one file per area ([gazetteer.md](gazetteer.md)) |
| Join | A phone entering a mission with a call sign and its own device id |
| Local mode | Running the whole pipeline on a laptop with no internet ([plan.md](plan.md#local-mode)) |
| Mission | A run of the demo or an exercise: a code (`vincennes-1`), a name, an area, an optional start point, open or ended. One log. The code calls it a session |
| Receiver | The shared map at the base, with every call sign and a replay, at `/receiver` (`?session=<code>` for one mission). It opens and ends missions |
| Session | The code's word for a mission: one code, one append-only log |
| Start point | A gazetteer place, picked at the base, where units are assumed to be when they join; shown with ≈ |
| Town | The admin area inside which street names are unique (the commune in France, the city for Kyiv); it tells two same-name streets apart |
| Transmitter | Anything that sends a spoken report: the web page, the native app, a scenario clip |
| Wrong-pin rate | Share of reports placed confidently in the wrong place; the headline quality figure |
