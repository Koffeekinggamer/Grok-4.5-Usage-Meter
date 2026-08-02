"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

if (process.platform === "darwin") {
  const label = "com.grok-usage-meter.grok-watch";
  const plistPath = path.join(
    os.homedir(),
    "Library",
    "LaunchAgents",
    `${label}.plist`
  );
  try {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
  } catch {
    // ignore
  }
  if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
  console.log("Removed Grok Meter Watcher auto-start");
} else if (process.platform === "linux") {
  const desktop = path.join(
    os.homedir(),
    ".config",
    "autostart",
    "grok-usage-meter.desktop"
  );
  if (fs.existsSync(desktop)) fs.unlinkSync(desktop);
  console.log("Removed autostart entry");
} else {
  console.log("Nothing to uninstall on this platform");
}
