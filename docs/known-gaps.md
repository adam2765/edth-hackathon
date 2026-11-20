# Known gaps and risks

The largest untested risks are real Ukrainian speech and mixed-language clips; the rest are known limits. Add a gap when you find one; remove it, with a decision line, when it is fixed.

- **Mixed languages in one clip:** in one synthetic test the English half of a Ukrainian-then-English clip was dropped.
- **One place per report:** intersections, "between A and B" and "at A, going to B" keep only one place.
- **Spoken coordinates and grid references** are not parsed.
- **Real Ukrainian speech is untested;** all Ukrainian tests used a synthetic voice. Short clips sometimes came back misspelled, though the place still resolved.
- **Language tagging:** an English sentence with a French street name was tagged as French, so a follow-up question would have been in French.
- **No retry on Mistral rate limits;** a refused call fails the report. Most calls take under a second, but one took 8.3 s against a 10 s timeout.
- **Interface text is English only;** only the question and place names follow the speaker's language [39].
- **The Ukrainian voice downloads 77 MB** the first time with nothing on screen to show it.
- **No auth;** the rate limit is per server instance and is not a security control.
- **The live site lags `main`** until someone deploys.
- **The native app's choice list does not show the town** of two same-name streets; the spoken question does ([gazetteer.md](gazetteer.md#same-name-streets)).
