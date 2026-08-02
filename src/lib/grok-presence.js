"use strict";

const fs = require("fs");
const { execFileSync } = require("child_process");
const { getActiveSessionsPath } = require("./paths");
const { isPidAlive } = require("./pidfile");

/**
 * Decide if a process table row is a Terminal Grok CLI process.
 * @param {{ comm?: string, args?: string }} row
 */
function looksLikeGrokProcess(row) {
  const comm = String(row.comm || "").trim();
  const args = String(row.args || "").trim();
  const hay = `${comm} ${args}`;

  // Never treat the Meter / Watcher as Grok.
  if (/watch-grok|Grok Usage Meter|grok-usage-meter/i.test(hay)) {
    return false;
  }
  if (/Electron/i.test(hay) && /Grok Usage/i.test(hay)) {
    return false;
  }

  // macOS often reports comm="grok" and args="grok" with no path.
  if (comm === "grok") return true;

  // Full path installs
  if (/\.grok\/(bin|downloads)\/[^\s]*grok/i.test(args)) return true;
  if (/(^|[\\/])grok(?:\.exe)?(\s|$)/i.test(args) && !/grep|watch/i.test(args)) {
    // Bare argv0 "grok" or ".../grok"
    const first = args.split(/\s+/)[0] || "";
    if (first === "grok" || /[\\/]grok(?:\.exe)?$/i.test(first)) return true;
  }

  return false;
}

/**
 * Parse `ps -axo pid=,comm=,args=` style lines into rows.
 * @param {string} psOutput
 * @returns {{ pid: number, comm: string, args: string }[]}
 */
function parsePsTable(psOutput) {
  const rows = [];
  for (const line of String(psOutput).split("\n")) {
    if (!line.trim()) continue;
    // pid is first column; comm is next token; rest is args
    const m = line.match(/^\s*(\d+)\s+(\S+)\s*(.*)$/);
    if (!m) continue;
    rows.push({
      pid: Number(m[1]),
      comm: m[2],
      args: m[3] || "",
    });
  }
  return rows;
}

/**
 * True if any live Terminal Grok process is on the process table.
 * @param {{
 *   psOutput?: string,
 *   listProcesses?: () => string,
 * }} [opts]
 */
function isGrokProcessRunning(opts = {}) {
  let out = opts.psOutput;
  if (out == null) {
    const list =
      opts.listProcesses ||
      (() =>
        execFileSync("ps", ["-axo", "pid=,comm=,args="], {
          encoding: "utf8",
        }));
    try {
      out = list();
    } catch {
      return false;
    }
  }
  return parsePsTable(out).some((row) => looksLikeGrokProcess(row));
}

/**
 * True if ~/.grok/active_sessions.json lists a still-alive session pid.
 * @param {{
 *   activeSessionsPath?: string,
 *   readFile?: typeof fs.readFileSync,
 *   isAlive?: (pid: number) => boolean,
 * }} [opts]
 */
function hasLiveActiveSession(opts = {}) {
  const path = opts.activeSessionsPath || getActiveSessionsPath();
  const readFile = opts.readFile || fs.readFileSync;
  const isAlive = opts.isAlive || isPidAlive;

  try {
    const raw = readFile(path, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return false;
    return data.some((row) => {
      const pid = Number(row?.pid);
      return Number.isFinite(pid) && isAlive(pid);
    });
  } catch {
    return false;
  }
}

/**
 * Terminal Grok is considered open if a Grok process is running
 * or an active session still has a live pid.
 * @param {{
 *   psOutput?: string,
 *   listProcesses?: () => string,
 *   activeSessionsPath?: string,
 *   readFile?: typeof fs.readFileSync,
 *   isAlive?: (pid: number) => boolean,
 * }} [opts]
 */
function isTerminalGrokOpen(opts = {}) {
  if (isGrokProcessRunning(opts)) return true;
  return hasLiveActiveSession(opts);
}

module.exports = {
  looksLikeGrokProcess,
  parsePsTable,
  isGrokProcessRunning,
  hasLiveActiveSession,
  isTerminalGrokOpen,
};
