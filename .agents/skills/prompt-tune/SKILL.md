---
name: prompt-tune
description: Improve the intent-extraction prompt for one rule with a measured before and after - baseline, diagnose the failures, edit systemPrompt, re-run on both models, refuse regressions, record the change. Use when asked to tune, fix or improve the extraction prompt, or to act on weaknesses a prompt-attack found.
argument-hint: <rule or tag> [--model hosted|local]
---

# Prompt tune

Adapted from levelang's `prompt-tune`. One cycle changes the prompt for **one rule**, and is kept only if the whole corpus is no worse on either model. The prompt is `systemPrompt()` in `lib/providers/extractor.ts`; the schema is `INTENT_SCHEMA` beside it.

## Why the blast radius is the whole corpus

There is one prompt for every area, every language and both models: hosted Mistral Small and the local Ministral 3 3B (decision 83). A line added for a French rule can change a Ukrainian answer, and a fix for Mistral can break the 3B model. So every cycle runs the **full corpus**, not only the target rule, and runs the second model too unless the person says to skip it.

## Inputs

- `<rule or tag>`: the target, as in `prompt-attack` (`relation`, `two-places`, `track`, ...) or a tag from the cases file. If none is given, take the most failed field in the latest run and say so.
- `--model`: the model to tune for, `hosted` (default) or `local`. The other model is the regression check.

## Phase 1: Baseline

The baseline is the committed file `evals/baselines/<extractor>.json`. Check it is for the current prompt:

```bash
npm run eval:extract -- --resolve --repeat 3 --no-save
```

The first line prints the prompt id. If it differs from the baseline's `prompt_id`, the prompt changed since the baseline was saved: tell the person, and ask before going on, because the comparison would then mix two changes. Note the target's failing cases, the flaky ones, and any wrong pins.

Do the same for the other model (`PROVIDER_MODE=local` in front for local). It takes about 7 minutes at three rounds; one round is enough for the regression check if time is short, but say so.

## Phase 2: Diagnose

### 2a. Read

1. `evals/journal.md`: earlier attacks and tunes on this rule, and limits already accepted.
2. The target rule's lines and examples in `systemPrompt()`.
3. What is known about these models:
   - Mistral follows negative framing ("Never", "not", WRONG/RIGHT pairs) well, unlike Gemini. Levelang measured a drop (92.7% to 85.5%) when "NEVER" and "FORBIDDEN" were removed from a Mistral prompt. Do not reword prohibitions into positive-only form for Mistral.
   - Naming the specific blocked pattern ("'outside' is in_front_of, not near") works better than relying on a list to exclude it.
   - Temperature 0 is not deterministic. A case that passes 2 of 3 is flaky, not fixed.
   - The 3B model copies the examples: names, languages, scripts (decision 104: English Kyiv reports labelled Ukrainian; "Golden Gate" written in Cyrillic). Every example added is a chance of leakage. Prefer a rule line to a new example; when an example is needed, use a place that is not in any area's gazetteer, or make it generic.
   - Prompt length costs little time on Mistral (decision 57), but output length does on the 3B model (decision 152): do not add fields to the schema in a tune.

Say in one or two sentences what you learned.

### 2b. Audit the prompt

Before looking at single failures, read the whole prompt for structural problems that would explain several failures at once:
- two rules that disagree (a crossing is `kind: "position"`, but "heading west" is a movement);
- a rule stated only in an example, or an example that contradicts a rule;
- a rule worded for one language only;
- a trigger list that is missing the words that failed ("outside" is listed, so why "near"?).

If you find one, fix it first.

### 2c. Classify each failing case of the target

- **Rule missing:** nothing in the prompt covers it.
- **Rule weak:** the rule is there and the model does not follow it. Strengthen it with the blocked pattern named, or a WRONG/RIGHT pair.
- **Rules conflict:** see 2b.
- **Example leak:** the model copied an example.
- **Case wrong:** the expectation is not what the rules say. Do not change it in this cycle: report it, and let the person decide.
- **Model limit:** the rule is clear and the model still fails. Say so; it may be accepted in the journal.
- **Not the prompt:** the intent is right and the outcome is wrong. That is the resolver; stop and report.

## Phase 3: Edit

Change only the lines the diagnosis names. Show the person the before and after of each line, and why, before writing. Keep to the house rules in `AGENTS.md`:

- The model never produces coordinates; the prompt must not ask for any.
- The prompt asks the model to copy what was said, never to guess a place. Do not add a rule that has the model fill in a name it did not hear, even when that would pass a case: the resolver asks back instead (`AGENTS.md`: when a report is ambiguous, ask back).
- Keep each example on one line in the existing JSON form; the track examples are appended after the speaker examples.

## Phase 4: Validate

Run the full corpus on the tuned model, then on the other one:

```bash
npm run eval:extract -- --resolve --repeat 3
PROVIDER_MODE=local npm run eval:extract -- --resolve --repeat 3
```

Each prints its comparison with the baseline and exits 1 on a regression or a new wrong pin. Also run `npm test`, because some unit tests read the prompt.

- **Regressions or new wrong pins:** the change is not done. Go back to Phase 3, or undo it. Never keep one without the person's yes, stated in their own words.
- **Flaky becomes passing in 3 of 3:** an improvement. 2 of 3 is not.
- **Latency:** compare the median with the baseline's `summary.medianMs`. Report a rise of more than 20% on the 3B model.

## Phase 5: Coverage

If the change covers a form of the rule no case tests, add cases for it, following Phase 2 to Phase 6 of `prompt-attack` (two readings, outcomes, format, tests).

## Phase 6: Record

Only when the person accepts the change:

1. Save new baselines for both models from the Phase 4 runs, which are saved in `evals/results/`:
   ```bash
   npm run eval:baseline -- evals/results/<hosted run>.jsonl
   npm run eval:baseline -- evals/results/<local run>.jsonl
   ```
   It refuses a run of another prompt, so if the prompt changed after a run, run again with `--save-baseline`.
2. Append one decision line to `DECISIONS.md`: the rule, what changed in the prompt, the before and after on both models (cases passed, wrong pins, median time), and the person's words.
3. Append a dated entry to `evals/journal.md`:
   ```
   ## YYYY-MM-DD, tune: <rule> [<extractor name>]
   ```
   with the diagnosis, the change, before and after, and anything accepted as a model limit.
4. Update the scores table in `evals/README.md`, and `docs/known-gaps.md` if a listed gap closed.

## Report

The target, the baseline and the new score on both models, the change in one or two lines, regressions (none, or which ones the person accepted), new cases, and what is left. Do not commit; the person decides.

## Guardrails

- One rule per cycle. A second rule is a second cycle, from a new baseline.
- Never edit a case's expectations to make the prompt pass.
- Never change the resolver, the schema or a contract field in a tune.
- Never save a baseline the person has not accepted.
