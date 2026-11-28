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

## 2026-11-21, tune: two-places [mistral:mistral-small-latest, checked on ollama:ministral-3:3b]

- Baseline: prompt `a6871d1ee3`, 75 cases. Hosted 199 of 225, 7 wrong pins (a-two-places-5, -9, -10). Local 156 of 225, 15 wrong pins (a-two-places-2, -4, -5, -9, -10).
- Diagnosis. Three structural problems, not one weak line: the relation list gave "au" as at while "je vais au" is going (a-5); the crossing rule taught "passing X" as being at X (a-9); the prompt allows Russian but listed no Russian movement words (a-10). The rule itself was one sentence with no example. "Pharmacy" and "park" written as names belong to the landmark_name rule and were left for another cycle.
- Change (prompt `5f066fb66b`): "je vais à / au" and "иду к" as movement words; "к" as towards, and "à, au, в, у after a verb of going are towards, not at"; the two-places rule rewritten (either order, any language, a place left or passed is never the landmark, a WRONG/RIGHT pair, "was at X, now at Y" is Y), with examples on places in no gazetteer (bakery, post office, market). A first version made "Passing the next intersection, heading west" (s-i8) a movement 2 rounds in 3; one more line says a crossing with no destination keeps the crossing rule.
- After: hosted 209 of 225, 0 wrong pins, no regression, p-two-places and fr-leaving now pass; median 0.72 s against 0.69 s. Local 156 of 225, 9 wrong pins; regressions p-blocks and fr-hdv (new wrong pins: "Bérault", an example name, written for reports that never said it) and t-trucks (heading lost). Median 2.6 s, unchanged.
- Accepted by Alex with the local regressions ("We need to keep tuning, but commit what we have so far"). Baselines saved from the two runs above (`eval:baseline`).
- Next: the Bérault leak on the 3B model (example names), then landmark_name for generic words.

## 2026-11-21, tune: side-word [mistral:mistral-small-latest, checked on ollama:ministral-3:3b]

- Seen live, mission `vincennes-16`, 10:50: "Friendly at Vincennes Metro." moved ALPHA 1 to the station. "Hostile 500 meters north." was a track, as it should be.
- Diagnosis: rule missing. The track rule listed things ("people, a vehicle, a tank...") and never a side word alone. The model read "friendly" with no noun as the speaker. Code asks back on a hostile or suspect word read as the speaker, but not on a friendly one [147], so the unit moved.
- Cases: 10 reports, each with a start position: friendly, friendlies, hostile, enemy, ami, ennemis, ворог and свої with no unit word, in English, French and Ukrainian, and one control, "This is a friendly unit, we're at the town hall.", which is the speaker. A second reading by a fresh agent agreed on every scored field after one change: the first control ("I'm at the town hall with friendlies") could be read either way, so it was replaced.
- Before (prompt `5f066fb66b`): hosted, the subject right in 12 of 30 results; local, 3 of 10.
- Tries. With the rule and no example: hosted 23 of 30; "Friendly at Vincennes Metro.", "Friendly at the town hall." and "Свої в парку." stayed the speaker. An example on a place in no gazetteer ("Friendly at Elmfield metro") fixed them, but the control became a track; a clause on "I", "we", "us" and "me" fixed it, placed before the side words. That version ("when the speaker says where they themselves are") cost the Russian two-place report `a-two-places-10`: right 10 times in 10 on the old prompt, 3 in 10 on the new, read as a position at the Golden Gate. The clause now says it decides only the track and every other field follows the rules above: 30 in 30. A shorter version ("a side word with I or we describes the speaker") made the control a track 3 rounds in 3, and was dropped.
- After (prompt `4c9ef72e73`, 85 cases): hosted 237 of 255, 0 wrong pins, no regression; 208 of 225 on the old cases against 209, within noise (`uk-pharmacy` and `a-two-places-9` 2 of 3). The new cases 29 of 30: `t-side-ennemis-cimetiere` writes "cimetière" as a name once. `s-v2` ("Now I'm at the château de Vincennes.") gives category "castle" 2 times in 30 against 0 on the old prompt; it asks back either way.
- Local: 174 of 255, 12 wrong pins. On the old cases 159 of 225 against 156 and 9 wrong pins either way: `p-blocks` is fixed, `a-two-places-2` is new ("From Bérault metro, moving towards the town hall." read as going to Bérault, as in the example "Moving towards Bérault"). `p-two-places` and `e-berault` lose their category (no pin); `s-k5`, `p-blocks` and `t-trucks` now pass. On the new cases 15 of 30: the subject right in 7 of 10; `t-side-ami-mairie` and `t-side-svoi-park` stay the speaker, the control becomes a track, and `t-side-friendlies-castle` writes "castle de Vincennes" and pins the track at the metro station of that name. Median 2.3 s against 2.6 s.
- Accepted by Alex with the local regressions ("Keep it", and for this final wording "Keep and commit"). Baselines saved from the two runs above (`eval:baseline`).
- The eval does not see whose marker moved: a wrong pin compares places only, so the live bug, read as the speaker at the right station, shows only in the `subject` field.
- Next: unchanged. The example names on the 3B model come first; `a-two-places-2` is the same leak.

