# Known gaps and risks

The largest untested risks are real Ukrainian speech and mixed-language clips; the rest are known limits. Add a gap when you find one; remove it, with a decision line, when it is fixed.

- **Mixed languages in one clip:** in one synthetic test the English half of a Ukrainian-then-English clip was dropped.
- **One place per report:** "the corner of A and B", "between A and B" and "at A, going to B" keep only one place. A crossing is found from one street named and the street the unit is on [117]; with no street known, "the corner of A and B" asks among the crossings of A. In "the pharmacy on rue de Fontenay" the street does not narrow the choice.
- **"The next crossing" outside a mission:** the phone does not send the street it is on or the way it is going, so with no mission the coordinator asks which crossing every time.
- **No shops, cafés, restaurants, banks or house numbers** in the gazetteer ([gazetteer.md](gazetteer.md#how-it-is-built)). Stops, fuel stations, pharmacies, hotels, water and named buildings are in.
- **A name shared by a hotel and a landmark goes to the nearest one.** From Maidan, "Я біля Дніпра" picks Hotel Dnipro, 250 m away, not the river; before hotels were in, it picked the Dnipro metro station, 2.6 km away. Saying "the river" picks the river. The model's guess of a category is not used unless the word was said [15].
- **Spoken coordinates and grid references** are not parsed.
- **Real Ukrainian speech is untested;** all Ukrainian tests used a synthetic voice. Short clips sometimes came back misspelled, though the place still resolved.
- **Language tagging, for clients that do not send `language`:** the web page and the transmitter always send it [106]. Without it, an English sentence with a French street name was tagged as French, so a follow-up question would have been in French. A report in Latin letters is never tagged Ukrainian unless speech-to-text said so [104].
- **A pinned language that is wrong is not caught:** a phone left on Українська while someone speaks English makes Whisper write the English in Cyrillic, and the place is not found [106].
- **No retry on Mistral rate limits;** a refused call fails the report. Most calls take under a second, but one took 8.3 s against a 10 s timeout.
- **Interface text is English only;** only the question and place names follow the speaker's language [39].
- **The Ukrainian voice downloads 77 MB** the first time with nothing on screen to show it.
- **No auth;** the rate limit is per server instance and is not a security control. Anyone who can reach the coordinator can open, end or delete a mission, or join one under any free call sign.
- **A phone that switches coordinator while in a mission** is told its mission has ended, and has to join one on the new coordinator.
- **The live site lags `main`** until someone deploys.
- **The native app's choice list does not show the town** of two same-name streets; the spoken question does ([gazetteer.md](gazetteer.md#same-name-streets)).
