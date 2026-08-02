"use strict";

/**
 * Keep the Grok Usage Meter in sync with Terminal Grok:
 * start when Grok opens, quit when Grok closes.
 * Only one Meter instance is ever left running.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { syncMeterWithGrok } = require("../src/lib/watcher");
const { isTerminalGrokOpen } = require("../src/lib/grok-presence");
const {
  defaultPidPath,
  clearPidFile,
  findMeterPids,
  killOtherMeterInstances,
  isPidAlive,
} = require("../src/lib/pidfile");

const ROOT = path.join(__dirname, "..");
const INTERVAL_MS = Number(process.env.GUM_WATCH_MS) || 3000;
const START_COOLDOWN_MS = Number(process.env.GUM_START_COOLDOWN_MS) || 8_000;
const pidFile = defaultPidPath(ROOT);

function resolveElectronBinary() {
  const fromPackage = require("electron");
  if (typeof fromPackage === "string" && fs.existsSync(fromPackage)) {
    return fromPackage;
  }
  const pathTxt = path.join(ROOT, "node_modules", "electron", "path.txt");
  if (fs.existsSync(pathTxt)) {
    const rel = fs.readFileSync(pathTxt, "utf8").trim();
    const candidate = path.join(ROOT, "node_modules", "electron", "dist", rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("Electron binary not found — run npm install");
}

function isGrokRunning() {
  return isTerminalGrokOpen();
}

function meterPids() {
  return findMeterPids(ROOT, { selfPid: process.pid });
}

function isMeterRunning() {
  return meterPids().length > 0;
}

let lastStartAt = 0;

function startMeter() {
  const now = Date.now();
  if (now - lastStartAt < START_COOLDOWN_MS) return;
  lastStartAt = now;

  // Collapse any orphans before spawn (single-instance Meter).
  const extras = meterPids();
  if (extras.length > 1) {
    // Keep the first, kill the rest; if Electron single-lock is up, start is a no-op focus.
    killOtherMeterInstances(ROOT, { selfPid: extras[0] });
  }
  if (isMeterRunning()) {
    console.log("Meter already running — skip spawn");
    return;
  }

  const electronBin = resolveElectronBinary();
  const env = { ...process.env, GUM_METER: "1" };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronBin, ["."], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
  console.log(`spawned Grok Meter (launcher pid=${child.pid})`);
}

function stopMeter() {
  const pids = meterPids();
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`stopped Grok Meter pid=${pid}`);
    } catch (err) {
      console.log(`stop Grok Meter pid=${pid} failed: ${err.message}`);
    }
  }
  // Escalation for stubborn orphans
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (pids.every((p) => !isPidAlive(p))) break;
  }
  for (const pid of pids) {
    if (isPidAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // ignore
      }
    }
  }
  clearPidFile(pidFile);
}

function tick() {
  const result = syncMeterWithGrok({
    isGrokRunning,
    isMeterRunning,
    startMeter,
    stopMeter,
  });
  if (result === "started" || result === "stopped") {
    console.log(
      `syncMeterWithGrok → ${result} (grok=${isGrokRunning()} meter=${isMeterRunning()})`
    );
  }
}

console.log("watching for Terminal Grok (start on open, stop on close)…");
console.log(`root=${ROOT} interval=${INTERVAL_MS}ms`);
tick();
setInterval(tick, INTERVAL_MS);