## 2026-11-21, attack: track heading [ollama:ministral-3:3b, mistral:mistral-small-latest]

- Seen live, mission `vincennes-21`, on a coordinator in offline mode: "Hostile drone, 1 km east, heading north." lost "east" and asked how far; "Hostile drone one kilometer east, moving north." swapped the two and pinned the drone 1 km north; "Hostel drone 1 km east" got "east" as its heading too.
- Cases: 8 reports with a distance, where the thing is and the way it is going, in English, French and Ukrainian (`a-compass-1` to `a-compass-8`, tag `compass`). A second reading by a fresh agent agreed on distance, direction and heading for all; it found "of me" and "of us" made the subject unclear, so those were reworded without them.
- Hosted: 24 of 24 in 3 rounds. The rule holds.
- Local: 6 of 24, the same in every round. Swapped in `a-compass-5`, `-7` and `-8`; "east" dropped in `-1`; south and west merged into south-west in `-3`; north-east taken as where it is in `-4`. `-2` and `-6` pass.
- No prompt change. Code now checks the compass words of a track report against the words [186], so these misreadings no longer move the pin or draw a wrong arrow. The eval cannot show that: the outcome of a dead-reckoned track is only "resolved".
- Next: `prompt-tune` on the 3B model for two compass words, if the team wants the fields right and not only the pin.

## 2026-11-21, cases: contact and blocks [ollama:ministral-3:3b]

- Rule: none in the prompt. A contact is a track whatever the model reads [180], and blocks are counted in code with no distance from the model [184], [51]. Before: no case said "contact", and the one case with blocks (`p-blocks`) has no compass word, so neither was scored.
- 17 cases, each with a start (`from`) so a misreading can pin. 12 for blocks (`b-*`): English, French and Ukrainian; both counts agree; they differ (asks); counted from a crossing street; "a few blocks" (asks); a distance said wins; a house number is not a count. 5 for contact (`c-*`): a track behind the castle, at the town hall, by the Golden Gate; "lost contact with" and "in contact with the base" are about the speaker. Outcomes from the resolver (`eval:outcomes`). A second, independent reading of the expected fields agreed.
- Local 3B, 3 rounds, prompt `4c9ef72e73`: 27 of 51, outcomes 43 of 48, 0 wrong pins, 0 flaky. `distance_m` stayed null for "two blocks" in every round: the model does not turn a count into metres. Median 10.1 s on a loaded machine; a few rounds hit the 25 s limit.
- Hold every round: `b-moved-east`, `b-east-of-street`, `b-from-crossing-street`, `b-fr-moved`, `b-uk-moved`, `b-few`, `b-distance-said`, `b-address`, `c-uk-gate`.
- Weak without harm: "Unknown contact, two blocks east." in all three languages reads as the speaker moving towards; the code makes it a track [180] and the outcome passes. `b-counts-differ` reads as a movement; it asks either way. `c-fr-mairie` and `c-base` write "mairie" as a name; they ask either way. `c-behind-castle` writes "castle de Vincennes", the example leak, and asks back where the track should be placed.
- Miss: `c-lost` ("Lost contact with BRAVO 2. I'm at Bérault.") reads as a track every round, so the speaker is not placed. The code does not count "lost contact" as a contact, but it does not undo the model's track. A question, not a wrong pin.
- Hosted not run: this worktree has no key. Not in the baselines yet.
- Next: prompt-tune for contact, with these cases: "contact" read as the speaker, and "lost contact" read as a track. The example names on the 3B model, as before.

