# Pitch

The Demo Day deck, in full: every slide's words in reading order, and its speaker notes. First draft on Saturday 21 November, at about 18:30, with 14 slides. Square brackets mark what is not known yet.

## Where the deck lives

The deck is a Slides artifact on claude.ai, in Alex's account: <https://claude.ai/artifact/8wp2T9NU3zjWqdy6uV5gMm>. It is private until Alex shares it, so ask Alex for access. It exports to PPTX or PDF, which the submission needs.

This file holds every word of the deck. The deck adds only the layout, the pictures and the motion. Change a slide's words here and in the deck in the same change, so the two always match; the [look](#the-look) is enough to lay out a new slide the same way.

The dates for the first deck, the finished deck and the submission are in [overview.md](overview.md#timeline). The pitch role is in [work-split.md](work-split.md#role-4-evidence-then-pitch).

## The story

The problem in Lysk's words. Then our answer in one sentence, the demo, and Lysk's three tests. Then why a marker can be trusted, what is ours on top, the numbers, and what comes next.

The one sentence: speak, and a marker with your call sign moves on a shared map; if the report could mean two places, it asks.

## Slides

Each slide gives its background, then its words in reading order, then its picture and its speaker notes. The eyebrow is the small line in capitals above the title. Every slide except the cover and the close has a footer and the page number; the footer reads "Voice-to-Map · EDTH Paris 2026" unless the slide gives another.

### Part 1. Open: the problem in Lysk's words, and our answer in one sentence

#### 1. Cover

Dark. No footer.

- **Eyebrow:** EDTH Paris 2026 · Challenge 01 · Lysk
- **Title:** Voice-to-Map
- **Tagline:** Say where you are. The map moves.
- **Spoken line:** “ALPHA 1, at Bérault metro.”
- **Bottom line:** Team [#__] · [Name], [Name], [Name], [Name]
- **Picture:** on the right half, a stylised street map drawn in the deck: an amber unit marker with its dotted trail and dashed accuracy ring, labelled "ALPHA 1 · 14:16:45 · ±30 m", and a blue unit labelled "BRAVO 2".

**Notes:** Open on the problem, not the tech. One sentence: a unit says where it is, and a marker with its call sign moves on a shared map within seconds. [Pitch length from the organisers: __ min.] [Team number for the file name: __.]

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
- **Slow and error-prone:** “The church” can be two churches. A wrong marker looks right.
- **Bottom line:** **Lysk’s ask:** speak, and a shared map updates within seconds, with a history anyone can replay.

**Notes:** The three lines are Lysk’s own example sentences from the challenge deck. The pain is theirs too: “slow and error-prone”. Land the second point: a wrong marker looks like a right one. That sets up asking back.

Source: [overview.md](overview.md#the-challenge).

#### 3. One sentence

Dark.

- **Eyebrow:** Voice-to-Map
- **Title:** Speak, and a marker with your call sign moves on a shared map. If the report could mean two places, it asks.
- **Four numbers:**

  | Number | Label |
  |---|---|
  | 1–3 s | from the end of speech to the marker |
  | 0 | coordinates written by the AI model |
  | 0 | reads of the phone’s GPS |
  | 3 | languages: English, French, Ukrainian |

**Notes:** The one-sentence pitch. 1 to 3 s is hosted mode, end of speech to marker; offline on one laptop it is 3 to 5 s. The two zeros are the rules we never break: the model never makes a coordinate, the app never reads GPS. [Replace 1–3 s with the real-phone figure once measured.]

Source: [overview.md](overview.md#our-approach).

### Part 2. Show it: the live demo, then Lysk's three tests

#### 4. Live demo

Amber, the one statement slide. The footer is the placeholder below, not the usual one.

- **Eyebrow:** Live demo · Vincennes [or Kyiv, or Izium]
- **Title:** Watch the command post.
- **Script:**

  | Who | Said | The command post shows |
  |---|---|---|
  | ALPHA 1 | “I’m at Bérault metro.” | → Placed, ±30 m |
  | ALPHA 1 | “Now I’m at the château de Vincennes.” | → Asks: the castle, or the station? |
  | ALPHA 1 | “Moving towards the town hall.” | → Moves part way, with an arrow |
  | BRAVO 2 | “Je suis devant la mairie.” | → Placed, answered in French |
  | BRAVO 2 | “Hostile drone, 300 metres north.” | → Track 2: hostile drone, ±150 m |
  | CP | Drag the replay slider | → The whole mission, in order |

- **Footer:** [Final script and who holds which phone: at the freeze]

**Notes:** Switch to the command post on the big screen. Show it before describing it. Fallbacks: typed reports if the hall is too loud; the backup video if the network fails. The lines follow the README demo script plus one track. [Swap in the mentors’ sentences if they give us some.]

Source: [README](../README.md#demo-script).

#### 5. Lysk's three tests

Light.

- **Eyebrow:** What Lysk asked for
- **Title:** Lysk’s three tests
- **Three cards:**

  | Test | What we show | Status |
  |---|---|---|
  | It works live | 1 to 3 s from the end of speech to the marker, hosted; 3 to 5 s offline on one laptop. | Met (check icon) |
  | Natural phrasing | “South of the church”, “towards rue de Fontenay”, “two blocks east”, “300 m at 3 o’clock”, in three languages. | Met (check icon) |
  | Marker, path, history | Call signs, trails, timestamps, a live feed and a replay anyone can scrub, on one shared map. | Built (tool icon) |

**Notes:** These are the three things Lysk’s deck says the jury will look at, in their order. Say each in one breath and point back at what they just saw in the demo. The third says Built, not Met, until we have run a mission with three real phones and a projector. [Change it to Met after that run, with the date.]

Source: [overview.md](overview.md#the-challenge).

### Part 3. How it works, and why a marker can be trusted

#### 6. How it works

Dark.

- **Eyebrow:** How it works
- **Title:** The AI reads the words. Plain code finds the place.
- **Five boxes, left to right, joined by arrows** (the resolver's box has an amber edge):

  | Tag | Box | Text |
  |---|---|---|
  | IN | Voice | A radio call, or hold to talk on a phone |
  | AI | Speech to text | Mistral hosted, or Whisper on the laptop |
  | AI | Intent | Place, relation, distance, direction. Never a coordinate. |
  | PLAIN CODE | Resolver | Looks the place up in OpenStreetMap data, or asks back |
  | OUT | Command post | Shared map, feed and replay, or a question back |

- **Statement:** The model never writes a coordinate.
- **Under it:** Every marker is a real place from OpenStreetMap, or a stated distance and direction from the last known one.

**Notes:** This is the trust slide. The language model only extracts intent: which place, which relation (at, near, south of, towards), a stated distance, a compass or clock direction. The resolver is deterministic code that places that against a local gazetteer built from OpenStreetMap. Offline, the same chain runs on one laptop: Whisper large-v3-turbo for speech, Ministral 3B through Ollama for intent.

Source: [architecture.md](architecture.md).

#### 7. Asking back

Light.

- **Eyebrow:** Asking back
- **Title:** When a report could mean two places, it asks.
- **Body:** “Enemy patrol near the cemetery.” Two cemeteries are in reach, so the app asks which: aloud, in the speaker’s language, with up to three choices and how far each is.
- **Spoken line:** “Which cemetery: Cimetière Nord de Saint-Mandé, or Cimetière ancien?”
- **Statement:** A silently wrong marker is worse than a question.
- **Small line:** On a radio net, the operator answers for the unit from the command post.
- **Picture:** on the right, the phone app showing the question: which cemetery, with two choices, their kind and distance, and "None of these" ([phone-question.png](images/tracks/phone-question.png)).

**Notes:** Our main difference from the other teams. Lysk’s deck does not mention it, so say why it matters: a wrong marker has nothing on it that says it is wrong. While a question is open the unit shows “awaiting answer” on the shared map. On a radio net nobody taps a phone, so the operator can answer from the command post, with a confirm.

Source: [tracks.md](tracks.md#on-the-phone), decision 178.

### Part 4. Beyond a position: tracks, and the command post running a radio net

#### 8. Tracks

Dark.

- **Eyebrow:** Beyond position
- **Title:** It maps what a unit sees, too.
- **Points:**
  - “Hostile drone, 300 m north” becomes Track 2.
  - A standard APP-6 symbol: who saw it, when, ± metres.
  - Hostile only when the speaker says so.
  - The operator can place, move and close tracks.
- **Picture:** on the right, the command post in Vincennes: two units, six tracks with military symbols and accuracy circles, the units and tracks lists, the report feed and the replay bar ([cp-six-tracks.png](images/tracks/cp-six-tracks.png)).

**Notes:** Lysk asked only for the speaker’s own position. A unit also reports what it sees, so the same pipeline turns those reports into tracks: a numbered symbol, who saw it, when, and how sure. A report about a track never moves the speaker. Nothing is marked hostile unless the speaker said so. [Wording here depends on the effector decision: today tracks are for reconnaissance only, decision 145.]

Source: [tracks.md](tracks.md).

#### 9. Coordinating the net

Light.

- **Eyebrow:** Coordinating the net
- **Pill** (top right): In progress · [status at freeze]
- **Title:** One operator runs the whole radio net.
- **Three cards:**

  | Card | Text |
  |---|---|
  | Who spoke | The call sign is read from the words (“BRAVO 2, this is…”) and matched to the mission’s roster. A transcript never invents a unit. |
  | Answer for the unit | A unit on a radio can’t tap a screen. The operator answers its question from the command post, and confirms. |
  | Answer by voice | “The second one.” A spoken reply is read as a choice and shown to the operator to confirm. |

**Notes:** Why this slide exists: units report by radio to a live operator, not from a phone each (heard from a Lysk mentor on 21 Nov). So nobody “joins”, the call sign has to come from the words, and questions go to the operator. Answering from the command post is merged; call signs from the words and spoken answers are on branches today. [Update each card’s status at the freeze, or cut what did not land.]

Source: [ask-back.md](ask-back.md).

### Part 5. Built for the field, and measured

#### 10. Built for the field

Dark.

- **Eyebrow:** Built for the field
- **Title:** Works where the network doesn’t.
- **Four cards, two by two:**

  | Card | Text |
  |---|---|
  | No GPS | Never reads the phone’s location, so jamming changes nothing. |
  | Uplink off | One laptop runs it all: Whisper and Ministral 3B, no internet. |
  | Three languages | English, French, Ukrainian. Russian is answered in Ukrainian. |
  | European models | Mistral, from France. Offline, nothing leaves the laptop. |

- **Bottom line:** Any area in one command, from OpenStreetMap: Vincennes, central Kyiv, Izium.

**Notes:** Position comes from named places, and from a stated distance and direction off the last known position, never from GPS. Offline mode: Whisper large-v3-turbo through whisper-server and Ministral 3B through Ollama, on the same laptop; phones on a local Wi-Fi network. Izium is a town in Kharkiv Oblast near the front. [Say whether the uplink-off demo was proven in the hall, and when.]

Source: [overview.md](overview.md#our-approach).

#### 11. Evidence

Light. The footer is the source line below, not the usual one.

- **Eyebrow:** Evidence
- **Title:** Measured on 119 test reports, three rounds each.
- **Four numbers:**

  | Number | Label |
  |---|---|
  | 89% | passed, hosted Mistral Small (319 of 357) |
  | 2 | wrong markers in 357: the miss that matters |
  | 0.8 s | median time to read a report, hosted |
  | [__ m] | median error on the field walk |

- **Under them:** Offline on one laptop, Ministral 3B: 66% passed, 9 wrong markers in 357, 3.4 s median.
- **Footer:** Source: evals/README.md, prompt 300d5e0a2d, 21 Nov · [rerun at the freeze]

**Notes:** A wrong marker is the worst miss: a wrong place on the map with nothing to say it is wrong. Most other misses ask back instead. The eval is text in, resolver out, so it scores the model and the resolver, not speech. [Add: seconds from speech to marker on a real phone; the field-walk error in metres, scored against GPS logged silently, which the app never reads; real voices, if recorded.] [Decide whether to show the offline line or keep it for questions.]

Source: [evals/README.md](../evals/README.md#scores).

### Part 6. What comes next, and the close

#### 12. Next

Dark.

- **Eyebrow:** Next
- **Title:** From seeing the net to acting on it.
- **Four steps, one per row:**

  | Step | Text |
  |---|---|
  | Call an effector onto a track | [What we show by Sunday, and who confirms each request] |
  | Real radio audio | Noise, overlapping voices, and call signs read from the words. |
  | A country-sized gazetteer | One build for every town a unit may report from. |
  | Into the unit’s own map | Send markers and tracks to the system a unit already uses. |

**Notes:** The organisers’ stated goal is deployment, so end on the path to it. The effector line is a placeholder: today the app is reconnaissance only and works out nothing between a unit and a track (decision 145). If effector summoning lands, this slide and the tracks slide change together. [Name the map system if the mentors name one.]

Source: [gazetteer.md](gazetteer.md#scaling-the-gazetteer).

#### 13. Close

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

#### 14. Questions we expect

Light. Not presented.

- **Eyebrow:** Appendix
- **Title:** Questions we expect
- **Table:**

  | Question | Short answer |
  |---|---|
  | What if OpenStreetMap is wrong, or a place is missing? | It asks back, or says it cannot place the report; it never guesses. An area rebuilds from OpenStreetMap in one command. |
  | Why no GPS? | GPS is jammed and spoofed near the front. Position comes from named places, and from a stated distance and direction off the last known one. |
  | What leaves the device? | Offline: nothing leaves the laptop. Hosted: the clip and its words go to Mistral, a French provider. |
  | How does it scale? | Each area is one file built from OpenStreetMap by a script. A country-sized gazetteer is the next step. |
  | What does a wrong marker cost? | Someone acts on a place where nobody is. That is why the app asks back instead of guessing. |

**Notes:** Backup slide, not presented. The longer answers are in docs/known-gaps.md and docs/gazetteer.md. [Add the questions the mentors and the pre-selection jury actually asked.]

Source: [known-gaps.md](known-gaps.md).

## To fill in

| What | Slides | Where it comes from |
|---|---|---|
| Team number and names | 1, 13 | The organisers give the number; the submitted file is named with it. |
| Pitch length | all | The organisers. 14 slides is long for 3 minutes; cut 9 to 11 first. |
| Demo area | 4 | [Team question 3](open-questions.md#for-the-team) |
| The final demo script, and who holds which phone | 4 | Role 4, at the 18:00 run-through |
| Seconds from speech to marker on a real phone | 3, 5 | Role 4's timings. The 1 to 3 s today is hosted mode. |
| "Built" becomes "Met" for marker, path and history | 5 | A mission with three real phones and a projector |
| Who is asked back | 7 | Since the phone became a radio [208], a question goes to the operator, not the phone. The slide still shows the phone's question: swap in the command post's question card or the Unassigned tray [203], and say the operator is asked. |
| Each coordination card: built, or cut | 9 | At the freeze. Merged: answering from the command post [178], call signs from the words against a roster [200], and the Unassigned tray [203]. Spoken answers are measured, not built [199]: swap that card for the tray unless they land. The slide's notes still say call signs are on a branch. |
| The eval, run again; the field-walk error in metres | 11 | `npm run eval:extract -- --resolve --repeat 3` on both models; the field walk |
| The effector line | 12 | What we show by Sunday. Tracks are for reconnaissance only today [145]; the line, and the tracks slide's wording, change only with a decision that changes 145. |
| Video link | 13 | The backup video, recorded after the freeze |
| Questions the mentors and the jury asked | 14 | Whoever sits in on those talks |

## The look

- Dark slides like the command post, light slides like paper, so the screenshots sit at home. One amber slide, the demo, as the statement.
- Amber means a question or a signal; blue means a friendly unit, as on the command post.
- Headings in Oswald, text in Inter, spoken lines and call signs in JetBrains Mono. All three have Cyrillic, and all three travel in a PPTX file.
- Type sizes on the 1920 × 1080 slide: 120 px for the cover title and big numbers, 72 px for slide titles, 44 px for card titles and statements, 32 px for text, 24 px for eyebrows, footers and small lines.
- Colours: ink `#12181D`, panel `#1D272F`, paper `#EEEBE3`, card `#E1DCD0`, amber `#F2B33D`, dark amber for text on paper `#8A5600`, blue `#5B97F2`, dark blue for text on paper `#2557A8`.
- Screenshots come from [docs/images/tracks/](images/tracks/). Retake them there when the screen changes, then put them in the deck again.

## Submitting

Export a PDF, or a PPTX, from the deck's Share menu, with the links still clickable. Name the file with the team number. The deadline is in [overview.md](overview.md#timeline).
