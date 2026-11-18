# Piano Stars MR

Piano Stars in mixed reality for the Meta Quest 3S.
Blocks fall onto the real piano keys. The game uses the same songs, levels and rules as the tablet app.

## Files

- `PianoStars-MR-v0.1.0.html` - the complete app in one file (version 0.1.0).
- `piano-stars-mr/index.html` - the same file, in the folder that is deployed to Vercel.
- `src/` - source code.
  - `game.js` - game rules (port of `GameView.java`).
  - `detect.wjs` - note finder for the microphone (port of `PitchDetector.java` and `PolyDetector.java`).
  - `xr.js` - headset mode: passthrough, key setup, saved anchor, hands.
  - `stage.js` - the blocks, key lights and panels.
  - `preview.js` - screen mode (practice without the headset).
  - `songs.json` - all 72 songs, exported from `Songs.java` and the MIDI files.
- `export/` - Java tool that exports `songs.json` from the tablet app code.
- `test/` - browser tests (screen mode, and headset mode with Meta's IWER emulator).

## Build

1. Run `npm install` in this folder.
2. Run `node build.mjs 0.1.1` (use the next version number).
3. The new file is `dist/PianoStars-MR-v0.1.1.html`.

## Deploy

1. Copy the new file to `piano-stars-mr/index.html`.
2. In the `piano-stars-mr` folder, run `vercel deploy --prod --yes`.

## Update the songs

1. Copy the new `Songs.java` and `ScoreImport.java` from the tablet app into `export/src/ph/genie/pianostars/`.
2. In the `export` folder, run:
   `javac -encoding UTF-8 -d out $(find src -name '*.java')`
3. Then run:
   `java -cp out ph.genie.pianostars.Export ../../app/src/main/assets ../src/songs.json`
4. Build again.
