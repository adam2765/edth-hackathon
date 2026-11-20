# Transmitter

A small native app (Expo, React Native) that stands in for a field radio: it sends spoken
position reports to the coordinator (`POST /api/report` on the web app in the folder above)
and shows and speaks the coordinator's answer.

## One path, several sources

Everything the app sends is an **utterance** (`src/types.ts`): audio or text, a call sign,
start and end times and a sequence number. What produces an utterance can change; nothing
after it does.

| Source | What it is | Status |
|---|---|---|
| Scenario clip | A prepared clip bundled with the app, sent as if it had just been recorded. Silent, repeatable, works in the simulator. | built |
| Microphone | Hold the button, speak, release. | built |
| Open microphone | Listens continuously and cuts at pauses. | later |

## Run it

```bash
npm install
LANG=en_US.UTF-8 npx expo run:ios      # first build takes a few minutes; needs Xcode
npx expo start --dev-client            # the dev server the app loads its code from
```

`LANG=en_US.UTF-8` matters: CocoaPods fails without a UTF-8 locale.
Android: `npx expo run:android`. This is a native build, so Expo Go cannot run it.

The app talks to `https://edth-hackathon.vercel.app` unless `EXPO_PUBLIC_SERVER_URL` is set or
the address is changed on screen. A plain `http://` address on the local network is allowed,
for the no-internet demo.

## Scenarios

`../scenarios/*.json` describe scripted reports and what the coordinator should answer.
`npm run scenarios` (in the folder above, on a Mac) makes the clips with synthetic voices and
writes `scenarios/index.ts` here. "Play scenario" sends every step and marks each one ✓ or ✗
against its expected answer.
