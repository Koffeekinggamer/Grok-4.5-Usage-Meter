"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const nodeBin =
  process.env.GUM_NODE ||
  process.env.TUM_NODE ||
  process.execPath ||
  "/usr/local/bin/node";
const watchScript = path.join(ROOT, "scripts", "watch-grok.js");

function installMac() {
  const label = "com.grok-usage-meter.grok-watch";
  const agentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const plistPath = path.join(agentsDir, `${label}.plist`);
  fs.mkdirSync(agentsDir, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${watchScript}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/Users/${os.userInfo().username}/.local/node/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${path.join(os.tmpdir(), "grok-usage-meter-watch.log")}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(os.tmpdir(), "grok-usage-meter-watch.err")}</string>
</dict>
</plist>
`;

  fs.writeFileSync(plistPath, plist);
  try {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
  } catch {
    // not loaded yet
  }
  execFileSync("launchctl", ["load", plistPath], { stdio: "inherit" });
  console.log(`Installed Watcher auto-start: ${plistPath}`);
  console.log(
    "Meter overlays when Terminal Grok is open and quits when Grok closes."
  );
}

function installLinux() {
  const dir = path.join(os.homedir(), ".config", "autostart");
  fs.mkdirSync(dir, { recursive: true });
  const desktop = path.join(dir, "grok-usage-meter.desktop");
  fs.writeFileSync(
    desktop,
    `[Desktop Entry]
Type=Application
Name=Grok Usage Meter
Exec=${nodeBin} ${watchScript}
X-GNOME-Autostart-enabled=true
`
  );
  console.log(`Installed autostart entry: ${desktop}`);
}

if (process.platform === "darwin") {
  installMac();
} else if (process.platform === "linux") {
  installLinux();
} else {
  console.log(
    "Auto-launch installer supports macOS and Linux. On Windows, run: npm run watch-grok"
  );
  console.log(`Watcher script: ${watchScript}`);
}
