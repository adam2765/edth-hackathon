# Other voices and whispers

A clip recorded in a crowd holds other people's words, and a report may be whispered. This file says what the app does about both, what is untested, and how to test it.

## The report that started it

On 20 November a report in the demo mission came back as "and I couldn't cover anything. - Heading towards the cemetery. - Many people came up and I was able to explain them." Only the middle sentence was the speaker. The model read it correctly; it was not placed because the gazetteer had no cemeteries [115]. It took about 17 s, almost all of it Whisper on the phone; the coordinator took under 1 s.

The risk it shows: another voice names a different place, and the app places that one without asking.

## Voice turns [154]

Whisper on the phone writes a dash where it hears the voice change. `lib/geo/voices.ts` splits the transcript there into voice turns.

| Turns in the transcript | What happens |
|---|---|
| One | Read once, as before |
| Several, at most one looks like a report | Read once, as before; the log notes how many voices were heard |
| Two or more look like reports | Each is read on its own, at the same time |
| ... and they place the same thing | Placed, no question |
| ... and they name different places | "I heard more than one voice. Which place is yours: A or B?" Each choice is one voice's place |
| ... and one is about a track, or none can be offered | "Say your position again" |
| More than four look like reports | "Say your position again", without reading each |

"Looks like a report" is a check with no model: a type word ("church", "rue", "кладовище"), a word from a place name of the area, a number, a distance or compass word, a capitalised word mid-sentence, or a word for a track. It errs towards yes: a wrong yes costs one more reading, a wrong no could let another voice's place through unasked.

Measured 21 November, offline (`ministral-3:3b` on the MacBook), typed reports through the coordinator: one voice 0.7 s; the logged report 1.5 s; two voices naming places 1.3 to 1.6 s.

Limits:

- The app cannot tell whose voice is whose. It only notices when two voices name places, and then asks.
- It finds turns only where Whisper marks them. A missed mark reads the clip as one voice, as before.
- Mistral's speech-to-text, as called today, marks no voices. Its diarization is not wired in: the docs give no raw form example for it, and there is no key on this computer to test one.

## Whispers and closeness to the microphone [156]

A voice fingerprint taken from a normal voice matches the same person's whisper poorly, and whispers from different people sound more alike. A whisper clear enough to transcribe, though, was spoken into the phone. So the check for the speaker's own voice is closeness to the microphone: how loud each stretch is, and whether it is voiced or whispered.

- **iPhone first.** iOS 26 offers Voice Isolation (Control Center, Mic Mode) to some third-party recording apps. To check on the demo phone: is it offered while the transmitter records, and does it keep a whisper?
- **Android** has no equivalent an app can count on. Samsung's "Voice focus" is for calls.
- **Not built yet:** a check of our own on the phone. The clips below decide whether loudness and voicing are enough.
- **Untested:** how well Whisper on the phone, and Mistral, transcribe whispers. Place names are likely to suffer first.

## Test clips [155]

1. Start the coordinator so it keeps clips: `KEEP_CLIPS=1 PROVIDER_MODE=local npm run dev -- -p 3117` (drop `PROVIDER_MODE=local` in hosted mode).
2. On the phone, in Setup, pick speech-to-text on the phone and turn on **Send clips for testing**.
3. Record reports. Each clip and a JSON record of how it was heard and read go to `.data/clips/`. The phone's feed shows "clip kept". With the switch on, a clip the phone heard no words in is sent too.
4. Measure: `npx tsx scripts/clip-levels.ts`, or name one or more `.json` files.

```
2026-11-21T10-02-11-430Z-alpha-1-7.wav  phone, 4.3 s, floor -61.2 dB
  heard: "and I couldn't cover anything. - Heading towards the cemetery."
  read:  resolved (category_unique)
  time          level    voiced  words
  0.0–1.6 s     -41.0 dB    78 %  and I couldn't cover anything.
  1.6–4.2 s     -24.5 dB     6 %  Heading towards the cemetery.
```

(An illustration of the layout, not a measurement.)

Six clips are enough to start: a normal voice alone; a whisper alone; a whisper at the phone with someone talking 2 m away; a normal voice with someone talking 2 m away; two people at the same distance; and the third one again with Voice Isolation on.

On the synthetic signals in `tests/clips.test.ts`, a close "whisper" measured −18.5 dB and 0 % voiced, and a distant voice −42.6 dB and 100 % voiced. Real recordings will be closer than that; that is what the clips are for.

Clips are recordings of people's voices. They stay on the computer, git ignores them, and they should be deleted when the test is done: `rm -r .data/clips`.
