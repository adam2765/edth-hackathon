# Stage test plan

How we test the demo before the pitch on Sunday 22 November, and which lines go on stage. Written on the night of 21 to 22 November. Nothing in it has been run yet: every line is a candidate until it passes.

## What is fixed

Decided by Alex on 22 November [236]:

- **Offline.** The Mac is the coordinator, in offline mode: Whisper large-v3-turbo for speech, Ministral 3 3B through Ollama for the words. No internet. We are the only team that runs offline, so we show that.
- **One phone is every radio.** The native app, hold to talk. It sends no call sign: the coordinator reads the sender from the words [202]. Alex speaks every unit.
- **Vincennes, in English.**
- **The roster:** ALPHA 1 and BRAVO 2 on foot, CHARLIE 3 the drone team. The command post marks CHARLIE 3 as a drone team before the demo [235].
- **The call sign is said right.** We do not test wrong or unknown call signs for the stage. We do test that Whisper writes the three call signs as said.
- **A call sign at the end** counts as the sender only as a sign-off: "At the town hall, Alpha 1, over." Not built yet; see [The sign-off call sign](#the-sign-off-call-sign).

## What can fail on stage

Each risk has a test below.

| # | Risk | Why we expect it | Where it is tested |
|---|---|---|---|
| 1 | Whisper mishears a French name said in English | Offline, Whisper takes no hint names [195, 205]. "Bérault" came back as "Bayrold" from every synthetic English voice ([stt-comparison.md](stt-comparison.md)) | Passes 2 and 3; the stage lines use only names that pass in Alex's voice |
| 2 | A unit's report is held as "moved too far" | One person speaks three units, fast. A radio report that moves a unit farther than 15 m/s allows since its last fix, plus that fix's circle and 100 m, waits for the operator [204] | [Pacing](#pacing-the-far-guard); pass 4 |
| 3 | The small model reads a line wrong | It passes about two thirds of the eval cases. It gives the same answer every time, so a line that passes typed keeps passing | Pass 1: every line typed three times, and five ways of saying it |
| 4 | Whisper writes a call sign oddly | "Alpha won", "Bravo to", "Charlie tree". The reader takes these as near matches, but only when one roster unit is close | Pass 3: each call sign five times |
| 5 | Hall noise, the PA, or a second voice in the clip | Offline Whisper does not tell voices apart: two voices are read as one | Pass 3 with noise; hold to talk only while speaking |
| 6 | The phone cannot reach the Mac | The venue's Wi-Fi blocks phone to Mac. The cable works; the phone's hotspot should | Pass 4 on both links; pre-flight |
| 7 | A report takes too long | 3 to 5 s on the M1 Pro, longer while the GPU is busy with the map and a second screen | Pass 4, timed, with the projector set-up |
| 8 | The first report is slow | Ollama and Whisper load on first use | Pre-flight: one warm-up report |
| 9 | A report with no call sign answers an open question | With one question open in the last 2 minutes, such a report goes to that unit [204] | Drill: the operator answers every question before the next report |
| 10 | The model writes a place nobody said | "Bérault" is in the prompt's examples and has turned up unasked ([evals/README.md](../evals/README.md)) | Pass 1: no stage line may place anything at Bérault |
| 11 | The sign-off reader gives a report to the wrong unit | New code; "I'm at the church with Bravo 2" ends with a call sign and is not from BRAVO 2 | Its own eval, with held-out cases, before any stage line uses it |

## The passes

A line goes on stage only when it has passed every pass, in this order.

| Pass | What | Who and when | A line passes when |
|---|---|---|---|
| 0 | Code: `npm test`, with the call-sign and request evals, and the stage scenario's outcomes checked against the resolver | Claude, tonight, silent | Everything is green |
| 1 | **Typed, offline model.** Each line is sent as a radio report (text, no call sign field) to a fresh mission, three times. Then five other ways of saying it | Claude, tonight, silent | 3 of 3 give the expected result. The other wordings are sorted into "safe" and "never say" |
| 2 | **Synthetic voices, offline Whisper.** Each line is made into a clip with four English macOS voices (`say` writes a file; nothing plays) and sent as audio | Claude, tonight, silent | Noted, not a gate: it shows which names Whisper cannot write before Alex spends voice time on them |
| 3 | **Alex's voice,** through the phone to the Mac, the real path. The [voice sheet](#the-voice-sheet-for-the-morning) | Alex, in the morning | 5 of 5 for a stage line; 3 of 3 for an alternate |
| 4 | **Dress rehearsal.** The whole script, with the projector, on the link we will use, timed. Twice in a row without a restart. Then the [drills](#drills) | The team, before leaving for the venue | Two clean runs; every drill done once |
| 5 | **Pre-flight** at the venue | Alex and the operator, 10 minutes before | The [checklist](#pre-flight) |

For each line, passes 1 to 3 record the words as Whisper wrote them, the sender read, the result, and the seconds taken. The results go in this file, under the scenario tables.

## Scenarios

The call sign comes first unless the block says otherwise. "Known" means the result is in the README, a scenario file or a test today, though not always as a radio report. "Confirm" means pass 1 decides what we expect.

The mission has a start point, **Château de Vincennes** (the castle). A unit at the start point has no fix, so its first report is never held as too far [204].

### A. Where I am

| ID | Said | Expected | Status |
|---|---|---|---|
| A1 | "Alpha 1, at Vincennes station." | ALPHA 1 at Vincennes station, ±30 m | Confirm |
| A2 | "Bravo 2, at the town hall." | BRAVO 2 at Mairie de Vincennes, the nearer of two town halls | Known for a unit with a position; confirm from the start point |
| A3 | "Charlie 3, at the castle." | CHARLIE 3 at the castle, no question | Confirm: "the château" asks, "the castle" may not |
| A4 | "Alpha 1, at Bérault metro." | ALPHA 1 at Bérault | Known typed. Whisper risk: expect it to fail by voice |
| A5 | "Bravo 2, in front of the town hall." | BRAVO 2 in front of the Mairie, ±80 m | Known in French; confirm in English |

### B. Moving, and places said the natural way

Lysk's own examples are "South of the church" and "I moved towards 35th street".

| ID | Said | Expected | Status |
|---|---|---|---|
| B1 | "Alpha 1, moving towards the town hall." | The marker moves half way, with an arrow on to the Mairie | Known |
| B2 | "Bravo 2, south of the church." | A question (11 churches), or the nearest church when one is clearly nearest | Confirm |
| B3 | "Bravo 2, 200 metres south of the town hall." | BRAVO 2 200 m south of the Mairie | Confirm |
| B4 | "Alpha 1, moved 300 metres east." | ALPHA 1 300 m east of its last position, as an estimate | Confirm |
| B5 | "Alpha 1, on Avenue de Paris, heading east." | ALPHA 1 on the street, heading east | Confirm |
| B6 | "Bravo 2, two blocks east." | Two crossings east along its street, or a question | Confirm. Test only: it asks often in old centres |

### C. Asking instead of guessing

A question now goes to the operator, not the phone [208]. The operator taps the answer on the command post [178].

| ID | Said | Expected | Status |
|---|---|---|---|
| C1 | "Bravo 2, at the château." | A question on the command post: the castle or the metro station? The operator picks; the marker lands | Known on the phone; confirm on the command post |
| C2 | "Alpha 1, enemy patrol near the cemetery." | Track opened; a question about which of three cemeteries | Known |
| C3 | After C1, "Bravo 2, the castle." | Confirm what happens to a spoken answer. Not on stage unless it works 5 of 5 | Confirm |
| C4 | "Bravo 2, enemy vehicle to the east." | Not placed: no distance. The operator sees why | Known |

### D. What a unit sees: tracks

| ID | Said | Expected | Status |
|---|---|---|---|
| D1 | "Alpha 1, two enemy vehicles on Avenue de Paris, moving east." | Track, hostile vehicle ×2, heading east. ALPHA 1 does not move | Known |
| D2 | "Bravo 2, I see a drone about 300 metres north of me." | Track, unknown drone, 300 m north of BRAVO 2 | Known |
| D3 | "Bravo 2, suspicious vehicle near the church." | Track, suspect vehicle, at the church nearest BRAVO 2 | Known with BRAVO 2 at the town hall |
| D4 | "Alpha 1, Track 1 moved to Avenue de Nogent." | Track 1 moves; its old place stays as a trail | Known |
| D5 | "Bravo 2, Track 2 is hostile." | Track 2 turns hostile, keeps its number | Known |
| D6 | "Alpha 1, I see Bravo 2 at the church." | From ALPHA 1. Confirm that it does not move BRAVO 2 or ALPHA 1 | Confirm. Test only |

### E. Bearings and grids

See [Grids and bearings on the radio](#grids-and-bearings-on-the-radio) for which of these are worth showing.

| ID | Said | Expected | Status |
|---|---|---|---|
| E1 | "Alpha 1, unknown vehicle, bearing 060, 300 metres." | Track 300 m from ALPHA 1 on 060°, labelled "300 m, bearing 060, from ALPHA 1" [229, 230] | Confirm |
| E2 | "Bravo 2, at grid Delta Quebec 586 101." | BRAVO 2 in that cell, which is the castle, ±71 m [223] | The grid reader reads it; confirm end to end |
| E3 | "Bravo 2, at grid 586 101." | The same: the square is taken from the area | The same |
| E4 | "Alpha 1, enemy vehicle at grid 588 106." | Track in the town hall's cell | Confirm |
| E5 | "Alpha 1, drone 200 metres north of grid 586 101." | Track 200 m north of the cell's centre [230] | Confirm |
| E6 | "Alpha 1, unknown vehicle, 1600 mils, 400 metres." | Track 400 m due east of ALPHA 1 | Confirm. Test only |
| E7 | "Bravo 2, facing north, contact at 2 o'clock, 300 metres." | Track 300 m north-east of BRAVO 2 | Confirm. Test only |

Each grid pin is checked with the map page's grid box [232]: type the grid there, and the ring must sit on the pin.

The six-figure grids of the stage places, from `toGrid`: town hall and church DQ 588 106, castle DQ 586 101, château metro DQ 588 103, Vincennes station DQ 584 106, Bérault DQ 581 104.

### F. Recon: ask for a drone, send a unit

This is the new part: a drone team is a unit on the net, marked by a person [235].

| ID | Step | Expected | Status |
|---|---|---|---|
| F0 | Before marking: any request in the tray | CHARLIE 3 is not offered. Its call sign proves nothing | Known (test) |
| F1 | Command post: **What is it?** under CHARLIE 3, pick Drone team | The feed says "CHARLIE 3 is a drone team." | Known, by hand in a browser |
| F2 | "Charlie 3, at the castle." | CHARLIE 3 placed, so the line has a start | As A3 |
| F3 | "Alpha 1, unknown vehicle at the town hall, send the drone." | Track, unknown **vehicle** (not a drone), and a request in the tray with "Send CHARLIE 3 · drone team · free" | Known with "Mairie de Vincennes"; confirm with "the town hall" |
| F4 | Command post: Send CHARLIE 3, then confirm | A blue line from CHARLIE 3 to the track. CHARLIE 3's row says "Looking at Track n" | Known |
| F5 | "Charlie 3, Track 1 is hostile." | The track turns hostile. CHARLIE 3 does not move. This is the drone team reporting back | Confirm |
| F6 | Command post: Recon done under CHARLIE 3 | The line goes; CHARLIE 3 is free | Known |
| F7 | "Alpha 1, Track 1, request eyes on." | A request only: nothing placed, nothing asked | Known |
| F8 | "Bravo 2, send the drone." | A request with no track: the operator picks one | Known |
| F9 | "Alpha 1, enemy drone up north." and "Charlie 3, getting eyes on Track 1." | No request read | Known for the request reader; confirm what the report then does |
| F10 | "Charlie 3, friendly drone 200 metres north of me." | A friendly drone track. The tray then lists two things to send, so neither is offered first | Confirm. Test only |
| F11 | While CHARLIE 3 is looking, pick People under it | Refused: "CHARLIE 3 is looking at Track 1. End that first." | Known (test) |

### G. The call sign at the end

Only once [the sign-off reader](#the-sign-off-call-sign) is built and its eval passes.

| ID | Said | Expected |
|---|---|---|
| G1 | "At the town hall, Alpha 1." | From ALPHA 1 |
| G2 | "Moving towards the town hall, Alpha 1, over." | From ALPHA 1 |
| G3 | "Unknown vehicle at the town hall, send the drone, Alpha 1, out." | From ALPHA 1; the track and the request as in F3 |
| G4 | "Track 1 is hostile, Charlie 3." | From CHARLIE 3; Track 1, not Track 13 |
| G5 | "Alpha 1, I see Bravo 2 at the church." | From ALPHA 1: a call sign at the start wins |
| G6 | "I'm at the church with Bravo 2." | No sender: it waits in the Unassigned tray |
| G7 | "Two vehicles near Charlie 3." | No sender |
| G8 | "Send the drone to Track 2 Alpha 1 over", with no commas, as Whisper may write it | From ALPHA 1; the request is about Track 2 |

### H. The record: markers, paths, history

Lysk's third test.

| ID | Step | Expected |
|---|---|---|
| H1 | After blocks A to F, look at each unit | A marker with its call sign, a trail of where it was, the time of each report |
| H2 | Replay from the mission's start | Units appear in order. The request is open before the send; the line appears at the send; "CHARLIE 3 is a drone team" is in the feed at its time |
| H3 | Stop mission, then replay | The same picture; every task ended, nothing still open |
| H4 | Reload the command post in the middle of a mission | The same picture as before the reload |

## Pacing: the far guard

A radio report is held when it would move a unit farther than this since that unit's last fix:

```
15 m/s × seconds since the fix  +  the fix's circle  +  100 m
```

| Hop | Metres | Seconds the same unit must wait, from a ±30 m fix |
|---|---|---|
| Town hall to the church | 75 | none |
| Château metro to the town hall | 347 | 15 |
| Vincennes station to the town hall | 461 | 23 |
| Vincennes station to the château metro | 500 | 25 |
| Castle to the town hall | 613 | 33 |
| Bérault to the château metro | 710 | 39 |

The rule for the script: never give one unit two far places back to back. Go round the three units, so each has half a minute between its own reports. Pass 4 runs the script at stage speed to prove no line is held.

## The sign-off call sign

Today the sender is read at the start of the words, after the command post's name, or after "this is" ([callsigns.md](callsigns.md)). A call sign later in the message is not the sender. Pilots, and some radio users, put it last: "Climbing to five thousand, Speedbird 123."

The rule to build, in `lib/geo/callsigns.ts`, with no model:

1. It applies only when no sender was read at the start.
2. The call sign is the last thing said, or is followed only by "over", "out" or the like.
3. It matches one roster unit, by the same exact and near rules as at the start.
4. The word before it does not tie it into the sentence: "with", "near", "see", "at", "to", "of", "and", "behind", "towards", "by", "is". So "I'm at the church with Bravo 2" has no sender.
5. Its words are cut out before the request reader and the model read the rest, as a call sign at the start is.

How it is tested: new cases in `evals/callsigns.cases.json` for each rule, each with a near miss; a separate agent then writes held-out cases from the rule alone, scored before anyone looks at them, as for the reader itself. The danger is rule 4: a report that ends by naming another unit. A wrong unit moving is worse than a report in the tray, so when in doubt the report is held.

It gets its own decision line when it is built. Until then, on stage the call sign comes first.

## Grids and bearings on the radio

Adam's work [223, 229 to 233], sorted by whether a soldier would say it.

| What | On the radio? | For the stage |
|---|---|---|
| A grid for a position or a sighting: "at grid 586 101" | Yes. It is the usual way to give a place | Test E2 to E5. One line on stage if Alex's voice passes 5 of 5: six digits are six chances for Whisper |
| A bearing and a distance from the speaker: "bearing 060, 300 metres" | Yes. It is how a contact is reported | Test E1. A good stage line: no place name for Whisper to miss |
| Mils | Yes, by mortar and artillery observers | Test E6 only. One more number format to explain on stage |
| Clock directions | Yes, but from the way the speaker faces, which the app knows only when said [224] | Test E7 only |
| The grid lines, the ruler and the grid box on the map page [232] | The operator's tools. An operator reads a grid off the map to send a unit, but the phone hears nothing back [208], and the command post's own map does not have them | Not on stage. Used in testing, to check that a spoken grid landed in the right cell |

## The voice sheet for the morning

For Alex, through the phone to the Mac in offline mode, so the path is the stage's. In a quiet room first. Then again with crowd noise playing from another device at about arm's length. Hold the phone as on stage.

Each clip is one hold of the button. Speak at stage pace. Send the list in order; the mission's log keeps what Whisper wrote and what happened.

1. **Call signs, 5 times each,** in a short carrier line: "Alpha 1, radio check." "Bravo 2, radio check." "Charlie 3, radio check."
2. **Place names, 3 times each,** in "Alpha 1, at …": Vincennes station, the town hall, the castle, the château, the church, the cemetery, Avenue de Paris, Avenue de Nogent, Bérault metro.
3. **Every stage line** chosen after passes 1 and 2, **5 times each.**
4. **Every alternate** for a stage line, 3 times each.
5. **Numbers:** "bearing 060, 300 metres" and "bearing zero six zero, three hundred metres"; "grid 586 101" and "grid five eight six, one zero one"; "Track 1", "Track 2", "Track 3" in "Charlie 3, Track 1 is hostile".
6. **Request words, 3 times each:** "send the drone", "request eyes on".
7. **Sign-offs, 3 times each,** if built: lines G1 to G4.

This list is also the input for the speech-recognition session: the same clips, kept, become its regression set.

## Drills

Things that will happen on stage at least once. Each is done once in pass 4, by the people who will be on stage.

| Drill | What the operator does |
|---|---|
| A report lands in the Unassigned tray | Gives it to the unit, from the tray |
| A report is held as moved too far | Gives it to the unit named, or dismisses it and the speaker repeats |
| Whisper garbled the place; nothing was placed | The speaker says the alternate line |
| A question is open | Answers it on the command post before the next report |
| A track has the wrong kind | Change, on the track card |
| The phone loses the Mac | Cable in; reopen the app |
| Speech fails for good | The stage script as a scenario file, its steps sent from the phone's developer controls: the same words, through the same pipeline. To confirm in pass 1 that a step sent this way is read as a radio report. Last resort: the backup video |

## The stage script

Candidates. Passes 1 to 3 decide the final words.

**Short, about 90 seconds:**

1. "Alpha 1, at Vincennes station." A marker with its call sign.
2. "Bravo 2, at the château." The command post asks: castle or metro? The operator picks. *We ask instead of guessing.*
3. "Alpha 1, moving towards the town hall." The marker moves, with an arrow. *Natural phrasing, a path.*
4. "Alpha 1, unknown vehicle at the town hall, send the drone." A track, and a request in the tray.
5. The operator sends CHARLIE 3. A blue line. *A person decides.*
6. "Charlie 3, Track 1 is hostile." The symbol changes.
7. Replay from the start. *History.*

CHARLIE 3 is marked as a drone team and has reported its position ("Charlie 3, at the castle") before the pitch starts.

**Longer, if there is time,** in this order: E1 (a bearing), D2 (a drone north of me), E2 (a grid), G2 (a sign-off).

## Pre-flight

Ten minutes before, at the venue.

1. The Mac is on power. On the cable, its Wi-Fi is off, to show offline. On the phone's hotspot, the phone's mobile data is off instead.
2. The servers are up in offline mode ([setup.md](setup.md)): the coordinator, Ollama with `ministral-3:3b`, and Whisper.
3. The phone reaches the Mac, on the cable or the hotspot. Reopen the app after any change of link.
4. A fresh mission: Vincennes, start point Château de Vincennes, roster ALPHA 1, BRAVO 2, CHARLIE 3.
5. CHARLIE 3 is marked Drone team.
6. One warm-up report, spoken: "Charlie 3, at the castle." It is placed in under 5 s.
7. The command post is on the projector, at a zoom where the station, the town hall and the castle are all in view.
8. The phone's language is English.

## Done when

- Every stage line: 3 of 3 typed, 5 of 5 in Alex's voice, and clean in two dress rehearsals in a row.
- No stage line is held, asks an unplanned question, or takes more than 5 s.
- Every drill has been done once by the people on stage.
- The sign-off lines are on stage only if the sign-off eval, held-out cases included, has no wrong sender.
