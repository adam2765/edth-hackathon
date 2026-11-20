// Puts what the in-browser Ukrainian voice needs under /public (both folders are ignored by git):
//   public/ort/  onnxruntime-web's WebAssembly runtime, copied from node_modules. Loaded at a stable
//                URL at run time, not bundled, for the same reason as the MapLibre worker.
//   public/tts/  the Piper voice named in lib/tts/voiceManifest.json (CC0) and its model card.
//
// The voice comes from models/piper/ when it is there, otherwise from Hugging Face at a pinned
// revision. Every copy is checked against the SHA-256 in the manifest. A failed download is a
// warning, never a failed build: without the model the app keeps using the system voice.
//
// On Vercel the 77 MB model is left out of the deployment unless TTS_BUNDLE_MODEL=1, so a
// deploy does not change size until someone decides it should.
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

const voice = JSON.parse(readFileSync("lib/tts/voiceManifest.json", "utf8"));
const ORT_FILES = ["ort.wasm.min.mjs", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];
const LOCAL_DIR = `models/piper/${voice.name}`;

function sha256(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path).on("data", (d) => hash.update(d)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
  });
}

async function matches(path, expected) {
  return existsSync(path) && (await sha256(path)) === expected;
}

async function place(file, expected, allowDownload) {
  const target = `public/tts/${file}`;
  if (await matches(target, expected)) return "already there";
  const local = `${LOCAL_DIR}/${file}`;
  if (await matches(local, expected)) {
    copyFileSync(local, target);
    return `copied from ${LOCAL_DIR}/`;
  }
  if (!allowDownload) return "left out of this deployment (set TTS_BUNDLE_MODEL=1 to include it)";
  const partial = `${target}.partial`;
  try {
    const res = await fetch(voice.source + file);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(partial, Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    rmSync(partial, { force: true });
    console.warn(`prepare-tts: could not download ${file} (${err.message}); the Ukrainian voice will be unavailable`);
    return "not downloaded";
  }
  if ((await sha256(partial)) !== expected) {
    rmSync(partial, { force: true });
    throw new Error(`${file} from ${voice.source} does not match the expected SHA-256; nothing was kept`);
  }
  renameSync(partial, target);
  return "downloaded and verified";
}

mkdirSync("public/ort", { recursive: true });
for (const f of ORT_FILES) copyFileSync(`node_modules/onnxruntime-web/dist/${f}`, `public/ort/${f}`);
console.log("prepare-tts: copied onnxruntime-web runtime -> public/ort/");

mkdirSync("public/tts", { recursive: true });
const bundleModel = !process.env.VERCEL || process.env.TTS_BUNDLE_MODEL === "1";
console.log(`prepare-tts: ${voice.file}: ${await place(voice.file, voice.sha256, bundleModel)}`);
console.log(`prepare-tts: ${voice.modelCard.file}: ${await place(voice.modelCard.file, voice.modelCard.sha256, bundleModel)}`);
