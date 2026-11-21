// npm run phones: put the transmitter on every iPhone connected to this Mac, and open it on Metro here.
//
// Most updates need no install. A development build loads its code from Metro on this Mac, so a
// change to App.tsx or src/ only needs the app reopened, and Metro pushes later saves by itself.
// The app is built and installed again only when its native side changed (native packages,
// app.json, app.config.ts and the variables it reads, Expo itself), or a phone does not have it yet.
// README.md, "Updating the phones"; decision 207.
//
//   npm run phones                      update and open the app on every connected iPhone
//   npm run phones -- --check           say what it would do, and change nothing
//   npm run phones -- --rebuild         build and install again anyway (a free Apple ID's app stops opening after 7 days)
//   npm run phones -- --device "<name or UDID>"   one phone only
//
// Nothing here is tied to one Mac: the bundle ID and team come from app.config.ts, with that Mac's
// TRANSMITTER_BUNDLE_ID and APPLE_TEAM_ID from the shell or transmitter/.env.local; the address is
// that Mac's own network name.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SIGNING_WARN_DAYS, planPhones } from "./phones-plan.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const statePath = join(root, ".expo", "phones.json");
const METRO_PORT = 8081;
const COORDINATOR_PORT = 3117;
const usage = 'Usage: npm run phones [-- --check] [--rebuild] [--device "<name or UDID>"]';

const options = { check: false, rebuild: false, device: /** @type {string | undefined} */ (undefined) };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--check") options.check = true;
  else if (arg === "--rebuild") options.rebuild = true;
  else if (arg === "--device" && args[i + 1]) options.device = args[++i];
  else if (arg === "--help" || arg === "-h") {
    console.log(usage);
    process.exit(0);
  } else {
    console.error(`Unknown option: ${arg}\n${usage}`);
    process.exit(1);
  }
}

if (process.platform !== "darwin") {
  console.error("iPhones get the app from a Mac with Xcode. On this computer, use an Android phone (README.md).");
  process.exit(1);
}

let expoRequire;
try {
  expoRequire = createRequire(createRequire(join(root, "package.json")).resolve("expo/package.json"));
} catch {
  console.error("Run `npm install` in transmitter/ first.");
  process.exit(1);
}
const { getConfig } = expoRequire("@expo/config");
const { createFingerprintAsync, DEFAULT_SOURCE_SKIPS, SourceSkips } = expoRequire("@expo/fingerprint");
const { loadProjectEnv } = expoRequire("@expo/env");

// The env files Expo's own commands read (transmitter/.env.local and the like), so the bundle ID and
// team this script checks and opens are the ones `expo run:ios` builds with. The shell wins over them.
loadProjectEnv(root, { mode: "development", silent: true });

