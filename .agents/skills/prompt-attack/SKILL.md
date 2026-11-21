---
name: prompt-attack
description: Find weaknesses in the intent-extraction prompt by writing reports built to break one of its rules, and add the confirmed failures to the eval corpus as permanent cases. Use when asked to attack, probe, stress-test or harden the extraction prompt, find what the eval misses, or grow the eval corpus.
argument-hint: <rule> [--model hosted|local] [--area vincennes|kyiv|izium]
---

# Prompt attack

Adapted from levelang's `prompt-attack` and `quality-probe`. One session attacks **one rule** of the prompt with 5 to 10 reports, sorts what came back, and turns the real failures into cases in `evals/extraction.cases.json`. It never edits the prompt: that is `prompt-tune`.

Our answers are exact fields, so no LLM judge is needed. The risk is the other way round: a case whose expected answer is wrong. Every new case therefore needs two independent readings of the rules that agree (Phase 3).

## Inputs

- `<rule>`: one rule of `systemPrompt()` in `lib/providers/extractor.ts`, named by its field or topic: `relation`, `kind`, `landmark_name`, `lemma`, `category`, `distance`, `direction`, `two-places`, `crossing`, `from-here`, `language`, `track`, `track-kind`, `other`. If none is given, pick the weakest field or tag in the latest saved run (`evals/results/`), or a rule with no cases, and say which.
- `--model`: `hosted` (Mistral, the default, needs `MISTRAL_API_KEY`) or `local` (`PROVIDER_MODE=local`, Ollama). Attack the model the person names; the prompt is shared, so note anything that looks model-specific.
- `--area`: defaults to the area the rule is most at risk in. Kyiv and Izium for Ukrainian inflection, Vincennes for French.

## Phase 1: Read

Read only what this rule needs:

1. The rule's lines in `systemPrompt()` and the examples that touch it.
2. The existing cases for it: `grep` the cases file for the field name or tag. Note which forms of the rule have no case.
3. `evals/journal.md`: what earlier attacks on this rule found and what was accepted as a model limit.
4. The latest saved run for the model in `evals/results/` (a JSONL: first line is the summary): which cases of this rule fail or are flaky.

Say in two sentences what the rule asks and where its coverage is thin.

## Phase 2: Write the attack

Write 5 to 10 reports a person on foot might really say over a radio, each aimed at one way the rule can break:

- **Boundary:** right at the edge of the rule ("just past the church": behind or near?).
- **Temptation:** a form that pulls towards the wrong answer ("Château" as a name, not a castle; "heading west" at a crossing; "five minutes" as a distance).
- **Two rules at once:** where two rules disagree (a track measured from the speaker; two places, one of them a street).
- **Speech-shaped:** no punctuation, fillers, procedure words ("over", "break"), a call sign, a repeated word, a misheard name.
- **Language:** the same report in French and Ukrainian, Russian words, a Latin-letter Ukrainian name, an English name in a Ukrainian sentence.
- **Area leak:** a report in one area that uses a place from another area's examples (decision 104 found the 3B model copies them).
- **Coverage gap:** a form of the rule that the prompt states and no case covers.

Rules for the reports:
- Do not reuse a prompt example's words; the eval marks those `[in prompt]` and they prove little.
- Use real places from `data/gazetteer.<area>.json` when the report names one, so the outcome means something.
- Nothing that names a real unit or position, and nothing about the Izium mass-grave site (decision 140).
- Keep the Ukrainian plausible. Mark a case `"note": "Ukrainian unchecked"` when unsure; a native speaker should check those.

Write them as cases (the format is in `evals/README.md`) to a draft file in your scratchpad, for example `<scratchpad>/attack-<rule>.cases.json`, with `{ "cases": [...] }`. Tag each `adversarial` and `<rule>`. Give ids `a-<rule>-<n>`, not used in the corpus. Leave `outcome` out.

## Phase 3: Two readings

For each draft case, write `expect` from the prompt's rules alone, not from what you think the model will do. Score only fields the rules settle; leave out any the rules leave open.

Then get an independent second reading: start a subagent with only the text of `systemPrompt()` and the list of report texts (not your expectations, not this conversation), asking it to give, for each report, the fields the rules settle. Compare field by field:

- **Agree:** keep the field.
- **Disagree:** drop the field from `expect`, and list the case as borderline with both readings. If the disagreement is the point of the attack, keep the case out and put it in the report for the person to decide.

Then add outcomes to the draft and check that the expectations can pass:

```bash
npm run eval:outcomes -- <scratchpad>/attack-<rule>.cases.json
```

An outcome comes from the resolver on the expected intent. Read each one: a right reading that gets a wrong pin is a **resolver gap**, not a prompt failure. Note it and leave the case out.

## Phase 4: Run

```bash
npm run eval:extract -- --cases <scratchpad>/attack-<rule>.cases.json --resolve --repeat 3 --no-save --no-compare
```

Add `PROVIDER_MODE=local` in front for the local model. Three rounds, because temperature 0 is not deterministic on Mistral.

## Phase 5: Sort

Put every case in one group:

| Group | Meaning | What happens |
|---|---|---|
| **Holds** | Passes in all rounds | Add it: coverage the rule did not have |
| **Weakness** | Fails in most rounds, both readings agree | Add it: a target for `prompt-tune` |
| **Flaky** | Passes in some rounds | Add it, note "flaky" in `note` |
| **Wrong pin** | Its answer put a pin or heading on the wrong place | Add it, and put it first in the report: these are the ones that matter |
| **Borderline** | The readings disagreed, or the rule is unclear | Do not add. Ask the person, with both readings |
| **Resolver gap** | A right reading still gets the wrong outcome | Do not add. Report it; it is not a prompt problem |

## Phase 6: Codify

Move the cases to add into `evals/extraction.cases.json` (append to `cases`), then:

```bash
npm run eval:format
npm run eval:outcomes -- --check
npx vitest run tests/evalCases.test.ts
```

All three must pass. Run the new cases once more against the corpus file to confirm they behave as in Phase 4:

```bash
npm run eval:extract -- --tag adversarial --only <ids> --resolve --no-save --no-compare
```

Do not touch `evals/baselines/`: new cases show as "not in baseline" until a tune or the person saves a new one.

## Phase 7: Report and journal

Tell the person:
- the rule, the model, how many reports were tried;
- wrong pins first, then weaknesses, flaky cases, borderline cases (with both readings), resolver gaps;
- how many cases were added and how many of those fail;
- the next step: `prompt-tune <rule>` if weaknesses were found, or "the rule holds" if not.

Append a dated entry to `evals/journal.md`:

```
## YYYY-MM-DD, attack: <rule> [<extractor name>]
```

with the same points in a few lines, and the ids added. Plain, short sentences, as in `DECISIONS.md`.

## Guardrails

- One rule per session. A second rule is a second session.
- Never edit the prompt, the resolver or an existing case's expectations here. A wrong existing case goes in the report.
- Never add a case whose expected fields the two readings did not both give.
- Do not commit; the person decides.
