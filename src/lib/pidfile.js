"use strict";

const fs = require("fs");
const path = require("path");

function defaultPidPath(root) {
  return path.join(root, ".meter.pid");
}

/**
 * @param {string} pidPath
 * @param {number} pid
 */
function writePidFile(pidPath, pid) {
  fs.writeFileSync(pidPath, String(pid));
}

/**
 * @param {string} pidPath
 */
function clearPidFile(pidPath) {
  try {
    fs.unlinkSync(pidPath);
  } catch {
    // ignore
  }
}

/**
 * @param {string} pidPath
 * @returns {number|null}
 */
function readPidFile(pidPath) {
  try {
    const raw = fs.readFileSync(pidPath, "utf8").trim();
    const pid = Number(raw);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * @param {number} pid
 */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  defaultPidPath,
  writePidFile,
  clearPidFile,
  readPidFile,
  isPidAlive,
};