## 2026-11-21, tune: compass-only [ollama:ministral-3:3b, checked on mistral:mistral-small-latest]

- Seen in the tracks script (step 11), offline: "Enemy vehicle to the east." came back as the speaker moving east (`kind` movement, `relation` towards, `track` null), 4 times in 4 through the coordinator, so the hostile word asked "Is that where you are, or something you see?" [147]. On the prompt before the side-word tune (`5f066fb66b`) it was a track 4 times in 4. Hosted read it right on both.
- Diagnosis: rule missing. The track rule covers a thing measured from the speaker only with a distance ("300 metres north of me"). With no distance, the 3B model takes the compass word as a movement and the report as the speaker's. "Enemy patrol to the south-west." did the same; French, Ukrainian and "Hostile drone to the north." held.
- Cases: 8, tag `compass-only`: the step itself (`s-t11`, tag `scenario`), four forms (patrol, unknown truck, French, Ukrainian), one with a way and a heading ("Two trucks to the north, moving west."), and two controls where the speaker moves ("Moving to the east.", «Je vais vers l'est.»). A second reading by a fresh agent with only the prompt agreed on every scored field; it called `relation` null its least sure.
- Tries, all one sentence. In the track rule: the subject right everywhere, but the Russian two-place report `a-two-places-10` became a wrong pin offline 3 times in 3, shorter and without the Cyrillic example too. In the direction rule: offline held, hosted `a-two-places-9` and `-10` fell to 4 of 10 (7 and 9 of 10 on the old prompt). In the `track.heading` rule, with the French example: hosted `a-two-places-9` 7 of 20 (15 of 20 on the old prompt). Kept: the `track.heading` rule ending 'It is not where the thing is from the speaker: "a patrol to the north" is direction "north", heading null, and still a track.' Without "heading null" it broke `s-v3` offline; adding "with or without a distance" did not help `a-compass-6`.
- After (prompt `300d5e0a2d`, 119 cases with `e-vincent-station` and the 25 compass, contact and blocks cases, 3 rounds). Offline 237 of 357, 9 wrong pins (`a-two-places-2`, `-4`, `t-side-friendlies-castle`), median 3.4 s on a shared GPU. On the 85 older cases 180 of 255 against 174 and 9 wrong pins against 12; `fr-hdv`, `p-two-places` and `t-side-ami-mairie` now pass; `t-trucks` loses its heading. The 8 new cases: 6 right against 4; `t-compass-truck` stays a movement (the app still asks "How far west"), `t-compass-heading` loses the north. `a-compass-*` 6 of 24, as before; contact and blocks 30 of 51 against 27.
- Hosted 319 of 357, 2 wrong pins (`a-two-places-10`), median 0.8 s; 6 results refused by the rate limit (429) after the retries [191]. The 8 new cases 24 of 24 (21 before: the heading case was read as a movement). Costs, in 10 to 20 extra rounds on each prompt: `a-compass-6` ("Hostel drone 1 km east") right 1 in 10 against 7 in 10, the distance lost and "east" taken as the heading, so it asks; `uk-pharmacy` «біля» as at, 14 of 26 against 18 of 23; `a-two-places-10` 17 of 26 against 33 of 43, within noise.
- Three rounds miss rare hosted flakes: `a-two-places-10` was 3 of 3 in the side-word baseline but pins 1 to 6 times in 20 on that same prompt.
- Accepted by Alex with the costs ("Keep it"; on the hosted cost: "Forget hosted mode"). Baselines saved from the two runs above (`eval:baseline`), so they now hold all 119 cases [187].
- Next: `a-compass-6` on hosted, if hosted matters again; a thing with both a way and a heading (`t-compass-heading`) on the 3B model; the example names, as before.

## 2026-11-22, finding: offline prompt cut by Ollama [ollama:ministral-3:3b]

- Seen in `.run/launcher.log` on 22 Nov: `truncating input prompt limit=2051 prompt=4556 keep=5 new=2051` for the warm-up and every report. The launcher started Ollama at 4,096 tokens; the extraction prompt is 4,556. Ollama kept the first 5 tokens and the last 2,046, so the model never saw the place or the first rules [254].
- Not a prompt change: same prompt `300d5e0a2d`, full corpus, `--resolve --repeat 3`, on a private Ollama.
- At 4,096 (the cut prompt, `results/ollama_ministral-3_3b-2026-11-22-11-12-cut-at-4096.jsonl`): 174 of 357 (49%), outcomes 339 of 357, 6 wrong pins (`a-two-places-5` and `-9` new), median 3.7 s. Worst tags: two-places 6 of 30, adversarial 24 of 105, compass-only 3 of 21, track 33 of 129.
- With `num_ctx` 8,192 on every call (`results/ollama_ministral-3_3b-2026-11-22-11-31.jsonl`): 237 of 357 (66%), outcomes 333 of 357, 9 wrong pins, median 2.5 s. The same as the baseline, case by case. Replies: 345 of 372, no regression.
- So the baselines were taken on the whole prompt (their median, 3.4 s, is too fast for a cut prompt), and the prompt has been over 4,095 tokens since `2fc3bd9` (21 Nov 11:05). Anything seen live through an Ollama started at 4,096, with `docs/setup.md` from 21 Nov 11:06 or the launcher from 21 Nov 19:57, was on the cut prompt: read those observations again before tuning for them.

## 2026-11-28, finding: track-sighting fusion, simulation [ghost]

- Built `lib/geo/fusion.ts`, `scripts/sim-fusion.ts` (seed 20261128) and `tests/fusion.test.ts`; report `evals/fusion-2026-11-28.md`. No app import: the resolver and the command post still place a track from one report.
- Five synthetic scenarios, 200 trials each, human sigma 2/5/10. Perpendicular bearings: CEP50 75.8 m and NEES 1.96 at 5�, with 93% inside the announced 90% circle. Nearly parallel bearings: 80 to 83% of posteriors reach the grid edge and NEES rises to 2.99-3.71 when cut. One gross outlier: 48 m of movement with epsilon 0, 0.1 m with 0.05. One observer's five reports: NEES 0.21, conservative by design.
- Not measured: real bearings, ranges, observer circles or voices; association on a live log; any map display. The 5� human sigma is an assumption.
- Next: decide with Alex whether a ghost overlay is worth building, where to show a cut-off ridge, and how to feed the observations from the mission log without changing the resolver.


## 2026-11-28, final: fusion simulation after the validity pass [ghost]

- Supersedes the earlier finding entry above. 2,000 trials per row, seed 20261128; 95% intervals on CEP and NEES (bootstrap) and on 50/90 circle coverage (Wilson). Truth and estimator are separate; matched rows set the estimator to the truth's sigma.
- Perpendicular bearings: CEP50 29.6 m at 2?, 75.4 m at 5?, 141.3 m at 10?; NEES 2.02, 1.97, 1.94. At 2/5 the intervals contain nominal; at 10 the 50 and 90 circles over-cover significantly, and 13% are unresolved.
- Nearly parallel bearings: 100% unresolved at 2, 5 and 10 degrees and under both range priors. No point estimate; the long covariance is returned only for inspection.
- Current method, 5 degrees: 8-point CEP50 283.8 m, exact single 128.5 m, fused 56.8 m; the continuous angle is the larger gain, fusion the second. The earlier "fusion halves the error" sentence was corrected in the report.
- Mismatch: truth 10 / estimator 5 gives NEES 7.97 and 46% inside the 90% circle; a 3 degree bias gives 2.81 and 82%; heavy tails 7.21 and 81%; a 20% range understatement 2.56 and 83%.
- One observer, five reports: NEES 0.35 to 0.40, deliberately conservative; the covariance area is never smaller than the same reports treated as independent (test).
- Not measured: real bearings, ranges, observer circles or voices; live association; any display. Logging proposal in the report, not built.
- Next: decide with Alex whether a ghost overlay is worth building, and whether to log the observer radius and continuous bearing first.
