// Fetch the fixed phone model during setup, never through a control on the phone.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const manifest = JSON.parse(await readFile(new URL("../src/modelManifest.json", import.meta.url), "utf8"));
const directory = new URL("../assets/models/", import.meta.url);
const target = new URL(manifest.file, directory);
const temporary = new URL(`${manifest.file}.${process.pid}.part`, directory);

async function valid(file) {
  try {
    if ((await stat(file)).size !== manifest.bytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex") === manifest.sha256;
  } catch {
    return false;
  }
}

try {
  if (!(await valid(target))) {
    await mkdir(directory, { recursive: true });
    if (process.env.STT_MODEL_FILE) {
      await copyFile(process.env.STT_MODEL_FILE, temporary);
    } else {
      console.log("Preparing phone speech recognition: downloading Whisper base (57 MB)…");
      const response = await fetch(manifest.url, { signal: AbortSignal.timeout(600_000) });
      if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    }
    if (!(await valid(temporary))) throw new Error("Speech model checksum failed; run npm run setup again.");
    await rename(temporary, target);
  }
  console.log("Phone speech model ready (Whisper base, checksum verified).");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await rm(temporary, { force: true });
}
