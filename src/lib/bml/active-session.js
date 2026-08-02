"use strict";

const fs = require("fs");
const path = require("path");
const { getActiveSessionsPath, getSessionsDir } = require("../paths");

/**
 * @typedef {{
 *   session_id: string,
 *   pid?: number,
 *   cwd?: string,
 *   opened_at?: string,
 *   mtimeMs?: number,
 *   live?: boolean,
 *   source?: 'active_sessions'|'sessions_tree',
 * }} ActiveSession
 */

/**
 * @param {string} p
 */
function normalizePath(p) {
  return String(p || "")
    .replace(/\/+$/, "")
    .replace(/\\/g, "/");
}

/**
 * @param {number} pid
 * @param {{ kill?: typeof process.kill }} [opts]
 */
function isPidAlive(pid, opts = {}) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  const kill = opts.kill || process.kill;
  try {
    kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read active Terminal Grok sessions from active_sessions.json.
 * @param {{ path?: string, env?: NodeJS.ProcessEnv, readFileSync?: typeof fs.readFileSync, kill?: typeof process.kill }} [opts]
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
      .map((s) => {
        const pid = typeof s.pid === "number" ? s.pid : undefined;
        return {
          session_id: s.session_id,
          pid,
          cwd: typeof s.cwd === "string" ? s.cwd : undefined,
          opened_at: typeof s.opened_at === "string" ? s.opened_at : undefined,
          live: pid != null ? isPidAlive(pid, opts) : false,
          source: /** @type {const} */ ("active_sessions"),
        };
      });
  } catch {
    return [];
  }
}

/**
 * Decode URL-encoded session group folder name → absolute cwd.
 * e.g. %2FUsers%2Fme%2Fproj → /Users/me/proj
 * @param {string} name
 * @returns {string|null}
 */
function decodeSessionGroupName(name) {
  if (!name || name === "session_search.sqlite") return null;
  try {
    const decoded = decodeURIComponent(name);
    if (decoded.startsWith("/") || /^[A-Za-z]:[\\/]/.test(decoded)) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Discover sessions from ~/.grok/sessions tree (cwd from group folder or .cwd file).
 * Used when active_sessions.json is empty/stale so BML still binds to the chat project.
 * @param {{
 *   sessionsDir?: string,
 *   env?: NodeJS.ProcessEnv,
 *   readdirSync?: typeof fs.readdirSync,
 *   statSync?: typeof fs.statSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   existsSync?: typeof fs.existsSync,
 * }} [opts]
 * @returns {ActiveSession[]}
 */
function listSessionsFromTree(opts = {}) {
  const sessionsDir =
    opts.sessionsDir || getSessionsDir({ env: opts.env ?? process.env });
  const readdir = opts.readdirSync || fs.readdirSync;
  const stat = opts.statSync || fs.statSync;
  const read = opts.readFileSync || fs.readFileSync;
  const exists = opts.existsSync || fs.existsSync;

  if (!exists(sessionsDir)) return [];

  /** @type {ActiveSession[]} */
  const out = [];
  let groups;
  try {
    groups = readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const group of groups) {
    if (!group.isDirectory()) continue;
    const groupPath = path.join(sessionsDir, group.name);
    let cwd =
      decodeSessionGroupName(group.name) ||
      (() => {
        try {
          if (exists(path.join(groupPath, ".cwd"))) {
            return String(read(path.join(groupPath, ".cwd"), "utf8")).trim();
          }
        } catch {
          // ignore
        }
        return null;
      })();
    if (!cwd) continue;

    let children;
    try {
      children = readdir(groupPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const child of children) {
      if (!child.isDirectory()) continue;
      const sessionId = child.name;
      // UUIDs / session ids are long; skip junk
      if (sessionId.length < 8) continue;
      const sessionDir = path.join(groupPath, sessionId);
      const signalsPath = path.join(sessionDir, "signals.json");
      let mtimeMs = 0;
      try {
        if (exists(signalsPath)) mtimeMs = stat(signalsPath).mtimeMs;
        else mtimeMs = stat(sessionDir).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      out.push({
        session_id: sessionId,
        cwd,
        mtimeMs,
        live: false,
        source: "sessions_tree",
      });
    }
  }

  return out;
}

/**
 * Pick the session that represents the active chat project.
 * Priority:
 *  1. Live pid in active_sessions (most recently opened among live)
 *  2. Any active_sessions entry (most recent opened_at)
 *  3. Prefer cwd match if preferCwd set
 *  4. Freshest session under sessions/ tree by signals mtime
 *
 * Never prefers process.cwd() here — that is a last-resort outside this function.
 *
 * @param {ActiveSession[]} sessions
 * @param {{ preferCwd?: string|null, treeSessions?: ActiveSession[] }} [opts]
 * @returns {ActiveSession|null}
 */
function pickActiveSession(sessions, opts = {}) {
  const prefer = opts.preferCwd ? normalizePath(opts.preferCwd) : null;
  const fromActive = Array.isArray(sessions) ? [...sessions] : [];
  const fromTree = Array.isArray(opts.treeSessions) ? [...opts.treeSessions] : [];

  const score = (s) => {
    let n = 0;
    if (s.live) n += 1_000_000_000;
    if (prefer && s.cwd && normalizePath(s.cwd) === prefer) n += 500_000_000;
    if (s.source === "active_sessions") n += 100_000_000;
    const opened = s.opened_at ? Date.parse(s.opened_at) || 0 : 0;
    const mtime = s.mtimeMs || 0;
    n += Math.max(opened, mtime);
    return n;
  };

  const pool = [...fromActive, ...fromTree];
  if (pool.length === 0) return null;

  pool.sort((a, b) => score(b) - score(a));
  return pool[0] || null;
}

/**
 * Resolve the chat project session for BML (active_sessions + sessions tree).
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   preferCwd?: string|null,
 *   listActive?: typeof listActiveSessions,
 *   listTree?: typeof listSessionsFromTree,
 *   pick?: typeof pickActiveSession,
 * }} [opts]
 * @returns {ActiveSession|null}
 */
function resolveChatSession(opts = {}) {
  const env = opts.env ?? process.env;
  const listActive = opts.listActive || listActiveSessions;
  const listTree = opts.listTree || listSessionsFromTree;
  const pick = opts.pick || pickActiveSession;

  const prefer =
    opts.preferCwd ||
    env.GUM_BML_CWD ||
    env.GUM_PROJECT_CWD ||
    null;

  const active = listActive({ env });
  const tree = listTree({ env });
  return pick(active, { preferCwd: prefer, treeSessions: tree });
}

module.exports = {
  listActiveSessions,
  listSessionsFromTree,
  pickActiveSession,
  resolveChatSession,
  decodeSessionGroupName,
  isPidAlive,
  normalizePath,
};
