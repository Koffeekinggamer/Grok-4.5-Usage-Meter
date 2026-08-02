"use strict";

const fs = require("fs");
const path = require("path");
const { getActiveSessionsPath, getSessionsDir } = require("./paths");

/**
 * Read JSON if present; return null on missing/invalid.
 * @param {string} filePath
 */
function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Find a session directory by id under sessions/.
 * @param {string} sessionsDir
 * @param {string} sessionId
 * @returns {string|null}
 */
function findSessionDir(sessionsDir, sessionId) {
  if (!fs.existsSync(sessionsDir)) return null;

  // Fast path: walk one level of cwd-encoded dirs.
  let entries;
  try {
    entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === sessionId) {
      return path.join(sessionsDir, entry.name);
    }
    const nested = path.join(sessionsDir, entry.name, sessionId);
    if (fs.existsSync(path.join(nested, "signals.json"))) {
      return nested;
    }
  }
  return null;
}

/**
 * Parse context usage from a signals.json payload.
 * @param {any} signals
 * @returns {{ percent: number, tokensUsed: number|null, windowTokens: number|null, model: string|null }|null}
 */
function parseSignals(signals) {
  if (!signals || typeof signals !== "object") return null;

  let percent = Number(signals.contextWindowUsage);
  const tokensUsed = Number.isFinite(Number(signals.contextTokensUsed))
    ? Number(signals.contextTokensUsed)
    : null;
  const windowTokens = Number.isFinite(Number(signals.contextWindowTokens))
    ? Number(signals.contextWindowTokens)
    : null;

  if (!Number.isFinite(percent)) {
    if (tokensUsed != null && windowTokens != null && windowTokens > 0) {
      percent = (tokensUsed / windowTokens) * 100;
    } else {
      return null;
    }
  }

  return {
    percent: Math.max(0, Math.min(percent, 150)),
    tokensUsed,
    windowTokens,
    model:
      typeof signals.primaryModelId === "string"
        ? signals.primaryModelId
        : null,
  };
}

/**
 * Resolve context usage for the most relevant live Terminal Grok session.
 * Prefers active_sessions.json entries (in order), else newest signals.json.
 *
 * @param {{
 *   activeSessionsPath?: string,
 *   sessionsDir?: string,
 * }} [opts]
 * @returns {{
 *   percent: number,
 *   tokensUsed: number|null,
 *   windowTokens: number|null,
 *   model: string|null,
 *   sessionId: string|null,
 * }|null}
 */
function readActiveContext(opts = {}) {
  const activePath = opts.activeSessionsPath || getActiveSessionsPath();
  const sessionsDir = opts.sessionsDir || getSessionsDir();
  const active = readJsonSafe(activePath);

  if (Array.isArray(active) && active.length > 0) {
    for (const row of active) {
      const sessionId = row?.session_id;
      if (!sessionId) continue;
      const dir = findSessionDir(sessionsDir, sessionId);
      if (!dir) continue;
      const signals = readJsonSafe(path.join(dir, "signals.json"));
      const parsed = parseSignals(signals);
      if (parsed) {
        return { ...parsed, sessionId };
      }
    }
  }

  // Fallback: newest signals.json under sessions/
  if (!fs.existsSync(sessionsDir)) return null;

  /** @type {{ mtime: number, path: string, sessionId: string }[]} */
  const candidates = [];
  const walk = (dir, depth = 0) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.name === "signals.json") {
        try {
          const st = fs.statSync(full);
          candidates.push({
            mtime: st.mtimeMs,
            path: full,
            sessionId: path.basename(path.dirname(full)),
          });
        } catch {
          // skip
        }
      }
    }
  };
  walk(sessionsDir);

  candidates.sort((a, b) => b.mtime - a.mtime);
  for (const c of candidates.slice(0, 12)) {
    const parsed = parseSignals(readJsonSafe(c.path));
    if (parsed) {
      return { ...parsed, sessionId: c.sessionId };
    }
  }

  return null;
}

module.exports = {
  parseSignals,
  readActiveContext,
  findSessionDir,
};
