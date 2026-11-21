# Speech-to-text comparison

Which speech-to-text gets place names and languages right? Measured on 21 Nov 2026, 14:50 to 15:20 Paris time, so the team can decide whether to replace Whisper base on the phone. That part measures only, and adds no decision line: the phone's speech-to-text is Brian's call [172].

A second round, 15:30 to 16:30, measured Whisper large-v3-turbo for speech-to-text on the coordinator in offline mode, and led to decision 193: see [Offline on the coordinator](#offline-on-the-coordinator).

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
| Whisper large-v3-turbo | OpenAI (US), open weights | en, fr, uk (99 in all); 809M parameters | MIT | [card](https://huggingface.co/openai/whisper-large-v3-turbo), [whisper.cpp files](https://huggingface.co/ggerganov/whisper.cpp) |
| Parakeet TDT 0.6B v3 | NVIDIA (US), open weights | en, fr, uk (25 European languages) | CC-BY 4.0 | [card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), [whisper.cpp files](https://huggingface.co/ggml-org/parakeet-GGUF) |
| voxtral-mini-transcribe-3 | Mistral (France), hosted | en, fr, uk (53 in all) | Paid API, $0.0035 a minute | [model](https://docs.mistral.ai/models/voxtral-mini-transcribe-3-0.md), [languages](https://docs.mistral.ai/studio/audio/specs-and-limits/languages) |

Whisper is a US company's model too. It runs on the phone, so no US service is in the request path; decision 42 is about the request path. Parakeet would run the same way. It is flagged here because the team has not discussed it.

The whisper.rn 0.7.4 README says the package can also run Parakeet (`initParakeet`). That was not tried in the app.

## Recommendation

1. **When the coordinator is reachable in hosted mode, let Voxtral transcribe the phone's audio.** The web page and the Android microphone already go that way [175]. It got every step in every run, in all three languages, in about 0.4 s. It is European, and its bias terms fixed the names the others missed. Keep Whisper base on the phone for offline mode and for when there is no network. This brings back the server path that decision 172 removed, so it is Brian's call. Two limits were measured elsewhere today: under field noise it missed 14 of the 32 rain and bang clips [185], and it loses French spoken after Ukrainian in Kyiv ([voices.md](voices.md#mixed-languages)).
2. **If speech has to stay on the phone, Whisper small is not worth it.** It placed 1 to 5 more steps than base, at three times the size, slower, and worse in Ukrainian. Parakeet v3 was the best local option measured, but it is 638 MB, writes some Ukrainian as Russian, and needs the team's say on decision 42.
3. **Cheap changes to try on Whisper base, whatever is chosen.** Give it hint names only in the speaker's script: no Cyrillic names when English or French is pinned, and Latin spellings for Kyiv and Izium when English is pinned. Use fewer "Avenue" names. Measure before and after with the script below.
4. **Before deciding, record real reports.** Record 20 to 30 per language with `KEEP_CLIPS=1` [155]: normal voice, whisper, a street name, some noise. Then run the script below on them. Today's real reports show Whisper base doing worse than on these clean clips.

## Offline on the coordinator

In the field, reports come over a radio, not from a phone, so the coordinator does the speech-to-text, and it can run a larger model than a phone (Alex, 21 Nov). Offline mode had none [83]. Whisper large-v3-turbo (q5_0, 574 MB) was measured beside Parakeet, the best local option above, and now runs there [193].

Same 29 clips and the same scoring as above, three hosted scoring runs, 15:30 to 16:00. Base was run again with the report words of decision 189 in its hints. Character error rate is computed the same way for every row of this table; it comes out about a point under the table above.

| Option | Places right, 3 runs | Characters wrong | Wrong script or language | Time per clip on the Mac: median, slowest |
|---|---|---|---|---|
| Whisper large-v3-turbo, no prompt (chosen) | 25, 26, 25; with VAD 26 | 4% | none with the language pinned | 2.8 s, 3.2 s (whisper-cli); 1.1 s through whisper-server, see below |
| Whisper large-v3-turbo, hint names as the prompt | 25, 25, 25 | 8% | 1 English clip in Cyrillic | 2.9 s, 5.0 s |
| Parakeet TDT 0.6B v3 | 25, 23, 26 | 5% | 2 of 11 Ukrainian clips in Russian | 0.4 s, 1.0 s |
| Whisper base, hints with report words [189] | 19, 20, 18 | 7% | none | 0.3 s, 0.8 s |
| Voxtral, bias terms (hosted) | 28, 29, 29 | 2% | none | 0.4 s, 7.9 s |
| The scenarios' own words | 28, 29, 29 | | | |

- **Turbo and Parakeet miss the same steps.** "Bérault" said by the English voice comes back as "Bayrold" from both, and a Ukrainian reading of "Izium" ("Isium", "ISIM") is not placed. Only Voxtral, with the name as a bias term, gets these. The one other miss in each run varies with extraction.
- **Hint names gain turbo nothing, and cost it twice.** With the Izium names as its prompt, turbo wrote "I'm at Izium station" as «Імадзюм Стасіон», and put the hint word «об'єкт» into «Я біля Центральної районної лікарні», which came back as «І об'єкт 3, районна лікарня». So the coordinator sends turbo no prompt.
- **Base with the report words of decision 189** fixed "Enemy patrol" (no longer "Avenue Patroule"), and placed 18 to 20, against 17 to 20 before.
- **Turbo over Parakeet,** although Parakeet is seven times faster. Turbo is as accurate and steadier (25 or 26 each run, against 23 to 26). It takes the device's language, so it writes Ukrainian in Ukrainian; Parakeet takes none and wrote two Ukrainian clips in Russian. And it runs as a server from Homebrew (`brew install whisper-cpp`): Homebrew's Parakeet crashes on load, and there is no Parakeet server.
- **Without the device's language, turbo writes Ukrainian as Russian too:** «Я на центральной площади», tagged `ru`, for «Я на Центральній площі». It was still placed. The web page and the transmitter always send the language [106].
- **Silence came back as "Thank you."**, Whisper's best-known invention. `npm run stt` starts whisper-server with Silero VAD, which finds the speech first, so silence now comes back as no words and the speaker is asked to repeat. With VAD on, 3 of the 29 transcripts changed by an ending or a full stop, two of them now exactly as said, and one scoring run placed 26 of 29.
- **Time, with nothing else on the GPU.** Through whisper-server, with VAD and the format converted by ffmpeg, turbo takes 1.1 s per clip (median of 29), and about 1.2 s inside `POST /api/report`. A whole spoken report takes 3.2 to 5.1 s offline (4.1 s in the middle, 12 reports), close to the 4 s target ([plan.md](plan.md#local-mode)); Ollama's extraction is most of it, 2 to 3.8 s. Silence takes under 0.1 s, because VAD finds no speech. The native transmitter, which sends text, is not slowed.
- **Ask for `verbose_json` only to learn the language.** It is the one answer that names the language, but whisper-server then runs a second pass that scores every language: 2.0 s per clip against 1.1 s for plain `json`, with the same words on all 29 clips. So the coordinator asks for plain `json` when the device names the language, as the web page and the transmitter always do. Without one, a clip takes 2.9 s.
- **A window sized to the clip was tried and dropped.** Whisper's encoder always reads 30 s, padding a short clip with silence; whisper-server's `audio_ctx` makes the window shorter. At 20 s it saved 0.35 s per clip (0.71 s against 1.07 s). But on six clips of 7 to 15 s, two to five scenario steps of one voice joined with 0.6 s between, turbo began to repeat sentences: at 20 s the 15 s clip ended with "Track 2 is hostile." twice, and at 15 s three of five had a sentence twice. At 10 s and less, short clips repeated too. A repeated sentence could become a second report, so the window stays at 30 s. At 30 s all six joined clips came back whole.
- **Slower numbers from earlier runs.** 4.4 to 4.8 s per clip, and 7.7 to 10.2 s per report, were measured while Ollama served another session on the same GPU. whisper-cli took 2.8 s per clip, leaving out loading.
- Every transcript of this round, with each run's result, is in the same [results file](../scenarios/results/stt-comparison-2026-11-21.jsonl), marked "round 2".
- **Not measured:** real voices, noise, two voices in one clip (Whisper does not tell speakers apart, so the clip is read as one voice), and a report while another one is being transcribed.

## How to run it again

`scripts/stt-compare.ts` does all of it. Its header lists the commands.

```bash
brew install whisper-cpp     # whisper-cli; build parakeet-cli from the whisper.cpp source
npx tsx scripts/stt-compare.ts whisper <ggml-base-q5_1.bin> base-hints.jsonl
npx tsx scripts/stt-compare.ts whisper <ggml-base-q5_1.bin> base.jsonl --no-hints
npx tsx scripts/stt-compare.ts parakeet <parakeet-cli> <ggml-parakeet-tdt-0.6b-v3-q8_0.bin> parakeet.jsonl
npx tsx scripts/stt-compare.ts whisper <ggml-large-v3-turbo-q5_0.bin> turbo.jsonl --no-hints
npx tsx scripts/stt-compare.ts coordinator voxtral.jsonl                          # hosted: needs MISTRAL_API_KEY
PROVIDER_MODE=local npx tsx scripts/stt-compare.ts coordinator whisper-server.jsonl   # offline: needs npm run stt
REPORT_STORE_DIR=/tmp/stt-missions npx tsx scripts/stt-compare.ts score scored.jsonl \
  script=script base=base-hints.jsonl parakeet=parakeet.jsonl voxtral=voxtral.jsonl
```

- `script=script` sends the scenarios' own words, as a check on extraction.
- Score in hosted mode one option at a time. Mistral refuses requests when four run at once, and the script then waits and sends again.
- For real clips, set `SCENARIOS_DIR` to a folder with a scenario file that gives each clip's expected answer, and `CLIPS_DIR` to a folder of `<scenario>/<step>.wav`. Keep both out of git: the repo is public, and real voices are not committed.
