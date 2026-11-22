# Pitch

The Demo Day deck: its outline, what is still missing, and its look. First draft on Saturday 21 November, at about 18:30, with 14 slides. Every slide has speaker notes. Square brackets on a slide mark what is not known yet.

## Where the deck lives

The deck is a Slides artifact on claude.ai, in Alex's account: <https://claude.ai/artifact/8wp2T9NU3zjWqdy6uV5gMm>. It is private until Alex shares it, so ask Alex for access. It exports to PPTX or PDF, which the submission needs.

This file is the outline, so anyone can read and change the story without the tool. When a slide changes, change its line here in the same change.

The dates for the first deck, the finished deck and the submission are in [overview.md](overview.md#timeline). The pitch role is in [work-split.md](work-split.md#role-4-evidence-then-pitch).

## The story

The problem in Lysk's words. Then our answer in one sentence, the demo, and Lysk's three tests. Then why a marker can be trusted, what is ours on top, the numbers, and what comes next.

The one sentence: speak, and a marker with your call sign moves on a shared map; if the report could mean two places, it asks.

## Slides

| # | Slide | What it says | From |
|---|---|---|---|
| 1 | Cover | "Voice-to-Map. Say where you are. The map moves." A stylised map with a unit, its trail and its accuracy ring. | |
| 2 | The problem | Lysk's sentences as a radio log ("I'm behind the church", "South of the church", "I moved towards 35th street"). By hand, slow and error-prone: "the church" can be two churches, and a wrong marker looks right. Lysk's ask. | [overview.md](overview.md#the-challenge) |
| 3 | One sentence | The one sentence, and four numbers: 1 to 3 s from speech to marker, 0 coordinates written by the model, 0 reads of the phone's GPS, 3 languages. | [overview.md](overview.md#our-approach) |
| 4 | Live demo | The amber slide we switch away from. Six lines from the README demo script plus one track, each with what the command post shows. | [README](../README.md#demo-script) |
| 5 | Lysk's three tests | It works live: met. Natural phrasing: met. Marker, path, history: built, not yet met. | [overview.md](overview.md#the-challenge) |
| 6 | How it works | Voice, speech to text, intent, resolver, command post. The AI reads the words; plain code finds the place. The model never writes a coordinate. | [architecture.md](architecture.md) |
| 7 | Asking back | The phone's question with its choices and distances (screenshot). A silently wrong marker is worse than a question. The operator can answer for a unit [178]. | [tracks.md](tracks.md#on-the-phone) |
| 8 | Tracks | What a unit sees becomes a numbered APP-6 symbol: who saw it, when, ± metres. Hostile only when the speaker says so. The command post with six tracks (screenshot). | [tracks.md](tracks.md) |
| 9 | Coordinating the net | In progress. Who spoke: call signs from the words, against a roster. The operator answers for the unit. Answers by voice, confirmed by the operator. | [ask-back.md](ask-back.md) |
| 10 | Built for the field | No GPS, uplink off, three languages, European models. Any area in one command: Vincennes, central Kyiv, Izium. | [overview.md](overview.md#our-approach) |
| 11 | Evidence | 119 test reports, three rounds: 89% passed on hosted Mistral Small, 2 wrong markers in 357, 0.8 s median. The offline model's line below. | [evals/README.md](../evals/README.md#scores) |
| 12 | Next | Call an effector onto a track (placeholder), real radio audio, a country-sized gazetteer, into the unit's own map. | [gazetteer.md](gazetteer.md#scaling-the-gazetteer) |
| 13 | Close | The one line again, links to the live site, the code and the video, the team, and what we had before the event. | |
| 14 | Appendix | Questions we expect: OpenStreetMap wrong, why no GPS, what leaves the device, scale, the cost of a wrong marker. Not presented. | [known-gaps.md](known-gaps.md) |

## To fill in

| What | Slides | Where it comes from |
|---|---|---|
| Team number and names | 1, 13 | The organisers give the number; the submitted file is named with it. |
| Pitch length | all | The organisers. 14 slides is long for 3 minutes; cut 9 to 11 first. |
| Demo area | 4 | [Team question 3](open-questions.md#for-the-team) |
| The final demo script, and who holds which phone | 4 | Role 4, at the 18:00 run-through |
| Seconds from speech to marker on a real phone | 3, 5 | Role 4's timings. The 1 to 3 s today is hosted mode. |
| "Built" becomes "Met" for marker, path and history | 5 | A mission with three real phones and a projector |
| Who is asked back | 7 | Since the phone became a radio [208], a question goes to the operator, not the phone. The slide still shows the phone's question: swap in the command post's Decisions list, with a question open [236], and say the operator is asked. |
| Each coordination card: built, or cut | 9 | At the freeze. Merged: answering from the command post [178], call signs from the words against a roster [200], and the Unassigned tray [203]. Spoken answers are measured, not built [199]: swap that card for the tray unless they land. |
| The eval, run again; the field-walk error in metres | 11 | `npm run eval:extract -- --resolve --repeat 3` on both models; the field walk |
| The effector line | 12 | What we show by Sunday. Tracks are for reconnaissance only [234, which replaces 145]: a person at the command post may send a friendly drone to look at a track, at a unit's request or not, and nothing more. The line, and the tracks slide's wording, change only with a decision that changes 234. |
| Video link | 13 | The backup video, recorded after the freeze |
| Questions the mentors and the jury asked | 14 | Whoever sits in on those talks |

## The look

- Dark slides like the command post, light slides like paper, so the screenshots sit at home.
- Amber means a question or a signal; blue means a friendly unit, as on the command post.
- Headings in Oswald, text in Inter, spoken lines and call signs in JetBrains Mono. All three have Cyrillic, and all three travel in a PPTX file.
- Colours: ink `#12181D`, panel `#1D272F`, paper `#EEEBE3`, card `#E1DCD0`, amber `#F2B33D`, dark amber for text on paper `#8A5600`, blue `#5B97F2`, dark blue for text on paper `#2557A8`.
- Screenshots come from [docs/images/tracks/](images/tracks/). Retake them there when the screen changes, then put them in the deck again.

## Submitting

Export a PDF, or a PPTX, from the deck's Share menu, with the links still clickable. Name the file with the team number. The deadline is in [overview.md](overview.md#timeline).