/** Run devicectl and read its JSON answer; `ok` is false when it failed. */
function devicectl(/** @type {string[]} */ devicectlArgs) {
  const dir = mkdtempSync(join(tmpdir(), "phones-"));
  const out = join(dir, "out.json");
  try {
    const result = spawnSync("xcrun", ["devicectl", ...devicectlArgs, "--json-output", out], { encoding: "utf8" });
    const json = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null;
    const message = `${result.stderr ?? ""}\n${result.stdout ?? ""}`
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("WARNING"))
      .pop();
    return { ok: result.status === 0, json, message: message ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function answers(/** @type {string} */ url) {
  try {
    return await (await fetch(url, { signal: AbortSignal.timeout(2000) })).text();
  } catch {
    return null;
  }
}

function readState() {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}

function saveState(/** @type {object} */ state) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

// What the build is made from now: the config (with TRANSMITTER_BUNDLE_ID and APPLE_TEAM_ID) and
// every native package. ios/ is made from those by prebuild, so its own files do not count, and
// neither do npm scripts or .gitignore.
const { exp } = getConfig(root, { skipSDKVersionRequirement: true });
const bundleId = exp.ios?.bundleIdentifier;
const scheme = `exp+${exp.slug}`;
const { hash: native } = await createFingerprintAsync(root, {
  platforms: ["ios"],
  ignorePaths: ["ios/**/*", "android/**/*"],
  sourceSkips: DEFAULT_SOURCE_SKIPS | SourceSkips.PackageJsonScriptsAll | SourceSkips.GitIgnore,
});

const listed = devicectl(["list", "devices"]);
if (!listed.json) {
  console.error(`xcrun devicectl did not answer (${listed.message}). Xcode must be installed and opened once (docs/setup.md, part 5).`);
  process.exit(1);
}
const wanted = options.device?.toLowerCase();
const phones = listed.json.result.devices
  .filter((d) => d.hardwareProperties?.platform === "iOS" && d.hardwareProperties?.reality !== "simulated")
  .map((d) => ({
    name: d.deviceProperties?.name ?? d.hardwareProperties?.udid,
    udid: d.hardwareProperties?.udid,
    connected: Boolean(d.connectionProperties?.transportType),
    transport: d.connectionProperties?.transportType === "wired" ? "cable" : "network",
    paired: d.connectionProperties?.pairingState === "paired",
    developerMode: d.deviceProperties?.developerModeStatus,
  }))
  .filter((p) => !wanted || p.name.toLowerCase() === wanted || p.udid.toLowerCase() === wanted);

if (phones.length === 0) {
  console.error(options.device ? `No iPhone called "${options.device}".` : "No iPhone known to this Mac. Plug one in, unlock it and tap Trust.");
  process.exit(1);
}

const installed = Object.fromEntries(
  phones
    .filter((p) => p.connected && p.paired)
    .map((p) => {
      const apps = devicectl(["device", "info", "apps", "--device", p.udid, "--bundle-id", bundleId]);
      return [p.udid, Boolean(apps.json?.result?.apps?.some((a) => a.bundleIdentifier === bundleId))];
    }),
);

const state = readState();
const plan = planPhones({
  native,
  state,
  hasNativeProject: existsSync(join(root, "ios")),
  rebuild: options.rebuild,
  phones,
  installed,
  now: new Date(),
});

const metro = (await answers(`http://localhost:${METRO_PORT}/status`))?.includes("packager-status:running") ?? false;
const coordinator = (await answers(`http://localhost:${COORDINATOR_PORT}/`)) !== null;
const host = `${spawnSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8" }).stdout.trim()}.local`;

console.log(`App ${bundleId}, native fingerprint ${native.slice(0, 7)}`);
console.log(plan.prebuild ? `Native project: made again (${plan.prebuild}); the first build takes several minutes` : "Native project: up to date");
console.log(metro ? `Metro: running on ${host}:${METRO_PORT}` : "Metro: not running. Start it in its own terminal: cd transmitter && npx expo start --dev-client");
console.log(coordinator ? `Coordinator: answering on port ${COORDINATOR_PORT}` : `Coordinator: not answering on port ${COORDINATOR_PORT} (docs/setup.md, part 7); the app will show a red dot`);
for (const step of plan.steps) {
  const doing = { install: "build, install and open", open: metro ? "open" : "nothing until Metro runs", skip: "skip" }[step.action];
  const where = step.phone.connected ? ` (${step.phone.transport})` : "";
  console.log(`  ${step.phone.name}${where}: ${doing}, ${step.reason}`);
}
if (options.check) process.exit(0);

const ready = plan.steps.filter((s) => s.action !== "skip");
if (ready.length === 0) process.exit(1);

const env = { ...process.env, LANG: "en_US.UTF-8", EXPO_NO_GIT_STATUS: "1" };
const results = new Map(plan.steps.map((s) => [s.phone.udid, s.action === "skip" ? `skipped: ${s.reason}` : ""]));
let failed = false;

if (plan.prebuild) {
  console.log("\n> npx expo prebuild --platform ios --clean");
  const made = spawnSync("npx", ["expo", "prebuild", "--platform", "ios", "--clean"], { cwd: root, env, stdio: "inherit" });
  if (made.status !== 0) {
    console.error("\nPrebuild failed; see above. Nothing was installed.");
    process.exit(1);
  }
  state.prebuilt = native;
  saveState(state);
}

for (const step of ready) {
  const { phone } = step;
  if (step.action === "install") {
    console.log(`\n> npx expo run:ios --device ${phone.udid} --no-bundler   (${phone.name})`);
    const built = spawnSync("npx", ["expo", "run:ios", "--device", phone.udid, "--no-bundler"], { cwd: root, env, stdio: "inherit" });
    if (built.status !== 0) {
      results.set(phone.udid, "build or install failed; see above, and docs/setup.md, \"When something fails\"");
      failed = true;
      continue;
    }
    state.phones = { ...state.phones, [phone.udid]: { name: phone.name, native, installedAt: new Date().toISOString() } };
    saveState(state);
  }
  if (!metro) {
    results.set(phone.udid, `${step.action === "install" ? "installed" : "up to date"}; start Metro, then run npm run phones again to open it`);
    continue;
  }
  const url = `${scheme}://?__expo_url=${encodeURIComponent(`http://${host}:${METRO_PORT}`)}&__expo_disable_fab=1&__expo_disable_onboarding=1`;
  const opened = devicectl(["device", "process", "launch", "--device", phone.udid, "--terminate-existing", "--payload-url", url, bundleId]);
  if (!opened.ok) {
    const hint = /lock/i.test(opened.message)
      ? "unlock it and run again"
      : "if it opened before, its signing may have run out (7 days with a free Apple ID): npm run phones -- --rebuild";
    results.set(phone.udid, `did not open (${opened.message}); ${hint}`);
    failed = true;
    continue;
  }
  const signing = step.days !== undefined && step.days >= SIGNING_WARN_DAYS
    ? `; installed ${step.days} days ago, so with a free Apple ID run --rebuild soon`
    : "";
  results.set(phone.udid, `${step.action === "install" ? "updated and opened" : "opened"}${signing}`);
}

console.log("\nDone:");
for (const step of plan.steps) console.log(`  ${step.phone.name}: ${results.get(step.phone.udid)}`);
if (metro) console.log("While Metro runs, saved changes reach the open apps by themselves. Run this again after a native change, or after restarting Metro.");
process.exit(failed ? 1 : 0);
