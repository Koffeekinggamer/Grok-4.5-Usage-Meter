"use strict";

const fs = require("fs");
const { getActiveSessionsPath } = require("../paths");

/**
 * @typedef {{ session_id: string, pid?: number, cwd?: string, opened_at?: string }} ActiveSession
 */

/**
 * Read active Terminal Grok sessions.
 * @param {{ path?: string, env?: NodeJS.ProcessEnv, readFileSync?: typeof fs.readFileSync }} [opts]
 * @returns {ActiveSession[]}
 */
function listActiveSessions(opts = {}) {
  const filePath =
    opts.path || getActiveSessionsPath({ env: opts.env ?? process.env });
  const read = opts.readFileSync || fs.readFileSync;
  try {
    const raw = JSON.parse(String(read(filePath, "utf8")));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s) => s && typeof s.session_id === "string")
      .map((s) => ({
        session_id: s.session_id,
        pid: typeof s.pid === "number" ? s.pid : undefined,
        cwd: typeof s.cwd === "string" ? s.cwd : undefined,
        opened_at: typeof s.opened_at === "string" ? s.opened_at : undefined,
      }));
  } catch {
    return [];
  }
}

/**
 * Pick the best session for inject: prefer matching cwd, else most recently opened.
 * @param {ActiveSession[]} sessions
 * @param {{ preferCwd?: string|null }} [opts]
 * @returns {ActiveSession|null}
 */
function pickActiveSession(sessions, opts = {}) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;
  const prefer = opts.preferCwd ? normalizePath(opts.preferCwd) : null;
  if (prefer) {
    const match = sessions.find(
      (s) => s.cwd && normalizePath(s.cwd) === prefer
    );
    if (match) return match;
  }
  const sorted = [...sessions].sort((a, b) => {
    const ta = a.opened_at ? Date.parse(a.opened_at) : 0;
    const tb = b.opened_at ? Date.parse(b.opened_at) : 0;
    return tb - ta;
  });
  return sorted[0] || null;
}

/**
 * @param {string} p
 */
function normalizePath(p) {
  return String(p).replace(/\/+$/, "");
}

module.exports = {
  listActiveSessions,
  pickActiveSession,
};
