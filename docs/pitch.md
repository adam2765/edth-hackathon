# Pitch

The Demo Day deck, in full: every slide's words in reading order, and its speaker notes. First draft on Saturday 21 November. Updated on Sunday 22 November, at about 08:30, once the app was feature complete: 15 slides. Square brackets mark what is not known yet.

## Where the deck lives

The deck is a Slides artifact on claude.ai, in Alex's account: <https://claude.ai/artifact/8wp2T9NU3zjWqdy6uV5gMm>. Anyone with the link can open it. It exports to PPTX or PDF, which the submission needs.

This file holds every word of the deck. The deck adds only the layout, the pictures and the motion. Change a slide's words here and in the deck in the same change, so the two always match; the [look](#the-look) is enough to lay out a new slide the same way.

The dates for the finished deck and the submission are in [overview.md](overview.md#timeline). The pitch role is in [work-split.md](work-split.md#role-4-evidence-then-pitch). The demo's lines and their tests are in [stage-test-plan.md](stage-test-plan.md).

## The story

The problem in Lysk's words, and the flood a mentor described. Then our answer in one sentence, the demo, and Lysk's three tests. Then why a marker can be trusted: plain code finds the place, and when the app is not sure, nothing moves and the operator is asked. Then what is ours on top: tracks, a drone sent to look, no GPS, no internet. Then the numbers, and what comes next.

The one sentence: speak, and a marker with your call sign moves on a shared map; when the app is not sure, nothing moves: it asks the operator.

What a Lysk mentor told us on 22 November shapes the wording. The map shows only what is certain. The operator asks back, not the app. A report the system does not understand is usually the system's fault, not the soldier's, so asking back is never pitched as fixing an unclear report.

## Slides

Each slide gives its background, then its words in reading order, then its picture and its speaker notes. The eyebrow is the small line in capitals above the title. Every slide except the cover and the close has a footer and the page number; the footer reads "Voice-to-Map · EDTH Paris 2026" unless the slide gives another.

### Part 1. Open: the problem in Lysk's words, and our answer in one sentence

#### 1. Cover

Dark. No footer.

- **Eyebrow:** EDTH Paris 2026 · Challenge 01 · Lysk
- **Title:** Voice-to-Map
- **Tagline:** Say where you are. The map moves.
- **Spoken line:** “Alpha 1, at Vincennes station.”
- **Bottom line:** Team [#__] · [Name], [Name], [Name], [Name]
- **Picture:** on the right half, a stylised street map drawn in the deck: an amber unit marker with its dotted trail and dashed accuracy ring, labelled "ALPHA 1 · 14:16:45 · ±30 m", and a blue unit labelled "BRAVO 2".

**Notes:** Open on the problem, not the tech. One sentence: a unit says where it is on the radio, and a marker with its call sign moves on a shared map within seconds. The line under the title is the demo’s first line. [Pitch length from the organisers: __ min.] [Team number for the file name: __.]

#### 2. The problem

Light.

- **Eyebrow:** The problem
- **Title:** Reports come by voice. The map is moved by hand.
- **Radio log** (left, dark panel):

  | Time | Call sign | Said |
  |---|---|---|
  | 14:16 | ALPHA 2 | “I’m behind the church.” |
  | 14:18 | ALPHA 2 | “South of the church.” |
  | 14:21 | ALPHA 2 | “I moved towards 35th street.” |

- **By hand:** An operator hears each report and moves the marker.
- **Under a flood:** In combat, hundreds of reports arrive on top of each other.
- **Bottom line:** **Lysk’s ask:** speak, and a shared map updates within seconds, with a history anyone can replay.

**Notes:** The three lines are Lysk’s own example sentences from the challenge deck. The pain is theirs too: “slow and error-prone”. The flood is what a Lysk mentor told us on 22 Nov: in active combat, hundreds of messages on top of each other, probably all urgent. Nothing should stay unanswered, though it does all the time today, and operators track what is open in spreadsheets. Helping the operator through that flood is the point of the system.

Source: [overview.md](overview.md#the-challenge).

#### 3. One sentence

Dark.

- **Eyebrow:** Voice-to-Map
- **Title:** Speak, and a marker with your call sign moves on a shared map. When the app is not sure, nothing moves: it asks the operator.
- **Four numbers:**

  | Number | Label |
  |---|---|
  | 3–5 s | from speech to marker, on one laptop, no internet |
  | 0 | coordinates written by the AI model |
  | 0 | reads of the phone’s GPS |
  | 3 | languages: English, French, Ukrainian |

**Notes:** The one-sentence pitch. 3 to 5 s is a short report with no internet: Whisper and the 3B model on the M1 Pro. A long report took 8 to 11 s in the night’s tests, with other programs running. Hosted, it is 1 to 3 s. The two zeros are the rules we never break: the model never makes a coordinate, the app never reads GPS. [Replace 3–5 s with the figure timed at the dress rehearsal.]

Source: [overview.md](overview.md#our-approach), [stage-test-plan.md](stage-test-plan.md#pass-2-synthetic-voices).

### Part 2. Show it: the live demo, then Lysk's three tests

#### 4. Live demo

Amber, the one statement slide. The footer is the line below, not the usual one.

- **Eyebrow:** Live demo · Vincennes · no internet
- **Title:** Watch the command post.
- **Script:**

  | Said on the radio, or done by the operator | The command post shows |
  |---|---|
  | “Alpha 1, at Vincennes station.” | → ALPHA 1 placed, ±30 m |
  | “Bravo 2, at the château.” | → Asks: the castle, or the metro? |
  | **Operator:** picks 2, then confirms | → BRAVO 2 at the metro station |
  | “Bravo 2, moving towards the town hall.” | → Moves half way, with an arrow |
  | “Alpha 1, unknown vehicle, bearing 060, 300 metres, send the drone.” | → Track 1, and a recon request |
  | **Operator:** sends CHARLIE 3, then confirms | → A line from CHARLIE 3 to Track 1 |
  | “Charlie 3, Track 1 is hostile.” | → Track 1 turns hostile |
  | **Operator:** replays the mission | → The same minute again, with times |

- **Footer:** One phone is every radio · one laptop runs everything

**Notes:** Switch to the command post on the big screen. Show it before describing it. About 90 seconds. Alex speaks every unit into one phone; the call sign in the words says who. The laptop is the coordinator, offline: Whisper, the 3B model and a saved base map, no internet. Before the pitch: the mission is open in Vincennes with the roster ALPHA 1, BRAVO 2 and CHARLIE 3; CHARLIE 3 is marked as a drone team; “Charlie 3, at grid 586 101.” places it and warms the model up. Say the call sign first, and say the lines as written. Leave about 8 seconds between the operator’s pick and “moving towards the town hall”. Fallbacks: typed reports if the hall is too loud; the backup video if the phone cannot reach the laptop. The script and its tests are in docs/stage-test-plan.md.

Source: [stage-test-plan.md](stage-test-plan.md#the-stage-script), decision 236.

#### 5. Lysk's three tests

Light.

- **Eyebrow:** What Lysk asked for
- **Title:** Lysk’s three tests
- **Three cards:**

  | Test | What we show | Status |
  |---|---|---|
  | It works live | 3 to 5 s from the end of speech to the marker with no internet; 1 to 3 s hosted. | Met (check icon) |
  | Natural phrasing | “South of the church”, “towards the town hall”, “bearing 060, 300 metres”, “grid 586 101”, in three languages. | Met (check icon) |
  | Marker, path, history | Call signs, trails, timestamps, a live feed and a replay of the whole day, on one shared map. | Built (tool icon) |

**Notes:** These are the three things Lysk’s deck says the jury will look at, in their order. Say each in one breath and point back at what they just saw in the demo. “South of the church” asks which church when three are in reach; near one church it places. The third says Built, not Met, until the dress rehearsal has run the whole script twice with the phone and the projector. [Change it to Met after that run, with the date.]

Source: [overview.md](overview.md#the-challenge).

### Part 3. How it works, why a marker can be trusted, and the operator's one list of decisions

#### 6. How it works

Dark.

- **Eyebrow:** How it works
- **Title:** The AI reads the words. Plain code finds the place.
- **Five boxes, left to right, joined by arrows** (the resolver's box has an amber edge):

  | Tag | Box | Text |
  |---|---|---|
  | IN | Voice | A radio call: the call sign is in the words |
  | AI | Speech to text | Whisper on the laptop, or Mistral hosted |
  | AI | Intent | Place, relation, distance, direction. Never a coordinate. |
  | PLAIN CODE | Resolver | Reads call sign, grid and bearing. Finds the place, or asks. |
  | OUT | Command post | Shared map and replay; one list of decisions |

- **Statement:** The model never writes a coordinate.
- **Under it:** Every marker is a real place, geocoded with OpenStreetMap’s Overpass API, or a stated distance and direction from the last known one.

**Notes:** This is the trust slide. The language model only extracts intent: which place, which relation (at, near, south of, towards), a stated distance, a compass or clock direction. The resolver is deterministic code that places that against a local gazetteer built from OpenStreetMap. Offline, the same chain runs on one laptop: Whisper large-v3-turbo for speech, Ministral 3B through Ollama for intent. Plain code also reads what must be exact: who spoke (the call sign, against the mission’s roster), a grid reference, a bearing in degrees or mils, a clock direction, and a request for a drone. The model never sees those as numbers to round. Lysk's requirement slide says landmarks and streets are geocoded into real coordinates with OpenStreetMap APIs: say it in those words. We geocode each area once, through the Overpass API, when the area is built. So no report waits on a public server, it works offline, and no unit's words leave the team.

Source: [architecture.md](architecture.md), [callsigns.md](callsigns.md), [gazetteer.md](gazetteer.md#how-it-is-built).

#### 7. Asking back

Light.

- **Eyebrow:** Asking back
- **Title:** Not sure? Nothing moves.
- **Body:** “Enemy patrol near the cemetery.” Two cemeteries fit. The track waits, both are numbered on the map, and the operator picks one or asks by radio.
- **Statement:** The map shows only what is certain.
- **Picture:** on the right, the command post in Vincennes: ALPHA 1 is awaiting an answer, the two cemeteries are numbered 1 and 2 on the map, and the two choices sit under the report ([cp-question.png](images/tracks/cp-question.png)).

**Notes:** Our main difference from the other teams, and what a Lysk mentor asked for on 22 Nov: the map shows only what is certain, and with no certainty it waits for a confirmation. The operator asks back, not the app. Real radio calls tend to be clear; when the system does not understand, that is usually the system’s fault, not the soldier’s, so never present this as fixing an unclear report. A wrong marker has nothing on it that says it is wrong. The picture is from before the Decisions list; the numbered places on the map are as today. [Retake it with the Decisions list open.]

Source: [ask-back.md](ask-back.md), decisions 178 and 240.

#### 8. The operator's list

Light.

- **Eyebrow:** The operator’s list
- **Title:** Everything that waits on the operator, in one list.
- **Table:**

  | What waits | As heard or shown | The operator |
  |---|---|---|
  | Which place? | “Bravo 2, at the château.” | Picks 1 or 2, confirms |
  | Which unit? | “At Vincennes station, Alpha 1, over.” | Confirms it was ALPHA 1 |
  | Too far, too fast? | “ALPHA 1 moved 461 m in 0 s.” | Says if that is right |
  | Send a drone? | “…send the drone.” | Sends CHARLIE 3, or waits |

- **Under it:** Oldest first, red after two minutes, worked from the keyboard. Clear reports place themselves; a person decides the rest.

**Notes:** Units report by radio to a live operator, so every question goes to the operator. With 20 to 40 units on the net the clear reports place themselves, and the operator’s job is the decision points, so those have to be fast: one list at the top of the side panel, oldest first, each line with how long it has waited. Keys 1 to 9 pick, Enter confirms, the next one opens. The number waiting shows in the browser tab. A unit’s next report closes the question it left open. A call sign said last is only suggested: the operator confirms it, because an order to a unit ends the same way. This is the mentor’s flood: nothing stays unanswered, and no spreadsheet. [Add a screenshot of the list if there is room.]

Source: decisions 203, 204, 237 and 240 to 242; [callsigns.md](callsigns.md).

### Part 4. Beyond a position: tracks, and a drone sent to look at one

#### 9. Tracks

Dark.

- **Eyebrow:** Beyond position
- **Title:** It maps what a unit sees, too.
- **Points:**
  - “Unknown vehicle, bearing 060, 300 metres” becomes Track 1.
  - A standard APP-6 symbol: who saw it, when, ± metres.
  - Hostile only when the speaker says so.
  - A fresh track shows motion; an old one goes still.
- **Picture:** on the right, the command post in Vincennes: two units, six tracks with military symbols and accuracy circles, the units and tracks lists, the report feed and the replay bar ([cp-six-tracks.png](images/tracks/cp-six-tracks.png)).

**Notes:** Lysk asked only for the speaker’s own position. A unit also reports what it sees, so the same pipeline turns those reports into tracks: a numbered symbol, who saw it, when, and how sure. A report about a track never moves the speaker. Nothing is marked hostile unless the speaker said so. The bearing is kept exact, 060 and not “north-east”. Motion on the map means one thing: the report is fresh. After ten minutes a track’s arrow stops flowing, because the way it was moving is what was said then, not what is known now. The operator can also place, move and close tracks by hand.

Source: [tracks.md](tracks.md), decisions 229 and 238.

#### 10. Recon on request

Dark.

- **Eyebrow:** Recon on request
- **Title:** A unit asks. A person sends the drone.
- **Points:**
  - “…send the drone”, in the same call as the report.
  - The free drone team is offered first; a person confirms.
  - A line joins the drone to the track. The app works out nothing else.
- **Picture:** on the right, the command post in Vincennes: a blue line runs from a friendly drone team to Track 2, an unknown vehicle, and the feed says the command post sent it after ALPHA 1 asked ([cp-recon-sent.png](images/tracks/cp-recon-sent.png)).

**Notes:** Built on Saturday night. A unit asks by radio for eyes on a track, in the same call as its report or on its own (“Track 2, request eyes on”). The request waits in the operator’s list with the free drone team offered first. Only a person sends, with a confirm every time, and only a person ends it. The drone team reports back by radio: “Charlie 3, Track 1 is hostile.” This is for reconnaissance only: the app works out nothing between things on the map, no range, no “nearest”, no ranking, no “target” wording. The request words are read in code, in English, French, Ukrainian and Russian: 84 of 84 in its eval. In the demo the drone team is CHARLIE 3, a unit on the net; in this picture it is a track the command post placed.

Source: [tracks.md](tracks.md#recon-requests-and-tasking), decisions 234 and 235.

### Part 5. Built for the field, and measured

#### 11. Built for the field

Dark.

- **Eyebrow:** Built for the field
- **Title:** Works where the network doesn’t.
- **Four cards, two by two:**

  | Card | Text |
  |---|---|
  | No GPS | Never reads the phone’s location, so jamming changes nothing. |
  | No internet | Speech, intent and the map itself all run on one laptop. |
  | Soldiers’ words | Grids, bearings in degrees or mils, clock directions, in three languages. |
  | European models | Mistral, from France. Offline, nothing leaves the laptop. |

- **Bottom line:** Any area in one command, geocoded from OpenStreetMap: Vincennes, central Kyiv, Izium.

**Notes:** Position comes from named places, and from a stated distance and direction off the last known position, never from GPS. Offline mode: Whisper large-v3-turbo through whisper-server and Ministral 3B through Ollama, on the same laptop; phones on a local Wi-Fi network. Izium is a town in Kharkiv Oblast near the front. The stage demo itself runs with no internet, and the base map draws from a copy saved on the laptop. The three languages are English, French and Ukrainian; a report in Russian is answered in Ukrainian. A grid is an MGRS reference, read in code, also when its letters are spelled in French or Ukrainian. [Say when the offline run was last proven: the dress rehearsal.]

Source: [overview.md](overview.md#our-approach), decisions 223, 229, 236 and 239.

#### 12. Evidence

Light. The footer is the source line below, not the usual one.

- **Eyebrow:** Evidence
- **Title:** Tested the way we demo: offline, line by line.
- **Four numbers:**

  | Number | Label |
  |---|---|
  | 27/27 | stage lines placed right, spoken in three synthetic voices |
  | 0 | wrong units in 220 call-sign cases |
  | 84/84 | recon requests read, 20 of them held out |
  | 2 | wrong markers in 357 hosted eval results |

- **Under them:** Extraction eval, 119 reports, three rounds: hosted Mistral Small passes 89%; offline Ministral 3B 66%, with 9 wrong markers.
- **Footer:** Sources: docs/stage-test-plan.md, evals/README.md · 21 and 22 Nov

**Notes:** The first three numbers are the offline path we demo. 27 of 27: nine stage lines, each as a clip in three macOS voices, through Whisper large-v3-turbo and the 3B model. Clean synthetic voices in a silent room, so this is the easy case: say so if asked. Other lines scored 23 of 30; the French names Bérault and Mairie de Vincennes did not survive Whisper, so the script has neither. The call-sign reader never named a wrong unit in 220 cases. A wrong marker is the worst miss: a wrong place on the map with nothing to say it is wrong. The offline model is weaker on free wording, which is why the stage lines are tested one by one. 509 unit tests pass. [Add Alex’s own voice, 5 of 5 for each line, and the timed dress rehearsal, when done.]

Source: [stage-test-plan.md](stage-test-plan.md#results), [evals/README.md](../evals/README.md#scores).

### Part 6. What comes next, and the close

#### 13. Next

Dark.

- **Eyebrow:** Next
- **Title:** From the hall to the field.
- **Four steps, one per row:**

  | Step | Text |
  |---|---|
  | Real radios | Audio from a handheld set: noise, overlapping voices, hundreds of calls. |
  | Answers by voice | A spoken reply picks the choice for a one-key confirm. Measured, not built yet. |
  | A country-sized gazetteer | One build for every town a unit may report from. |
  | Into the unit’s own map | Send markers and tracks to the system a unit already uses. |

**Notes:** The organisers’ stated goal is deployment, so end on the path to it. The phone app is a stand-in for a radio; the next step is audio from a real set. Answers by voice: a reader of spoken replies scored 342 of 372 on hosted Mistral and 345 of 372 on the offline model, and nothing uses it yet. The mentor’s line for intake: automate it, corrections included, with every entry confirmed by the operator; a switch that skips the confirm is ours to offer. [Name the map system if the mentors name one.]

Source: [ask-back.md](ask-back.md), [gazetteer.md](gazetteer.md#scaling-the-gazetteer), decision 199.

#### 14. Close

Dark. No footer.

- **Eyebrow:** Voice-to-Map · Team [#__]
- **Title:** Say where you are. The map moves.
- **Links:**
  - Live: [edth-hackathon.vercel.app](https://edth-hackathon.vercel.app)
  - Code: [github.com/beverage/edth-hackathon](https://github.com/beverage/edth-hackathon)
  - Video: [link]
- **Team line:** [Name, role] · [Name, role] · [Name, role] · [Name, role]
- **Small line:** Built at EDTH Paris, 20 to 22 November. Before the event: the stage-1 web app, tagged prior-work-fri-1800 in the repo.

**Notes:** Close on the one line from the cover. The organisers ask every team to say what it had before the event: the tag prior-work-fri-1800 marks it, and git log prior-work-fri-1800..main lists what was built here. The submitted PDF keeps these links clickable.

### Part 7. Appendix: the questions we expect from the jury

#### 15. Questions we expect

Light. Not presented.

- **Eyebrow:** Appendix
- **Title:** Questions we expect
- **Table:**

  | Question | Short answer |
  |---|---|
  | What if OpenStreetMap is wrong, or a place is missing? | It asks back, or says it cannot place the report; it never guesses. An area rebuilds from OpenStreetMap in one command. |
  | Why not geocode each report live? | Asking back needs every candidate, not a geocoder’s top hit. It also works offline. |
  | Why no GPS? | GPS is jammed and spoofed near the front. Position comes from named places, and from a stated distance and direction off the last known one. |
  | What leaves the device? | Offline: nothing leaves the laptop. Hosted: the clip and its words go to Mistral, a French provider. |
  | How does it scale? | Each area is one file built from OpenStreetMap by a script. A country-sized gazetteer is the next step. |
  | Who decides, under a flood of reports? | A person. Clear reports place themselves; the rest wait in one list, oldest first, for a confirm. |

**Notes:** Backup slide, not presented. The longer answers are in docs/known-gaps.md and docs/gazetteer.md. [Add the questions the mentors and the pre-selection jury actually asked.] Why not live: each area is geocoded once through the Overpass API, one of OpenStreetMap's APIs. A live geocoder such as Nominatim gives its best few hits, allows one request a second, and would send every report's place names to an outside server. On asking back: a Lysk mentor told us on 22 Nov that the map should show only what is certain, and that the operator asks back. Say it that way, never as fixing a soldier’s unclear report. A wrong marker costs someone acting on a place where nobody is.

Source: [known-gaps.md](known-gaps.md), [gazetteer.md](gazetteer.md).

## To fill in

| What | Slides | Where it comes from |
|---|---|---|
| Team number and names | 1, 14 | The organisers give the number; the submitted file is named with it. |
| Pitch length | all | The organisers. 15 slides is long for 3 minutes; cut 8, 11 and 12 first. |
| Seconds from speech to marker, timed | 3, 5 | The dress rehearsal, pass 4 of [stage-test-plan.md](stage-test-plan.md#the-passes). 3 to 5 s is a short report offline [195]. |
| "Built" becomes "Met" for marker, path and history | 5 | The dress rehearsal: the whole script twice, with the phone and the projector |
| A picture of the Decisions list, with a question open | 7, 8 | Nobody has taken one. Slide 7's picture is from before the list [240]. Save it under [docs/images/](images/), then put it in the deck. |
| The tracks picture, taken again | 9 | It is from 21 November, before the Decisions list and the moving arrows [238] |
| Alex's own voice, and the dress rehearsal | 12 | Passes 3 and 4 of [stage-test-plan.md](stage-test-plan.md#the-passes) |
| The eval, run again | 12 | `npm run eval:extract -- --resolve --repeat 3` on both models, if the prompt changed since 21 November |
| The map system's name | 13 | The mentors, if they name one |
| Video link | 14 | The backup video |
| Questions the mentors and the jury asked | 15 | Whoever sits in on those talks |

Settled since the first draft: the demo is in Vincennes, in English, offline, with one phone as every radio [236]; the operator is asked back, in one Decisions list [208, 240]; and the effector line became recon on request, for looking at a track only [234].

## The look

- Dark slides like the command post, light slides like paper, so the screenshots sit at home. One amber slide, the demo, as the statement.
- Amber means a question or a signal; blue means a friendly unit, as on the command post.
- Headings in Oswald, text in Inter, spoken lines and call signs in JetBrains Mono. All three have Cyrillic, and all three travel in a PPTX file.
- Type sizes on the 1920 × 1080 slide: 120 px for the cover title and big numbers, 72 px for slide titles, 44 px for card titles and statements, 32 px for text and the operator's table, 24 px for eyebrows, footers, small lines and the appendix table.
- Colours: ink `#12181D`, panel `#1D272F`, paper `#EEEBE3`, card `#E1DCD0`, amber `#F2B33D`, dark amber for text on paper `#8A5600`, blue `#5B97F2`, dark blue for text on paper `#2557A8`.
- Screenshots come from [docs/images/tracks/](images/tracks/). Retake them there when the screen changes, then put them in the deck again.

## Submitting

Export a PDF, or a PPTX, from the deck's Share menu, with the links still clickable. Name the file with the team number. The deadline is in [overview.md](overview.md#timeline).
