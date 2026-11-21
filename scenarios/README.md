# Scenarios

Scripted reports for driving the transmitter and the coordinator without anyone speaking.
One JSON file per scenario. `npm run scenarios` turns each step's text into a short audio
clip with a synthetic voice and writes the bundle the transmitter app loads.

```
{
  "id": "vincennes-demo",
  "title": "...",
  "area": "vincennes" | "kyiv" | "izium",
  "steps": [
    {
      "id": "v1",                 // unique within the scenario
      "t": 0,                     // seconds from the start: lets the same file be played as
                                  // separate clips now and as one continuous track later
      "callsign": "ALPHA 1",
      "lang": "en" | "fr" | "uk", // picks the synthetic voice
      "text": "I'm at Bérault metro.",
      "expect": {                 // what the coordinator should answer
        "status": "resolved" | "ambiguous" | "unresolved",
        "feature_id": "node/9415191169",   // the place, when resolved
        "heading_to": "way/83816816",      // the target, for a movement
        "track": { "n": 1, "affiliation": "hostile", "kind": "vehicle" }
                                  // only for a report about a track: its number, whose it
                                  // is (null for unknown) and what it is; each part optional.
                                  // A step with no "track" must not be read as one
      },
      "choose": "node/9863472112" // which choice to tap when the answer is a question
    }
  ]
}
```

Because every step says what should happen, a run gives a score: how many steps the
pipeline got right. Feature ids come from `data/gazetteer.<area>.json`.

Clips are made with macOS voices (`say`), so the generator runs on a Mac. The clips are
committed, so nobody else needs to run it.
