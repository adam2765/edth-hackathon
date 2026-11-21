# Speech-to-text comparison

Which speech-to-text gets place names and languages right? Measured on 21 Nov 2026, 14:50 to 15:20 Paris time, so the team can decide whether to replace Whisper base on the phone. This page measures only. Nothing in the app changed, and it adds no decision line: the phone's speech-to-text is Brian's call [172].

## In short

- **Whisper base, as shipped, placed 17 to 20 of 29 steps.** It does worst on French names in English reports, and on English reports in Kyiv and Izium.
- **Voxtral on the coordinator placed 29 of 29 in every run,** in English, French and Ukrainian, in about 0.4 s. It is Mistral's, so it fits decision 42.
- **Parakeet v3, on this computer, placed 25 or 26 of 29.** It wrote 2 of the 11 Ukrainian clips in Russian, and it is NVIDIA's (US), so it is flagged against decision 42.
- **Whisper small placed 21 or 22 of 29,** at three times the size of base and slower. It did worse than base in Ukrainian.

The recommendation is [at the end](#recommendation).

## What was measured

- **Clips:** the 29 scenario clips in `transmitter/scenarios/audio/`, from all four scenarios: 15 in English, 3 in French, 11 in Ukrainian. They are synthetic macOS voices (Daniel, Jacques, Lesya), clean, 1.5 to 3.6 s long. Whisper and Parakeet read the wav, Voxtral the m4a, as in the app [75].
- **No real voices.** No clips were kept on this computer: `.data/clips/` does not exist, because the coordinator ran without `KEEP_CLIPS=1` [155]. Real reports are harder than these clips; see [Failures seen](#failures-seen).
- **Each option transcribed each clip once.** Each transcript was then sent as `text` to `POST /api/report`, the way the transmitter runs a scenario: a fresh mission for each scenario, steps in order, the step's language pinned [106], and a question answered with the step's `choose`. A step counts when the answer is the one the scenario expects.
- **Extraction was hosted** (`mistral-small-latest`), run three times, because it varies a little from run to run. The scenarios' own words placed 29 of 29 in all three runs, so every miss below comes from speech-to-text. Offline scoring with Ollama was started and stopped: it kept timing out while the Mac was busy transcribing.
- **One miss can cause another,** as on the phone. A unit that was not placed cannot then move "300 metres north of me". The table counts these as the transmitter does.
- **Whisper ran on the Mac as a stand-in for the phone:** whisper.cpp 1.9.5 (`whisper-cli`), with what `transmitter/src/stt.ts` passes. That is the step's language, the area's hint names from `transmitter/src/hints.generated.json` as the prompt [73], 4 threads, and greedy decoding. whisper.rn 0.7.4 on the phone bundles whisper.cpp from August 2026 (between 1.9.3 and 1.9.4), also greedy, with the same temperature fallback. The base model is the phone's file: same SHA-256 as `transmitter/src/modelManifest.json`.
- **Parakeet** ran with whisper.cpp's `parakeet-cli`, built from the v1.9.5 source: Homebrew's build crashed on load. It takes no language and no hint list.
- **Voxtral** ran through the coordinator's own transcriber (`lib/providers/transcriber.ts`), with the 100 bias terms the report route sends, and diarization on [175].
- **Computer:** MacBook Pro, M1 Pro, 32 GB, with the GPU (Metal). A phone is slower. In the 20 Nov simulator, base took about 4 s a clip and small about 15 s, with no GPU. No real phone has been timed.

## Results

| Option | Runs on | Model size | Places right, 3 runs | English (45) | French (9) | Ukrainian (33) | Wrong script or language | Characters wrong | Time per clip on the Mac: median, slowest |
|---|---|---|---|---|---|---|---|---|---|
| Whisper base, hints (as shipped) | phone | 57 MB | 17, 20, 20 | 24 | 3 | 30 | 2 of 15 English clips partly or wholly in Cyrillic | 15% | 0.6 s, 3.8 s |
| Whisper base, no hints | phone | 57 MB | 15, 12, 13 | 17 | 0 | 23 | none | 11% | 0.4 s, 0.7 s |
| Whisper small, hints | phone | 181 MB | 22, 22, 21 | 35 | 9 | 21 | none | 7% | 1.0 s, 1.8 s |
| Whisper small, no hints | phone | 181 MB | 19, 19, 19 | 32 | 6 | 19 | none | 7% | 0.7 s, 1.1 s |
| Parakeet TDT 0.6B v3 (q8_0) | phone or computer | 638 MB | 26, 25, 26 | 35 | 9 | 33 | 2 of 11 Ukrainian clips in Russian | 6% | 0.4 s, 1.0 s |
| Voxtral, bias terms (as shipped) | coordinator, Mistral | none on the phone | 29, 29, 29 | 45 | 9 | 33 | none | 2% | 0.4 s, 0.9 s |
| Voxtral, no bias terms | coordinator, Mistral | none on the phone | 25, 24, 24 | 36 | 9 | 28 | 3 of 11 Ukrainian clips in Russian | 6% | 0.3 s, 1.3 s |

- The language columns add up all three runs.
- "Characters wrong" is the character error rate against the scenario's words, after lower case and without punctuation. Every option wrote «п'ятсот» as "500", so none reaches 0%.
- Voxtral's time is the round trip from Paris to Mistral's API, network included. The Mac times leave out loading the model.
- On the 9 steps of the 20 Nov comparison (Vincennes and Kyiv demos), base with hints placed 8 of 9 again, missing "Bérault" as before.
- Hints matter for every option. They took Whisper base from 12–15 to 17–20, Whisper small from 19 to 21–22, and Voxtral from 24–25 to 29.

Every transcript, with each run's result, is in [`scenarios/results/stt-comparison-2026-11-21.jsonl`](../scenarios/results/stt-comparison-2026-11-21.jsonl).

## Failures seen

**French names in English reports.** This is the biggest source of misses in Vincennes.

- "I'm at Bérault metro" came back as "I'm @BeraldMetro" (base), "Bayreauld Metro" (small), "Bayrold Metro" (Parakeet) and "Bay Road Metro" (Voxtral without bias terms). Only Voxtral with its bias terms got it.
- Real reports from today's Vincennes mission, 14:00 to 15:10, show the same thing, worse. They were transcribed on the phone (the coordinator's speech-to-text time is 0), so by Whisper base. It wrote "Houdela Libéte" and "Audre de la Libérité" for Rue de la Liberté, and "Rouge Charles Sylvesterie" for Rue Charles Silvestri. It also wrote "Haas-Style, Avenue Gabriel-Perry", probably "Hostile, Avenue Gabriel Péri". All three streets are in the gazetteer, and all of these reports came back unresolved.

**The hint list leaks into the words.**

- The Vincennes hints are mostly "Avenue …". With them, base heard "Enemy patrol" as "Avenue Patroule" and "Enemy vehicle to the east" as "Avenue via Colter the East".
- The Kyiv and Izium hints are in Cyrillic. With them, base wrote an English report in Cyrillic, even with English pinned: "I'm at Izium station" became «Айматизиам Стейшен», and "Passing the next intersection" became «Парсинге на next intersection». This is the failure of decisions 76 and 106 ("Аймат the Golden Gate" on 20 Nov); pinning the language did not stop it.
- Voxtral shows the same pull on clips that switch language: in Kyiv, the French half of a Ukrainian-then-French clip came back in Cyrillic or as made-up Ukrainian, 3 times out of 3 ([voices.md](voices.md#mixed-languages)).

**Ukrainian in Latin or Polish letters** (decision 76) was not seen today. With the language pinned [106], base and small wrote all 11 Ukrainian clips in Cyrillic. On 20 Nov, with the language guessed, the phone wrote "Ruchaj z do Sofijskiego Soboru".

**Ukrainian written as Russian.**

- Parakeet and Voxtral without bias terms wrote «Я на центральной площади» for «Я на Центральній площі». Parakeet wrote «Я билет центральной районной лекарни» for «Я біля Центральної районної лікарні».
- The steps still resolved, because name matching tolerates it. The words on the command post were wrong, though.
- Parakeet takes no language setting, so this cannot be pinned away.

**Whisper's small words, in French and Ukrainian.**

- In French, "Je suis devant la mairie" became "Je suis évidemment la Mairie", "la mairie de Vincennes" became "la Marie de Vincent", and "Voiture civile" became "Cerville".
- In Ukrainian, small split words that base kept whole: «Я на Майдані Незалежності» became «Яна Майдані на Залежності», and «Я на Центральній площі» became «Я на центра Іній Площі».

**Slow outliers.** Base with hints took 3.3 to 3.8 s on 3 clips, against a median of 0.6 s. Whisper decodes again when its first pass looks wrong. On a phone this will be several times longer.

## Not measured

| Option | Why not | What its model card says |
|---|---|---|
| Whisper large-v3-turbo | The 574 MB download (q5_0) was not approved today | 809M parameters, 99 languages including Ukrainian, MIT |
| Voxtral open weights: Mini 3B (2507), Mini 4B Realtime (2602) | Neither lists Ukrainian; 3.2 to 3.6 GB quantized; not approved | Apache 2.0; 8 and 13 languages |
| Kyutai STT 1B | English and French only; about 2.4 GB; not approved | CC-BY 4.0 |
| Real voices and whispers | No clips kept | |
| Noise and mixed languages, for Whisper and Parakeet | Measured today for Voxtral only, in [voices.md](voices.md#noise) | |
| Time on a real phone | Not in this session's reach | |

The hosted model, `voxtral-mini-transcribe-3`, is not an open release. Mistral's docs list 53 languages for it, Ukrainian included, and it takes `context_bias`. It is a public preview, released on 20 Oct 2026.

## Model facts

Read on 21 Nov from each model's own card or docs:

| Model | Maker | Languages we need | Licence | Card |
|---|---|---|---|---|
| Whisper base, small | OpenAI (US), open weights | en, fr, uk (99 in all) | Apache 2.0 on the card | [base](https://huggingface.co/openai/whisper-base), [small](https://huggingface.co/openai/whisper-small) |
| Parakeet TDT 0.6B v3 | NVIDIA (US), open weights | en, fr, uk (25 European languages) | CC-BY 4.0 | [card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), [whisper.cpp files](https://huggingface.co/ggml-org/parakeet-GGUF) |
| voxtral-mini-transcribe-3 | Mistral (France), hosted | en, fr, uk (53 in all) | Paid API, $0.0035 a minute | [model](https://docs.mistral.ai/models/voxtral-mini-transcribe-3-0.md), [languages](https://docs.mistral.ai/studio/audio/specs-and-limits/languages) |

Whisper is a US company's model too. It runs on the phone, so no US service is in the request path; decision 42 is about the request path. Parakeet would run the same way. It is flagged here because the team has not discussed it.

The whisper.rn 0.7.4 README says the package can also run Parakeet (`initParakeet`). That was not tried in the app.

## Recommendation

1. **When the coordinator is reachable in hosted mode, let Voxtral transcribe the phone's audio.** The web page and the Android microphone already go that way [175]. It got every step in every run, in all three languages, in about 0.4 s. It is European, and its bias terms fixed the names the others missed. Keep Whisper base on the phone for offline mode and for when there is no network. This brings back the server path that decision 172 removed, so it is Brian's call. Two limits were measured elsewhere today: under field noise it missed 14 of the 32 rain and bang clips [185], and it loses French spoken after Ukrainian in Kyiv ([voices.md](voices.md#mixed-languages)).
2. **If speech has to stay on the phone, Whisper small is not worth it.** It placed 1 to 5 more steps than base, at three times the size, slower, and worse in Ukrainian. Parakeet v3 was the best local option measured, but it is 638 MB, writes some Ukrainian as Russian, and needs the team's say on decision 42.
3. **Cheap changes to try on Whisper base, whatever is chosen.** Give it hint names only in the speaker's script: no Cyrillic names when English or French is pinned, and Latin spellings for Kyiv and Izium when English is pinned. Use fewer "Avenue" names. Measure before and after with the script below.
4. **Before deciding, record real reports.** Record 20 to 30 per language with `KEEP_CLIPS=1` [155]: normal voice, whisper, a street name, some noise. Then run the script below on them. Today's real reports show Whisper base doing worse than on these clean clips.

## How to run it again

`scripts/stt-compare.ts` does all of it. Its header lists the commands.

```bash
brew install whisper-cpp     # whisper-cli; build parakeet-cli from the whisper.cpp source
npx tsx scripts/stt-compare.ts whisper <ggml-base-q5_1.bin> base-hints.jsonl
npx tsx scripts/stt-compare.ts whisper <ggml-base-q5_1.bin> base.jsonl --no-hints
npx tsx scripts/stt-compare.ts parakeet <parakeet-cli> <ggml-parakeet-tdt-0.6b-v3-q8_0.bin> parakeet.jsonl
npx tsx scripts/stt-compare.ts voxtral voxtral.jsonl          # needs MISTRAL_API_KEY
REPORT_STORE_DIR=/tmp/stt-missions npx tsx scripts/stt-compare.ts score scored.jsonl \
  script=script base=base-hints.jsonl parakeet=parakeet.jsonl voxtral=voxtral.jsonl
```

- `script=script` sends the scenarios' own words, as a check on extraction.
- Score in hosted mode one option at a time. Mistral refuses requests when four run at once, and the script then waits and sends again.
- For real clips, set `SCENARIOS_DIR` to a folder with a scenario file that gives each clip's expected answer, and `CLIPS_DIR` to a folder of `<scenario>/<step>.wav`. Keep both out of git: the repo is public, and real voices are not committed.
