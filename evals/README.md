# Extraction eval

Checks how well the model turns a transcript into an intent and, with `--resolve`, what the resolver then answers. It does not check speech-to-text. It is layer 2 of the [evaluation plan](../docs/plan.md#evaluation-harness).

```bash
npm run eval:extract                              # hosted Mistral, needs MISTRAL_API_KEY in .env.local
PROVIDER_MODE=local npm run eval:extract          # the local model through Ollama
npm run eval:extract -- --resolve --repeat 3      # the full check: outcomes, wrong pins, flaky cases
npm run eval:extract -- --area kyiv               # one area
npm run eval:extract -- --tag track,fr            # cases with any of these tags
npm run eval:extract -- --only s-k1,s-k5          # named cases
npm run eval:extract -- --cases <file>            # another cases file, such as an attack's draft
npm run eval:extract -- --save-baseline           # write evals/baselines/<model>.json from this run
npm run eval:extract -- --no-compare --no-save    # no comparison, no results file
npm run eval:outcomes                             # add outcomes to cases that have none
npm run eval:outcomes -- --check                  # check outcomes still match the resolver
npm run eval:format                               # one case per line, after editing the file
```

The script calls the same `getExtractor()` and `systemPrompt()` as the coordinator, so it scores whatever prompt and model the app would use. The language is not pinned, so the model's own label is scored after the check on the letters [104]. It is not part of `npm test`, because it needs a key or Ollama. `tests/evalCases.test.ts` checks the cases file in `npm test`, with no model: every case's expected fields must score clean and get their own outcome from the resolver.

## Cases

`extraction.cases.json` holds one case per line:

```
{ "id": "p-street", "area": "vincennes", "tags": ["paraphrase"],
  "text": "I'm on rue de Fontenay.",
  "expect": { "kind": "position", "landmark_name": "rue de Fontenay", "landmark_category": "street", "relation": "at" },
  "outcome": { "status": "resolved", "feature_id": "street/rue-de-fontenay" }, "outcome_from": "resolver",
  "from": { "feature": "node/9415191169" },
  "note": "why, when it is not obvious" }
```

- **`expect`**: only these fields are scored. Leave a field out when the prompt's rules allow more than one answer. A list means any of these: `"direction": ["west", null]`. Text is compared without case, extra spaces, end punctuation or curly apostrophes.
- **`outcome`**: what the resolver should answer, scored with `--resolve`. `status` (a list is any of these), `feature_id` for the place, `heading_to` for a movement's target. `["ambiguous", "unresolved"]` means "asks back"; the kind of question is not compared.
- **`outcome_from: "resolver"`**: the outcome was worked out by `eval:outcomes` from the case's own `expect`, so `--refresh` may rewrite it after a resolver change. Scenario cases carry the outcome from their scenario file instead.
- **`from`**: where the speaker was before, as the coordinator would know it: a gazetteer id or a crossing id, and optionally `street` and `heading_deg`. Without it the speaker has no last position.
- **`area`** picks the place given to the prompt ("Vincennes, France") and the gazetteer.
- **Tags:** `scenario` (the scenario scripts' sentences), `paraphrase`, `filler`, `fr`, `uk`, `mixed`, `stt_error`, `distance`, `other`, `track`, `trap` (built to catch one rule), `adversarial` (added by an attack, below).

A case whose words are already one of the prompt's examples is marked `[in prompt]`. Its score is shown apart, because a pass there proves little.

## Reading a run

Each failed case lists the fields that were wrong. `PIN!` marks a **wrong pin**: the answer put a pin or a heading on the map where the case wanted a question, or at another place. That is the worst miss, because the operator sees a wrong position with nothing to say it is wrong. A question where a pin was wanted is a plain miss: the speaker is asked.

The summary gives:
- cases passed, overall, held out and in prompt (with `--repeat`, one count per round);
- outcomes passed and wrong pins (with `--resolve`);
- flaky cases, which pass in some rounds and fail in others, and the fields that changed between rounds (with `--repeat`; temperature 0 is not deterministic);
- the median and 90th-percentile time;
- the share passed by field and by tag. The by-field table says which rule of the prompt to work on.

Each run prints a **prompt id**, a hash of every area's prompt and the schema. Two runs with the same id scored the same prompt.

## Baselines

`baselines/<model>.json` is the committed reference run for each model: each case's verdict by majority over its rounds, and its wrong pins. When a baseline exists, every run is compared with it and lists regressions (passed, now fails), new wrong pins, improvements, and cases the baseline does not have. The run **exits 1 on a regression**, or on a new wrong pin when both runs used `--resolve`.

Save a baseline only from a full run (`--resolve --repeat 3`, no filters), and only when a prompt change has been accepted. `prompt-tune` says when.

Runs are saved to `results/<model>-<time>.jsonl`: one header line with the prompt id and the summary, then one line per case and round with the full intent and the resolver's answer.

## Growing and tuning: the skills

Two skills, adapted from levelang's, drive the work. They live in `.agents/skills/` (Claude Code reads them through the `.claude/skills` link; Codex reads `.agents/skills`):

- **`prompt-attack <rule>`** writes 5 to 10 reports built to break one rule, has a second, independent reading check the expected answers, runs them three times, and adds the confirmed ones as `adversarial` cases. It never edits the prompt.
- **`prompt-tune <rule>`** takes the baseline, diagnoses the rule's failures, edits `systemPrompt()`, runs the full corpus on both models, refuses regressions, and records the change in `DECISIONS.md` and the journal.

Both write to [`journal.md`](journal.md): what was attacked or tuned, what was found, what was accepted as a model limit.

## Scores

Full corpus, `--resolve --repeat 3`, prompt `a6871d1ee3`, on the MacBook (M1 Pro), 21 Nov:

| Model | Case results passed | Wrong pins | Flaky cases | Median |
|---|---|---|---|---|
| Mistral Small (hosted) | 182 of 195 (93%) | 0 | 1 | 0.7 s |
| Ministral 3 3B (local) | 150 of 195 (77%) | 0 | 0 | 2.6 s |

Hosted misses, every round: "outside" read as near; two places in one report ("Leaving the church, heading to the cemetery", "Je quitte la mairie, direction le parc") kept the place being left; "Copy that, moving out" became a movement. With no start position each gets a question back. With one, two places is a wrong pin: see the attack below. "Стою біля аптеки" was flaky (near, 2 of 3).

The 3B model gave the same answer in all three rounds for every case. It fails 15 cases every time: the three above (except two places) plus names in the wrong script ("Golden Gate", "Khreshchatyk" written in Cyrillic), some Ukrainian lemmas, «за» as near, "I'm on rue de Fontenay" as a movement, and the French "char" (tank) as artillery. Its 9 outcome misses are all questions where a pin was wanted.

## Attack: two places, 21 Nov

10 `adversarial` cases (`a-two-places-1` to `-10`), each starting where the speaker says they are, as in a mission. Hosted Mistral, 3 rounds: 4 hold, 3 fail or are flaky without harm, and 3 put a **wrong pin**. "Going past the church towards the cemetery" and "Je suis devant l'église, je vais au cimetière" send the unit to the church; "Я возле Золотых ворот, иду к Майдану" places it at the Golden Gate. The local 3B model gives 5 wrong pins in 10. The rule holds when the destination comes first or the start is a named place. It breaks when the place being left has a type word of its own (church, Golden Gate) and the destination follows. Next: `prompt-tune two-places`.

## Open

- **May the model repair a misheard name?** Asked "I'm at bear oh metro.", hosted Mistral writes "Bérault", the right station, though the prompt says to copy only what was said. The case accepts both a question and Bérault. Repairing names helps with speech-to-text errors but is a guess the resolver cannot see.
- **The expected answers were written by one person (an agent) and checked only by the rules.** The Ukrainian cases need a native speaker.
- **Typed text only.** Layer 3, real voices through speech-to-text, is not started.
