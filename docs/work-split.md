# Work split: a proposal

Five streams of work for four people, written on Saturday 21 November at 02:00 for the 08:00 kickoff. It is a proposal to agree on together, not a decision: nobody is assigned here. People pick a stream; the table only says what each stream holds and what it needs.

It replaces the "Suggested split for four" that was in the design document on Friday. Two things changed since then: the receiver and missions are built, and the pitch is now a stream of its own.

## The dates that shape it

Times are Paris.

| When | What | Source |
|---|---|---|
| Sat 08:00 | Kickoff with the two new teammates. Alex starts looking for Lysk's mentors. | [kickoff.md](kickoff.md) |
| Sat 18:00 | **Presentable:** a timed 3-minute run-through of the live demo, and a first deck. Our own target. | below |
| Sat evening, Sun morning | Pre-selection: the organisers pick the teams that pitch on Demo Day. 39 teams are registered. | Organisers' email, 20 Nov: "exact time and details coming soon" |
| Sat 22:00 | Feature freeze | [overview.md](overview.md#timeline) |
| Sun 00:00 | The earliest a pitch decision is made, as a later notice says (Alex, 20 Nov: "12am Sunday"). We read that as midnight; check the notice. | Notice, via Alex |
| Sun 10:00, 11:00, 11:30 | Video done, deck done, submit. The deadline is 12:00. | [overview.md](overview.md#timeline) |
| Sun 13:00 to 16:00 | Demo Day | Event page |

So we must look finished on Saturday evening, not on Sunday morning. Someone may ask to see it at any time from then on.

## The streams

| Stream | What is left | Needs | Size |
|---|---|---|---|
| 1. Receiver and missions | Run it with two or three real phones and a projector. Act on the review's decisions ([receiver-review.md](receiver-review.md)). A hosted store, if we want the live site to keep reports. | Any setup. Phones for the run. | Half a day |
| 2. Transmitter and audio in | The Android microphone ([handoff](handoff-android-microphone.md)). Speed on a real phone. Then whatever the mentors' answer on hardware calls for: call sign from the words, radio-style audio, an open microphone. Stress scenarios played from a laptop. | A Mac with Xcode for iOS; the Android phone | A day, more if the answer is "radio" |
| 3. Local mode | The demo with the uplink off, which is mandatory: a network with no internet, HTTPS or the native app over plain HTTP, the offline map, speech-to-text off the network ([plan](plan.md#local-mode)). | A Mac to serve from; a router or hotspot | 1.5 to 2 person-days; two people can split network and map |
| 4. Evaluation and evidence | Text cases with expected answers, our own voice clips, the wrong-pin rate, the local-against-hosted timings, a field walk for an error in metres ([plan](plan.md#evaluation-harness)). | Any setup; runs headless | A day |
| 5. Pitch and presentation | The story, the deck, the video, the demo script and its rehearsals, the talks with mentors, the submission. | No code needed | From Saturday midday to Sunday noon |

Streams 1, 3 and 4 are TypeScript in the Next.js app and run headless with `npm test`, so they suit any setup, including Codex. Stream 2 needs a Mac with Xcode for iOS builds.

## Stream 5: pitch and presentation

Why give it a person. Pre-selection decides who pitches at all, and it starts while we are still building. Nine teams took this challenge. The jury is military representatives, mentors and partner companies, in person, and it counts only what was built during the event. A good build shown badly at 23:00 on Saturday does not get to Sunday.

What that person owns:

- **The story.** The problem in Lysk's words, then the three judged items, then what is ours on top: asking back, no invented coordinates, no GPS, working with the uplink off, Ukrainian.
- **The demo script,** three minutes, with who holds which phone and who runs the receiver. And its fallbacks: typed reports if the hall is too loud, a recorded video if the network fails. Live and recorded demos are both accepted.
- **Rehearsals.** One timed run-through at 18:00 on Saturday with the whole team, one after the freeze.
- **The mentors.** Sitting in when Alex talks to them, writing the answers down ([open-questions.md](open-questions.md#for-lysk)), and booking the afternoon showing.
- **The evidence slide,** from stream 4: seconds from speech to marker, the wrong-pin rate, the offline run, the error in metres.
- **Prior work, stated plainly.** The organisers ask every team to say what it had before the event. The tag `prior-work-fri-1800` marks it; `git log prior-work-fri-1800..main` lists what was built here.
- **What comes next.** The organisers' stated goal is deployment. One slide: a country-sized gazetteer ([gazetteer.md](gazetteer.md#scaling-the-gazetteer)), real radio audio, a feed into the map system a unit already has.
- **The submission.** A PDF or PPTX with clickable links, the file named with the team number, sent by 11:30 on Sunday. No handouts.
- **The questions the jury will ask,** with a short answer each: what if OpenStreetMap is wrong, why no GPS, how it scales, what leaves the device, which providers, what a wrong marker costs. Most answers are already in [known-gaps.md](known-gaps.md) and [gazetteer.md](gazetteer.md).

Its day:

| When | What |
|---|---|
| Sat morning | With Alex and the mentors. Draft the story in ten lines. |
| Sat 14:00 | Demo script, first version. Deck outline, six slides. |
| Sat afternoon | Show the mentors a working version. Collect screenshots and the first numbers. |
| Sat 18:00 | Timed run-through with the team. This is "presentable". |
| Sat 22:00 | Freeze. Record the backup video straight after, so Sunday is editing only. |
| Sun 10:00 to 11:30 | Video, deck, submit. |

## Five streams, four people

Two streams have to share a person. Three ways to do it:

| Option | How | Cost |
|---|---|---|
| A. Evidence and pitch together | One person runs stream 4 in the morning and moves to stream 5 from midday. The numbers are the pitch's content, so nothing is handed over. | The evaluation harness stays small. |
| B. A full-time pitch person from 08:00 | Streams 1 and 2 share a person: the receiver is mostly done. | One fewer builder all day. Local mode has no slack. |
| C. Alex pitches | Alex hands the receiver to someone else and keeps the mentors and the pitch. | The person who knows the code best stops building at midday. |

Suggested: A. It keeps four builders in the morning, when local mode is at its riskiest, and has one named person on the pitch from midday.

## What moves it

- **The mentors' answer on hardware** ([question 1](open-questions.md#if-there-are-two-minutes)). If reports come over a shared radio net, stream 2 becomes "radio audio in": the call sign from the words, noise, an open microphone. The receiver then has to let the operator answer a question. That is worth a second person on stream 2, taken from stream 1.
- **Local mode running late.** It is mandatory. If the network and HTTPS are not proven by 13:00, a second person joins it.
- **Their answer on the test area.** A new area is one command; a new demo script is an hour for stream 5.
