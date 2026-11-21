# Extraction eval

Checks how well the model turns a transcript into an intent. It does not check speech-to-text or the resolver. It is layer 2 of the [evaluation plan](../docs/plan.md#evaluation-harness), without the resolver step yet.

```bash
npm run eval:extract                              # hosted Mistral, needs MISTRAL_API_KEY in .env.local
PROVIDER_MODE=local npm run eval:extract          # the local model through Ollama
npm run eval:extract -- --area kyiv               # one area
npm run eval:extract -- --tag track,fr            # cases with any of these tags
npm run eval:extract -- --only s-k1,s-k5          # named cases
npm run eval:extract -- --repeat 3                # each case three times, to see how stable it is
npm run eval:extract -- --no-save                 # do not write a results file
```

The script calls the same `getExtractor()` and `systemPrompt()` as the coordinator, so it scores whatever prompt and model the app would use. The language is not pinned, so the model's own label is scored after the check on the letters [104]. It is not part of `npm test`, because it needs a key or Ollama. `tests/evalCases.test.ts` checks the cases file itself in `npm test`.

## Cases

`extraction.cases.json` holds one case per transcript:

```
{ "id": "p-street", "area": "vincennes", "tags": ["paraphrase"],
  "text": "I'm on rue de Fontenay.",
  "expect": { "kind": "position", "landmark_name": "rue de Fontenay", "landmark_category": "street", "relation": "at" },
  "note": "why, when it is not obvious" }
```

- Only the fields in `expect` are scored. Leave a field out when the prompt's rules allow more than one answer.
- A list means any of these: `"direction": ["west", null]`.
- Text is compared without case, extra spaces, end punctuation or curly apostrophes.
- `area` picks the place given to the prompt ("Vincennes, France").
- Tags: `scenario` (the scenario scripts' sentences), `paraphrase`, `filler`, `fr`, `uk`, `mixed`, `stt_error`, `distance`, `other`, `track`, `trap` (a case built to catch one rule: a time is not a distance, "left" is not a direction, hôtel de ville is not a hotel).

A case whose words are already one of the prompt's examples is marked `[in prompt]`. The score for these is shown apart, because a pass there proves little. Add new cases in words the prompt does not use.

## Reading a run

Each failed case lists the fields that were wrong, with what was wanted and what came back. After the cases come the share of cases passed (all, held out, in prompt), the median and 90th-percentile time, and the share passed by field and by tag. The by-field table says which rule of the prompt to work on.

Runs are saved to `results/<model>-<time>.jsonl`: one header line with the summary, then one line per case with the full intent that came back. Compare a prompt change against the last saved run of the same model.

## First runs, 21 Nov

65 cases, on the MacBook (M1 Pro). The local run was made before one case was changed to accept both word orders of «Європейська вулиця», so it shows one more miss than it would now.

| Model | Cases passed | Median | Weakest fields |
|---|---|---|---|
| Mistral Small (hosted) | 60 of 65 | 0.7 s | relation 46/50, kind 52/54 |
| Ministral 3 3B (local) | 49 of 65 | 2.2 s | lemma 10/14, name 26/32 |

Hosted misses: "outside" read as near instead of in front of; two places in one report ("Leaving the church, heading to the cemetery", "Je quitte la mairie, direction le parc") kept the first place, not where they are going; "Passing the next intersection, heading west" became a movement; "Copy that, moving out" became a movement with no place. The local model also writes English and Latin-letter names in Cyrillic ("Golden Gate", "Khreshchatyk"), and gets some Ukrainian lemmas and «за» (behind) wrong.
