# Label fonts

The fonts the map's own labels are drawn with: unit and track names, times, the start point. They are in git so that the labels still draw on the plain background, with no internet and no saved base map ([DECISIONS.md](../../DECISIONS.md), decision 239).

- **What:** Noto Sans Regular and Noto Sans Bold, as glyph files in the format MapLibre reads, one file for each block of 256 characters: Latin (0 to 511), Cyrillic (1024 to 1279), punctuation, arrows and "≈" (8192 to 8959).
- **From:** OpenFreeMap's font server, `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf`, fetched on 22 November 2026.
- **Fetch again:** `npm run basemap -- --labels`.

## Licence

Noto Sans is copyright Google LLC and The Noto Project Authors.

This Font Software is licensed under the SIL Open Font License, Version 1.1. The licence is available with a FAQ at https://openfontlicense.org. Its full text is not copied here yet.
