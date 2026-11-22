# Asking back by voice

Today a question waits for the operator: it is a line in the command post's Decisions list, which shows its choices and answers for the unit (`POST /api/answer`, [178, 236]). The unit's next report closes it [237]; a question with no choices is asked by radio, then closed [238]. Since 21 Nov the phone no longer shows, speaks or answers questions, as a radio would not [208]; the web page still does [100]. The next step is to take the answer by voice: the unit presses talk and says "the metro", "two", "say again" or "disregard", as on a radio net.

Status, 21 November: **measured, not built.** The reply reader and its eval exist (`lib/providers/replies.ts`, `npm run eval:replies`); nothing in the request path uses them yet [199].

## What a reply can be

While a question is open, the next thing the unit says is one of these.

| Kind | Examples | What happens to the question |
|---|---|---|
| **Pick** | "two", "the metro", "the nearest one", "yes" (one choice), "I'm at the castle" when the castle is a choice | Closed; placed; the name is said back |
| **None** | "none", "neither", "no" (one choice, or "no" alone) | Closed; nothing placed; "Say it again with a street or a place." |
| **Rephrase** | "no, the one on rue de Paris", "correction, by the church", just "by the church" | Closed; read with the question's subject, so a track stays that track |
| **Repeat** | "say again", "which one is closer?" | Open; asked again, with each choice's distance |
| **Stand by** | "wait one", "stand by" | Open; not asked again; more time to answer |
| **Don't know** | "I can't tell", "not sure" | Not asked again; left for the command post |
| **Disregard** | "disregard", "cancel that" | The report is withdrawn, and a track it opened |
| **New report** | "moving north on rue X", "enemy drone east of me" | A normal report; see below |
| **Unclear** | noise, "uh", "yes" to two choices | Open; asked again |

Two more are known and not handled yet: a pick followed by a new report ("two, and moving north now"), and a correction of an answer just said back ("no, the other one"), which clashes with "the first answer stands" [100].

## Answer or new report

The rule: **a reply with no frame of its own takes the question's frame; a reply that says who or what it is about stands on its own.** Asked "Where is it?", people say "by the church", not "the enemy vehicle is by the church".

The difference only matters where the two readings draw different maps. Asked which station, "I'm at the town hall" places the speaker at the town hall either way, and the question closes as overtaken. It matters when the question is about a track and the reply is about the speaker ("I'm at the town hall"), or the other way round, and when a fragment needs the question to mean anything ("500 metres").

## Three layers

Code alone cannot list every way of saying these things ("hang on", "scratch that", "the one by the big roundabout"), and a model alone gets some of the shortest replies wrong (below). So:

1. **Code first,** for the closed forms: a number or ordinal, a word that names one choice and no other, and the radio words (say again, wait one, disregard, affirm, negative). The whole reply has to be one of these once filler words and call signs are taken out, so "two blocks east" is never choice 2. Not built yet.
2. **The reply reader for the rest:** a model call of its own, apart from the extraction prompt, that gets who the question is about, the question, the numbered choices and the reply, and returns a kind and a choice number. Code keeps the choice only if it was offered, and the place comes from the stored choice, so no model makes a coordinate.
3. **Code checks where a miss is costly:** a pick of a reply that names its own subject or a movement asks again; a disregard needs the word itself.

Behind all three, **the say-back**: a pick is always said back ("Château de Vincennes."), so the speaker can correct it.

## Measured

`evals/replies.cases.json`: 15 questions taken from the resolver (two to three choices, one-choice "Do you mean" questions, a voices question, two track questions) and 124 replies, 61 in English, 29 in French and 34 in Ukrainian with one in Russian. Each reply is tagged `fast` (code could settle it), `tail` (needs a reading) or `trap` (built to catch one mistake). A **costly** miss is one that would move a marker wrongly or drop a report: a wrong pick (`PICK!`), a track's place read as the speaker's or the other way round (`SUBJ!`), a disregard nobody said (`DROP!`). How to run it: [evals/README.md](../evals/README.md#reply-eval).

21 November, prompt `b256e0c36b`, three rounds each:

| Model | Passed | Fast | Tail | Trap | Costly | Flaky | Median |
|---|---|---|---|---|---|---|---|
| Mistral Small (hosted) | 342 of 372 (92%) | 94% | 98% | 57% | 21 (7 cases) | none | 0.4 s |
| Ministral 3 3B (local) | 345 of 372 (93%) | 100% | 93% | 64% | 15 (5 cases) | none | 3.4 s |

Hosted, every round:
- **Wrong picks on the shortest replies:** "Two." and "Deux." came back as choice 1, and "Yes", "Oui" and "Так" to a two-choice question picked the first. "Two." to a one-choice question picked that one. "Два", "the third one" and "number one" were right.
- **One swapped subject:** "Je suis à la mairie." to a question about Track 4 was read as the track's place. The English one was right.
- Plain misses: "На вулиці" as a rephrase, not the street choice; "Rue de Fontenay" (on all three crossings) as a rephrase, which would ask again; "Not sure, it's a big white building" as a rephrase.

Local, every round:
- **Every subject trap failed:** "I'm at the town hall.", "Je suis à la mairie." and "Я на Майдані." in reply to a question about a track were read as the track's place.
- **Two wrong picks:** "Rue de Fontenay." (on all three crossings) and "Так" to a two-choice question both picked the second. Every number and radio word was right, "Two." and "Deux." included.
- Plain misses: "Sam on day" as repeat; "Je suis dans la cour du château" and "Я біля входу в метро" as rephrase, not the choice they name; "Une seconde, je regarde" as repeat.

## What it shows

- **A model is the right tool for the long tail.** Hosted read 98% of the `tail` replies and local 93%; no list in code would get there.
- **Every costly miss is a form code can catch,** before or after the model: a number or a yes checked against how many choices there are; a reply whose words fit more than one choice; a reply that says "I", "je" or "я" to a question about a track. So the three layers hold.
- **Offline is as good as hosted** (93% against 92%) and slower: 3.4 s median against 0.4 s. That is the time added to a spoken answer, or the wait for a suggestion on the operator's screen. Code settles the `fast` replies at once.

## Open

- **Who asks back.** Heard third hand on 21 November: the speakers have radios, and a live operator is on the other end. If the mentors confirm it, the question goes to the operator, who asks it over the radio, and the reader at most suggests a choice on the command post for the operator to confirm. A wrong suggestion then costs a click, not a wrong marker. The command post can already answer for a unit [178], and since decision 208 the phone leaves every question to it.
- The Ukrainian and French replies were written without a native speaker, like the other cases [known gaps](known-gaps.md).
- All replies are typed; none went through speech-to-text.
- Follow-ups to the prompts that have no choices ("How far east is it?", "Where is it?") are not in the eval yet. For a track they lose the track today: "by the church" in reply to "Where is it?" is read as a new report about the speaker (from reading the code, not run).
