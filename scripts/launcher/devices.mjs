import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { output, run } from './processes.mjs';
import { readJson } from './files.mjs';

export function toolEnvironment() {
  const home = os.homedir();
  const android = process.env.ANDROID_HOME || (process.platform === 'darwin' ? path.join(home, 'Library/Android/sdk') : path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData/Local'), 'Android/Sdk'));
  const java = process.env.JAVA_HOME || (process.platform === 'darwin' ? '/Applications/Android Studio.app/Contents/jbr/Contents/Home' : 'C:\\Program Files\\Android\\Android Studio\\jbr');
  return { ...process.env, ANDROID_HOME: android, ...(existsSync(java) ? { JAVA_HOME: java } : {}), LANG: process.env.LANG?.includes('UTF-8') ? process.env.LANG : 'en_US.UTF-8',
    PATH: [path.join(android, 'platform-tools'), path.join(java, 'bin'), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].filter(Boolean).join(path.delimiter) };
}
export function parseAndroidDevices(text) {
  return text.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((parts) => parts[1] === 'device').map(([id]) => ({ platform: 'android', id }));
}
// `xcrun xctrace list devices` prints three sections. Only "== Devices ==" lists what
// Xcode can reach now, on a cable or over Wi-Fi. "== Devices Offline ==" lists phones
// Xcode only remembers, so they are not connected, and "== Simulators ==" are not phones.
export function parseAppleDevices(text) {
  const devices = [];
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = line.match(/^== (.+) ==$/);
    if (header) { section = header[1]; continue; }
    if (section !== 'Devices') continue;
    const match = line.match(/^(.+?) \([^)]*\) \(([0-9A-Fa-f-]{20,})\)$/);
    if (match && !line.includes('Simulator') && !line.includes('Mac')) devices.push({ platform: 'ios', id: match[2], name: match[1] });
  }
  return devices;
}
export async function listDevices(env) {
  const devices = [];
  try { devices.push(...parseAndroidDevices(await output('adb', ['devices'], { env }))); } catch { /* Android SDK is optional. */ }
  if (process.platform === 'darwin') {
    try { devices.push(...parseAppleDevices(await output('xcrun', ['xctrace', 'list', 'devices'], { env }))); } catch { /* Xcode is optional. */ }
  }
  return devices;
}
export function selectDevice(devices, config) {
  if (config.phone === 'none') return null;
  const matches = devices.filter((device) => (!config.device || config.device === device.id) && (config.phone === 'auto' || config.phone === device.platform));
  if (matches.length > 1) throw new Error('More than one phone is connected. Leave only the phone you want to use connected.');
  return matches[0] ?? null;
}
export async function phoneIdentity(root, device) {
  const app = (await readJson(path.join(root, 'transmitter/app.json'))).expo;
  return device.platform === 'android' ? app.android.package : process.env.TRANSMITTER_BUNDLE_ID || app.ios.bundleIdentifier;
}
export function phoneServer(config, device) {
  return device?.platform === 'android' ? `http://127.0.0.1:${config.port}` : `http://${os.hostname().replace(/\.local$/, '')}.local:${config.port}`;
}
export async function deploy(root, device, env, force, previous, nativeHash) {
  const identity = await phoneIdentity(root, device);
  const cwd = path.join(root, 'transmitter');
  let installed = false;
  if (device.platform === 'android') {
    installed = (await output('adb', ['-s', device.id, 'shell', 'pm', 'path', identity], { env })).startsWith('package:');
  } else {
    const text = await output('xcrun', ['devicectl', 'device', 'info', 'apps', '--device', device.id], { env });
    installed = text.includes(identity);
  }
  const key = `${device.platform}:${device.id}:${identity}`;
  const rebuilt = force || !installed || previous?.key !== key || previous?.native !== nativeHash;
  if (rebuilt) {
    await run('npm', ['run', 'setup'], { cwd, env });
    const expo = path.join(cwd, 'node_modules/expo/bin/cli');
    if (device.platform === 'android') {
      await run(process.execPath, [expo, 'prebuild', '--platform', 'android', '--no-install'], { cwd, env });
      const android = path.join(cwd, 'android');
      const gradle = process.platform === 'win32' ? 'cmd.exe' : path.join(android, 'gradlew');
      const gradleArgs = process.platform === 'win32' ? ['/d', '/c', 'gradlew.bat'] : [];
      try {
        await run(gradle, [...gradleArgs, ':app:assembleDebug', '--max-workers=2', '--no-daemon'], { cwd: android, env });
        await run('adb', ['-s', device.id, 'install', '-r', path.join(android, 'app/build/outputs/apk/debug/app-debug.apk')], { env });
      } finally { await run(gradle, [...gradleArgs, '--stop'], { cwd: android, env }).catch(() => {}); }
    } else {
      if (process.platform !== 'darwin') throw new Error('iPhone builds require macOS and Xcode.');
      await run(process.execPath, [expo, 'run:ios', '--device', device.id, '--no-bundler'], { cwd, env });
    }
  }
  return { key, native: nativeHash, identity, installed: rebuilt };
}
export async function connect(config, device, env, identity) {
  await forward(config, device, env);
  if (device.platform === 'android') {
    const url = `exp+transmitter://?__expo_url=${encodeURIComponent(`http://127.0.0.1:${config.metroPort}`)}&__expo_disable_fab=1&__expo_disable_onboarding=1`;
    // adb joins shell arguments into a command on Android. Quote each value so
    // URL ampersands remain URL data rather than starting background commands.
    const command = ['am', 'start', '-a', 'android.intent.action.VIEW', '-d', url, '-p', identity]
      .map((value) => "'" + value.replaceAll("'", "'\\''") + "'").join(' ');
    await run('adb', ['-s', device.id, 'shell', command], { env });
  } else {
    const url = `exp+transmitter://?__expo_url=${encodeURIComponent(`http://${os.hostname().replace(/\.local$/, '')}.local:${config.metroPort}`)}&__expo_disable_fab=1&__expo_disable_onboarding=1`;
    await run('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', device.id, '--terminate-existing', '--payload-url', url, identity], { env });
  }
}
export async function forward(config, device, env) {
  if (device?.platform === 'android') {
    for (const port of [config.port, config.metroPort]) await output('adb', ['-s', device.id, 'reverse', `tcp:${port}`, `tcp:${port}`], { env });
  }
}
export async function disconnect(config, device, env) {
  if (device?.platform === 'android') {
    for (const port of [config.port, config.metroPort]) await output('adb', ['-s', device.id, 'reverse', '--remove', `tcp:${port}`], { env }).catch(() => {});
  }
}

export async function stopPhone(root, device, env) {
  const identity = await phoneIdentity(root, device);
  if (device.platform === 'android') {
    await output('adb', ['-s', device.id, 'shell', 'am', 'force-stop', identity], { env });
  } else {
    const file = path.join(root, '.run/phone-processes.json');
    await output('xcrun', ['devicectl', 'device', 'info', 'processes', '--device', device.id, '--json-output', file], { env });
    const data = await readJson(file, {});
    const processes = data.result?.runningProcesses || [];
    for (const process of processes) {
      if (process.executable?.endsWith('/Transmitter.app/Transmitter') && Number.isInteger(process.processIdentifier)) {
        await output('xcrun', ['devicectl', 'device', 'process', 'terminate', '--device', device.id, '--pid', String(process.processIdentifier)], { env });
      }
    }
  }
}
