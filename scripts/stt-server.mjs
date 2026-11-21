// Speech-to-text on the coordinator in offline mode (decision 182): fetches Whisper large-v3-turbo
// and the Silero voice-activity model once into models/ (git-ignored), checksums checked, then runs
// whisper.cpp's whisper-server on this computer only.
// Build: npm run build. Start/stop: managed with the other servers.
// Advanced: npm run start:stt runs this component directly after Build prepares it.
// WHISPER_MODEL_FILE copies the Whisper model from a file already on disk instead of downloading it.
// WHISPER_URL sets the port, as the coordinator reads it (default http://127.0.0.1:3118).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const WHISPER = {
  name: "Whisper large-v3-turbo",
  file: "ggml-large-v3-turbo-q5_0.bin",
  bytes: 574041195,
  sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
  from: process.env.WHISPER_MODEL_FILE,
};
// Finds the speech in a clip, so silence comes back as no words instead of Whisper's "Thank you."
const VAD = {
  name: "Silero VAD",
  file: "ggml-silero-v6.2.0.bin",
  bytes: 885098,
  sha256: "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987",
  url: "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin",
};
const directory = new URL("../models/", import.meta.url);
const port = new URL(process.env.WHISPER_URL || "http://127.0.0.1:3118").port || "80";

async function valid(model, file) {
  try {
    if ((await stat(file)).size !== model.bytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex") === model.sha256;
  } catch {
    return false;
  }
}

/** True when the command runs; the flag only prints and exits. */
function has(command, flag) {
  return spawnSync(command, [flag], { stdio: "ignore", timeout: 10_000 }).error == null;
}

/** The model's path in models/, fetched or copied first when it is missing or wrong. */
async function prepare(model) {
  const target = new URL(model.file, directory);
  if (await valid(model, target)) return fileURLToPath(target);
  const temporary = new URL(`${model.file}.${process.pid}.part`, directory);
  await mkdir(directory, { recursive: true });
  try {
    if (model.from) {
      // A clone where the disk allows it (APFS), so a second copy takes no space.
      await copyFile(model.from, temporary, constants.COPYFILE_FICLONE);
    } else {
      console.log(`Downloading ${model.name} (${Math.round(model.bytes / 1e6) || 1} MB, once)…`);
      const response = await fetch(model.url, { signal: AbortSignal.timeout(1_800_000) });
      if (!response.ok || !response.body) throw new Error(`${model.name} download failed: HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    }
    if (!(await valid(model, temporary))) throw new Error(`${model.name} checksum failed; run npm run build again.`);
    await rename(temporary, target);
    return fileURLToPath(target);
  } finally {
    await rm(temporary, { force: true });
  }
}

try {
  const preparing = process.argv.includes("--prepare");
  if (!preparing) {
    for (const model of [WHISPER, VAD]) {
      if (!(await valid(model, new URL(model.file, directory)))) throw new Error(`${model.name} is missing or invalid. Run npm run build first.`);
    }
  }
  const whisper = await prepare(WHISPER);
  const vad = await prepare(VAD);
  if (preparing) { console.log("Coordinator speech models ready (checksums verified)."); process.exit(0); }
  if (!has("whisper-server", "--help")) throw new Error("whisper-server not found. Install whisper.cpp (macOS: brew install whisper.cpp); see docs/setup.md.");
  if (!has("ffmpeg", "-version")) throw new Error("ffmpeg not found. Install ffmpeg (macOS: brew install ffmpeg); see docs/setup.md.");
  console.log(`Whisper large-v3-turbo and Silero VAD ready (checksums verified). Starting whisper-server on 127.0.0.1:${port}.`);
  // --convert: ffmpeg turns the browser's webm and the phone's m4a into the WAV Whisper reads.
  const args = ["-m", whisper, "--host", "127.0.0.1", "--port", port, "--convert", "--vad", "--vad-model", vad];
  const server = spawn("whisper-server", args, { stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
  server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  server.on("exit", (code, signal) => process.exit(code ?? (["SIGINT", "SIGTERM"].includes(signal) ? 0 : 1)));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
