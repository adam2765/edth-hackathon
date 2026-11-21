# Extraction prompt journal

What each attack or tune of the intent-extraction prompt found, newest last. `prompt-attack` and `prompt-tune` append here (see [README.md](README.md)). Decisions about the prompt go in `DECISIONS.md` as well; this file keeps the working detail: what was tried, what failed, what was accepted as a model limit.

Entry heading: `## YYYY-MM-DD, attack|tune|baseline: <rule> [<extractor>]`.

## 2026-11-21, baseline: whole corpus [mistral:mistral-small-latest, ollama:ministral-3:3b]

- 65 cases: the 18 scenario sentences and 47 written for this eval. Outcomes for the 47 come from the resolver on each case's expected intent; with no start position most of them ask back.
- Prompt `a6871d1ee3`. Mistral Small: 182 of 195 case results, no wrong pins, median 0.7 s. Ministral 3 3B: 150 of 195, no wrong pins, no flaky case, median 2.6 s; 15 cases fail every round (names in Cyrillic, Ukrainian lemmas, «за», "on rue de Fontenay" as a movement, "char" as artillery).
- Mistral fails every round on: "outside" (near, not in_front_of); two places in one report (keeps the place being left, decision rule "report the one they are going to"); "Copy that, moving out" (movement, not other). All three ask back, so no wrong pin.
- Mistral repairs "bear oh metro" to "Bérault". Not accepted or refused yet: see README, Open.
- Not attacked yet: every rule. Suggested order, by risk: two places, relation ("outside", «за»), crossing with a heading, Ukrainian lemmas on the 3B model, tracks (7 cases only).

## 2026-11-21, attack: two-places [mistral:mistral-small-latest]

- Rule: two places, one where the speaker is and one where they are going, give the one they are going to, as a movement. Before: 2 cases, both "leaving X, heading to Y", both asking back for lack of a start position.
- 10 reports, each with a start position (`from`) at the place the speaker names, so a misreading can pin. Second reading by a fresh agent with only the prompt: agreed on every scored field but one. It found the prompt lists "au" under at while the movement rule says towards, so the relation of a-two-places-5 is not scored.
- Hosted, 3 rounds. Wrong pins: a-two-places-9 (3 of 3, the church), a-two-places-10 (3 of 3, the Golden Gate, all Russian), a-two-places-5 (2 of 3, the church). Weak without harm: a-two-places-4 ("pharmacy" written as a name, 3 of 3), a-two-places-3 (same, 2 of 3), a-two-places-8 ("was at the park, now at the town hall" as a movement, 1 of 3). Hold: 1, 2, 6, 7.
- Local 3B, 1 round: 5 wrong pins in 10 (2, 4, 5, 9, 10). It also fails 1, 3 and 8.
- Pattern: the rule holds when the destination comes first or the start is a bare name; it breaks when the place being left carries a type word and the destination follows. No example in the prompt shows two places.
- Added a-two-places-1 to -10. Not in the baselines yet. Existing p-two-places and fr-leaving have no start, so they cannot show a wrong pin; adding one is a change to their expectations, left for the person.
- Next: prompt-tune two-places. Also for the tune: the "au" conflict between the relation list and the movement rule.
