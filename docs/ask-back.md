# Asking back by voice

Today a question waits for the operator: it is a line in the command post's Decisions list, which shows its choices and answers for the unit (`POST /api/answer`, [178, 240]). The unit's next report closes it [241]; a question with no choices is asked by radio, then closed [242]. Since 21 Nov the phone no longer shows, speaks or answers questions, as a radio would not [208]; the web page still does [100]. Since 22 Nov a short spoken answer is heard: the unit says "two" or "the metro station", and the command post shows that choice already picked, for the operator to confirm [245].

Status, 22 November: **the code layer is built; the model layer is measured, not built.** A short answer that picks one choice is read in code (`lib/geo/replies.ts`) and waits for the operator's confirm ([below](#built-the-code-reader)). The model reply reader and its eval exist (`lib/providers/replies.ts`, `npm run eval:replies`); nothing in the request path uses them yet [199]. The other kinds of reply ("say again", "disregard", "by the church") are still read as a report.

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

1. **Code first,** for the closed forms: a number or ordinal, a word that names one choice and no other, and the radio words (say again, wait one, disregard, affirm, negative). The whole reply has to be one of these once filler words and call signs are taken out, so "two blocks east" is never choice 2. Built on 22 Nov for picks only [245]; the radio words are not read yet.
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

## Built: the code reader

Since 22 November [245]. While a unit's question with choices is open, a radio report from that unit is checked in code before anything else (`readPick` in `lib/geo/replies.ts`). It is an answer when every word is one of these, or a filler:

| Form | Examples |
|---|---|
| A number or an ordinal | "two", "2", "number one", "the second one", "numéro deux", "le premier", "другий", "the last one" |
| Words that name one choice and no other: part of its name, its town, or its kind | "the metro station", "le château", "Saint-Mandé", "Montreuil", "на вулиці" |
| The nearer or the farther one, when one choice is nearer by 50 m and a fifth | "the closer one", "la plus proche", "та, що ближче" |
| Yes, to a single choice | "yes", "affirm", "oui", "так точно" |

Anything else is read as a report, as before: "two blocks east", "two enemy vehicles", "not the castle", "the castle, moving north". A reply that says who it is about ("I'm at the castle", "je suis…", "я біля…") stands on its own and is never read here. A word that is in every choice's name tells nothing: "Rue de Fontenay", when all three crossings are on it, and "Château de Vincennes", when both choices have that name. Nor does the kind they all are, said alone: "Лікарня", when every choice is one. "One second" is a wait, not the second choice, and "les deux" is both.

An answer heard is not a report. It is a `reply` line in the log, it moves nothing, and the question stays open. The Decisions list shows the words and the choice already picked, with "BRAVO 2 said “the metro station”. Choose 1, Château de Vincennes (metro station)?". Enter confirms, as an ordinary answer by the command post; Escape steps back, and the choice is not picked again by itself. No model reads the words, so nothing is added to the wait: in one offline check the answer took 3 ms, where the report before it took 12 s.

Measured on the reply eval's 124 cases, in `tests/replyPick.test.ts`, so `npm test` keeps it:

| What | Result |
|---|---|
| Picks tagged `fast` | 33 of 33 |
| Other picks (`tail`, `trap`) | 14 of 25 |
| Wrong picks | none |
| Read into the 66 replies that are not picks | none |

The reader was written with these cases in view, so the first two rows say what it covers, not how it does on words it has not seen.

For that, an agent that had not seen the reader wrote 80 more replies from the rule alone, 50 of them to make it pick wrongly (`evals/replies.heldout.cases.json`, 22 Nov). On the first run:

| What | Result |
|---|---|
| Clear picks | 24 of 29 right, 5 read as nothing, none wrong |
| Replies that are not picks | 41 of 44 read as nothing, **3 picked wrongly** |
| Ambiguous, by the writer's own mark | 7: no pick of the other choice |

The three wrong picks: "Les deux." (both) read as choice 2; "Лікарня." read as the one choice with that word in its name, though it is the question's own word; "У парку." (a park) read as Парковий міст. All three are fixed, with four of the five misses ("à vous" and «приём» for over, "la seconde", "le 2ème"), and the 80 cases now run in `npm test` as a guard. So they are no longer unseen: the honest number for unseen words is the first run's, 3 wrong picks in 44 replies built to cause one.

A second round followed the same day, by another agent that had seen neither the reader nor the first round (`evals/replies.heldout2.cases.json`): 110 replies, 57 of them on ten questions of its own, with choices the reader had never met (two schools named by number, a bell tower of the Near Caves and one of the Far Caves, a street in two towns). Seven of its replies came out the same as in round one. On the first run, with round one's fixes in:

| What | Result |
|---|---|
| Clear picks | 31 of 39 right, 8 read as nothing, none wrong |
| Replies that are not picks | 56 of 61 read as nothing, **5 picked wrongly** |
| Ambiguous, by the writer's own mark | 10: **1 picked the other choice** |

The six wrong picks: «Да нет.» (Russian for no) read as yes; "Yes, the impasse." read as yes to Rue des Quatre Ruelles, though it names another street; "Au 2, avenue de la République." read as choice 2, from a house number; «ближня» read as the nearer choice, though the other one is named Ближніх печер; «перша» and «перша гімназія» read as the first in the list, though Гімназія №1 is the third. Five of the six were on the new questions. All six are fixed, and the 110 run in `npm test`.

What the two rounds say:

- **A plain answer is read right or not at all.** Of 68 clear picks, 55 were read right, 13 as nothing, none wrongly.
- **An odd reply is sometimes read as a pick:** 8 of 105 replies built to cause that, 7% in the first round and 8% in the second. The first round's fixes did not bring the second round's rate down, so a third round would most likely find more.
- **It is a suggestion, and has to stay one.** A wrong pick shows a wrong choice already picked, with the unit's words beside it. The operator's confirm is the check, which is one more reason not to build choosing without it.

Not built: choosing without the operator's confirm. A mentor called that an optional switch (22 Nov), and Alex left it out. Not read here: the radio words (say again, wait one, disregard), "none", a correction, and every reply that needs a reading ("the one by the big roundabout"). A phone that names its call sign, and a held report the operator gives to a unit, are read as reports as before.

## Open

- **Who asks back: settled.** A Lysk mentor confirmed on 22 November that the operator asks back over the radio, that a clarification should then be taken in automatically, and that the operator confirms every entry. So the reader suggests and the operator confirms: a wrong suggestion costs a click, not a wrong marker.
- The Ukrainian and French replies were written without a native speaker, like the other cases [known gaps](known-gaps.md).
- All replies are typed; none went through speech-to-text.
- Follow-ups to the prompts that have no choices ("How far east is it?", "Where is it?") are not in the eval yet. For a track they lose the track today: "by the church" in reply to "Where is it?" is read as a new report about the speaker (from reading the code, not run).
