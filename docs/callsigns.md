# Call signs from the words

Who sent a radio report, read from its words and matched against the mission's roster [199]. Status on 21 Nov, 18:15 Paris time: the reader and its eval are built (`lib/geo/callsigns.ts`, `evals/callsigns.cases.json`). Nothing calls the reader yet: the coordinator still takes the call sign from the phone's join, and no contract has changed. Wiring it in is [step 2](#next-step-2), and waits for Alex.

## Why

Heard third hand from a Lysk mentor on 21 Nov: units carry radios, and a live operator is on the other end. Reports will arrive as radio audio at the command post, not from phones that join a mission. So the call sign has to come from the words. The phone app stays, as a walkie-talkie stand-in.

The one rule: **a transcript never creates a unit** (Alex, 21 Nov). A garbled call sign must not put a new marker on the map, and a wrong unit moving is worse still. So the reader can only name a unit that is already on the roster, ask which one, or leave the report for the operator.

## What it answers

`matchCallsign(transcript, roster, opts)` returns one of three answers. Each keeps the words it read (`heard`), as speech-to-text wrote them, and a `why` for the log.

| Answer | When | Examples, roster ALPHA 1, ALPHA 2, BRAVO 2, CHARLIE 3, СОКІЛ, ГРІМ |
|---|---|---|
| `unit`, `exact` | The words are a known spelling of one roster entry | "Alpha 1, at the château", "Alfa one", "Alpha-1", "Альфа один", «Від Сокола» |
| `unit`, `near` | Garbled, and close to exactly one roster entry | "Alpha won", "Charlie tree", "Charly 3", "Sokil", «Сокил», "Charlie" with no number (one Charlie) |
| `ask` | Two roster entries are close, or one is and the words may name a unit not on the roster | "Alpha" (ALPHA 1 or 2), "Alpha to base", "Charlie to base" (CHARLIE 3, or a CHARLIE 2 not on the roster) |
| `unassigned` | No sender said, or a call sign not on the roster (`read`) | "I'm at the château"; "Delta 4, checking in" (read DELTA 4); "Charlie 1" (read CHARLIE 1) |

No model is involved, as for track numbers and the subject of a report [147].

## Where the sender is

Radio procedure puts the sender first, or right after the station being called.

- **At the start:** "ALPHA 1, at the château", "ALPHA 1 to base", «Сокіл на зв'язку». Fillers before it are skipped: "uh", "okay", "roger", "hello", «так», «ну».
- **After the command post's call sign:** "BASE, this is ALPHA 1", "BASE, ALPHA 1", "PC de Charlie trois", «Базо, я Грім», «Базі від Грома». The command post's call sign is skipped, said once or twice: it is who is being called.
- **After "this is"** and its kin, within the first eight words: "this is", "ici", "c'est", «це», «тут», «я», «від», «на зв'язку», «доповідає», «это». So "Hello all stations, this is BRAVO 2" works.
- **Unit to unit:** "BRAVO 2, this is ALPHA 1" is ALPHA 1; the first call sign is who is called.
- **The command post speaking:** "ALPHA 1, this is BASE, report your position" and «Соколе, я База» are unassigned: the command post is calling, so no unit reported.
- **Later in the message:** not the sender. "ALPHA 1: BRAVO 2 is at the church" is ALPHA 1. "I'm with Bravo 2 at the church" has no sender.

The command post's call signs default to BASE, CONTROL, ZERO, HQ, COMMAND POST, COMMAND, PC, POSTE DE COMMANDEMENT, БАЗА and ШТАБ, in any case («Базо», «Базі», «штабу»). `opts.station` replaces them, for a mission whose command post has its own call sign.

## Forms it reads

- **NATO spellings,** with the others speech-to-text writes: Alpha or Alfa, Juliett or Juliet, Whiskey or Whisky, "Fox trot" and "X ray" in two words, and Cyrillic spellings in any case («Альфа», «Альфи», «Чарлі», «Браво»).
- **Numbers:** digits, and words in English, French and Ukrainian (with some Russian): "one", "un", «один», «два». NATO's own "niner", "fower", "fife", "wun" and "ait". Digits said one by one: "Alpha zero one" is ALPHA 1, and "one two" is 12 only when the roster has a 12.
- **Joined forms:** "Alpha-1", "Alpha1", «Чарлі-3».
- **Ukrainian personal call signs** that are plain words («Сокіл», «Грім»), in any case: «Сокола», «Соколові», «Грома», «Грому». The last syllable may change («Сокіл», «Сокола») and a vowel may drop («Орел», «Орла»). The Russian form («Сокол», «Гром») matches too.

A number after a call sign without one is the report, not part of the call sign: «Сокіл, два кілометри на північ» is СОКІЛ. A number after a call sign with one is read only as far as it goes: "Alpha one, two hundred metres east" is ALPHA 1, not ALPHA 12.

## When it asks instead of picking

A near match counts only when exactly one roster entry is close. Moving the wrong unit is worse than clutter, so:

- **The word or the number may be a guess, not both.** "Alpha won" (a word that sounds like one) and "Charly 3" (a word that sounds like Charlie) are near matches. "Alpa won" is unassigned.
- **A lost number is a doubt.** "Alpha, at the château" asks between ALPHA 1 and ALPHA 2. With one Charlie on the roster, "Charlie" is CHARLIE 3, near.
- **"to" and "for" are read both ways.** Each may be "two" or "four", or the word itself, as in "ALPHA 1 to base" with the number lost. "Alpha to base" asks between ALPHA 1 and ALPHA 2. "Bravo to base" is BRAVO 2 either way, the only Bravo. "Charlie to base" asks about CHARLIE 3, because "to" may also be CHARLIE 2, who is not on the roster.
- **A clear number that is not on the roster is another unit.** "Charlie 1" with only CHARLIE 3 on the roster is unassigned, read CHARLIE 1, not a near match for CHARLIE 3.
- **NATO words are never near each other.** "Delta 1" is never close to ALPHA 1. A NATO word with no number is a word, not a call sign: "Golf course", "Hôtel de ville" and "Victor Hugo street" read nothing.
- **Near in sound** means one letter off from four letters up, two from seven, on a rough sound key in Latin letters (so «Сокил» and "Sokil" are close to «Сокіл», "Charly" and "Sharlie" to Charlie). Shorter words must sound the same.

## The eval

```bash
npm run eval:callsigns                # every case: the misses and a summary; exits 1 on a miss
npm run eval:callsigns -- --all       # every case, passed or not
npm run eval:callsigns -- --tag uk    # cases with any of these tags
```

`evals/callsigns.cases.json` holds one roster (ALPHA 1, ALPHA 2, BRAVO 2, CHARLIE 3, СОКІЛ, ГРІМ) and one case per line: the transcript and the answer wanted. Only the fields given are scored: `kind`, `callsign`, `how`, `candidates` (as a set), `read` (`null` for no call sign read). A **wrong unit** is the worst miss, marked `UNIT!`: a unit named where the case wants a question, no unit or another unit. That unit would move. No model is called, so `tests/callsigns.test.ts` runs every case in `npm test`: all must pass, and none may give a wrong unit.

Tags: `clean`, `number_word`, `nato_spelling`, `joined`, `procedure`, `station` (the command post's call sign), `filler`, `stt_error` (garbled the way speech-to-text garbles), `number_doubt`, `unknown` (not on the roster), `none` (no call sign said), `later` (another unit named in the message), `trap`, `fr`, `uk`, `uk_case`, `personal`, `mixed`, `held_out`.

### Scores, 21 Nov

| Round | Cases | Passed | Wrong units | What it was |
|---|---|---|---|---|
| 1 | 75 | 75 | 0 | Written with the rules, before the code. It passing proves little. |
| 2 | 23 more | 11 | 2 | Aimed at what round 1 missed. The two wrong units were the command post speaking ("Alpha 1, this is base", «Соколе, я База») read as the unit called. Also missed: a station said twice, "roger" and «так» before the call sign, "Alpha zero one", «на зв'язку Сокіл», «доповідає Грім», and NATO words in place names read as call signs ("Golf course"). All fixed. |
| Held out | 25 more | 25 | 0 | Written by a separate agent from the rules alone, without the code, then scored before anyone looked at them. |
| All | 123 | 123 | 0 | `npm run eval:callsigns`, and in `npm test` |

What this does not show: every transcript is written by hand, in the way speech-to-text garbles. None is real output from radio audio. The next measure is real clips through the offline Whisper turbo [195] and Voxtral, with their transcripts added as cases.

## Known limits

- **An unknown personal call sign at the start is not read.** «Беркут, біля школи» is unassigned with nothing read: any word could be a call sign. After «тут», «я», «це» or "this is", a word with a capital letter is read («Я Беркут» reads БЕРКУТ). A transcript in lower case loses that.
- **A call sign without a number takes a number after it as the report.** If СОКІЛ and СОКІЛ 2 are both units, put both on the roster: "Сокіл 2" then asks between them.
- **A lost number before a number word is not seen.** "Bravo, two drones at the church" from a BRAVO whose number was lost reads BRAVO 2: it is the same words as "Bravo two, drones at the church".
- **The sender is the first call sign.** "Bravo 2 is at the church", said by another unit without its own call sign, reads BRAVO 2. The position is still BRAVO 2's, so the marker is right; "Bravo 2 is 200 metres north of me" would not be.
- **Numbers in English, French and Ukrainian only,** with some Russian. Ukrainian ordinals («перший») are not numbers here.

## Next: step 2

These change contracts, each with its own decision line, and wait for Alex:

- The mission gains a roster that the operator sets when opening it (`POST /api/sessions`, `components/MissionPanel.tsx`).
- An unknown call sign that checks in ("CHARLIE 3, checking in") asks the operator to add it or pick an existing unit. Only the operator's click adds one.
- A report keeps the call sign as heard and how it matched.
- The command post gets an "Unassigned" tray with the report's words and audio, and "assign to" for the operator.
- Two guards ask the operator instead of acting: an implausible move ("ALPHA 2 moved 3 km in 20 s. Was that ALPHA 1?"), with the 15 m/s reachability check of decision 188; and a reply with no call sign while a question to one unit is open and recent, which goes to that unit.
- The roster goes to Voxtral as hints. The offline Whisper turbo takes no prompt [195], so offline matching must cope without them, as the eval assumes.
