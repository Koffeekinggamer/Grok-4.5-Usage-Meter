"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { getActiveSessionsPath, getSessionsDir } = require("./paths");
const { isPidAlive } = require("./pidfile");

/**
 * @typedef {{
 *   root: string,
 *   name: string,
 *   sessionId: string|null,
 *   source: 'env'|'active-session'|'session-edits',
 *   cwd: string|null,
 * }} OpenProject
 */

const SKIP_ROOT_NAMES = new Set([
  "Desktop",
  "Documents",
  "Downloads",
  "Library",
  "Movies",
  "Music",
  "Pictures",
  "Public",
  "Applications",
]);

const SKIP_PATH_PARTS = [
  "/.grok/",
  "/Library/",
  "/node_modules/",
  "/.git/",
  "/.local/",
];

/**
 * True if a path looks like a real project root (not bare home).
 * @param {string} root
 * @param {{ home?: string }} [opts]
 */
function isFocusedProjectRoot(root, opts = {}) {
  if (!root || typeof root !== "string") return false;
  const home = opts.home ?? os.homedir();
  const resolved = path.resolve(root);
  if (resolved === path.resolve(home)) return false;
  const base = path.basename(resolved);
  if (SKIP_ROOT_NAMES.has(base) && path.dirname(resolved) === path.resolve(home)) {
    return false;
  }
  try {
    return fs.statSync(resolved).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Walk up from cwd looking for a project marker.
 * @param {string} start
 * @param {{ home?: string, maxUp?: number }} [opts]
 * @returns {string|null}
 */
function findProjectRoot(start, opts = {}) {
  const home = opts.home ?? os.homedir();
  const maxUp = opts.maxUp ?? 8;
  const markers = [
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "composer.json",
    "Gemfile",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "Package.swift",
    "mix.exs",
    "CMakeLists.txt",
    "Makefile",
    ".git",
    "AGENTS.md",
    "requirements.txt",
  ];

  let dir = path.resolve(start);
  for (let i = 0; i < maxUp; i++) {
    if (dir === path.resolve(home) || dir === path.parse(dir).root) break;
    for (const marker of markers) {
      try {
        if (fs.existsSync(path.join(dir, marker))) return dir;
      } catch {
        // skip
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (isFocusedProjectRoot(start, { home })) return path.resolve(start);
  return null;
}

/**
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
 * @param {any} row
 * @returns {number}
 */
function sessionRecency(row) {
  const t = Date.parse(row?.opened_at || "");
  return Number.isFinite(t) ? t : 0;
}

/**
 * Encode a filesystem path the way Terminal Grok names session dirs.
 * @param {string} cwd
 */
function encodeSessionCwd(cwd) {
  return encodeURIComponent(cwd).replace(/%20/g, "%20");
}

/**
 * Find session directory for a session id under sessions/.
 * @param {string} sessionsDir
 * @param {string} sessionId
 * @param {string|null} [cwdHint]
 * @returns {string|null}
 */
function findSessionDir(sessionsDir, sessionId, cwdHint = null) {
  if (!sessionId || !fs.existsSync(sessionsDir)) return null;

  if (cwdHint) {
    const encoded = encodeSessionCwd(path.resolve(cwdHint));
    const candidate = path.join(sessionsDir, encoded, sessionId);
    if (fs.existsSync(candidate)) return candidate;
  }

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
    if (fs.existsSync(nested)) return nested;
  }
  return null;
}

/**
 * @param {string} filePath
 * @param {{ home?: string }} [opts]
 */
function shouldIgnorePath(filePath, opts = {}) {
  const home = opts.home ?? os.homedir();
  if (!filePath || typeof filePath !== "string") return true;
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(home) + path.sep) && resolved !== path.resolve(home)) {
    // still allow absolute project paths under home only for scoring
    if (!resolved.startsWith("/Users/") && !resolved.startsWith("/home/")) return true;
  }
  for (const part of SKIP_PATH_PARTS) {
    if (resolved.includes(part)) return true;
  }
  return false;
}

/**
 * Infer project root from agent edit hunks in the live session.
 * This is how home-cwd Grok Build sessions still map to a project.
 *
 * @param {{
 *   sessionDir: string,
 *   home?: string,
 *   maxLines?: number,
 * }} opts
 * @returns {OpenProject|null}
 */
function projectFromSessionEdits(opts) {
  const home = opts.home ?? os.homedir();
  const maxLines = opts.maxLines ?? 200;
  const hunkPath = path.join(opts.sessionDir, "hunk_records.jsonl");
  if (!fs.existsSync(hunkPath)) return null;

  /** @type {Map<string, { count: number, lastTs: number }>} */
  const roots = new Map();

  let lines;
  try {
    const raw = fs.readFileSync(hunkPath, "utf8");
    lines = raw.split("\n").filter(Boolean);
  } catch {
    return null;
  }

  const slice = lines.slice(-maxLines);
  for (const line of slice) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const filePath = row?.filePath;
    if (!filePath || shouldIgnorePath(filePath, { home })) continue;
    const root = findProjectRoot(filePath, { home });
    if (!root || !isFocusedProjectRoot(root, { home })) continue;
    const ts = Date.parse(row?.timestamp || "") || 0;
    const prev = roots.get(root) || { count: 0, lastTs: 0 };
    prev.count += 1;
    prev.lastTs = Math.max(prev.lastTs, ts);
    roots.set(root, prev);
  }

  if (roots.size === 0) return null;

  /** @type {{ root: string, count: number, lastTs: number }[]} */
  const ranked = [...roots.entries()].map(([root, v]) => ({
    root,
    count: v.count,
    lastTs: v.lastTs,
  }));
  // Prefer most recently edited project; break ties by edit count
  ranked.sort((a, b) => {
    if (b.lastTs !== a.lastTs) return b.lastTs - a.lastTs;
    return b.count - a.count;
  });

  const best = ranked[0];
  const sessionId = path.basename(opts.sessionDir);
  return {
    root: best.root,
    name: path.basename(best.root),
    sessionId,
    source: "session-edits",
    cwd: best.root,
  };
}

/**
 * @param {any[]} active
 * @param {{
 *   home?: string,
 *   isAlive?: (pid: number) => boolean,
 *   requireAlive?: boolean,
 * }} [opts]
 * @returns {OpenProject|null}
 */
function projectFromSessions(active, opts = {}) {
  const home = opts.home ?? os.homedir();
  const isAlive = opts.isAlive || isPidAlive;
  const requireAlive = opts.requireAlive !== false;

  if (!Array.isArray(active) || active.length === 0) return null;

  /** @type {{ row: any, root: string, alive: boolean, recency: number }[]} */
  const candidates = [];

  for (const row of active) {
    const cwd = row?.cwd;
    if (!cwd || !isFocusedProjectRoot(cwd, { home })) continue;
    const pid = Number(row?.pid);
    const alive = Number.isFinite(pid) && isAlive(pid);
    if (requireAlive && !alive) continue;
    const root = findProjectRoot(cwd, { home }) || path.resolve(cwd);
    candidates.push({
      row,
      root,
      alive,
      recency: sessionRecency(row),
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.recency !== a.recency) return b.recency - a.recency;
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return 0;
  });

  const best = candidates[0];
  return {
    root: best.root,
    name: path.basename(best.root),
    sessionId: best.row?.session_id || null,
    source: "active-session",
    cwd: best.row?.cwd || null,
  };
}

/**
 * When session cwd is home (common for Grok Build), infer the project
 * from recent agent edits in that session.
 *
 * @param {{
 *   active?: any[],
 *   home?: string,
 *   sessionsDir?: string,
 *   isAlive?: (pid: number) => boolean,
 * }} [opts]
 * @returns {OpenProject|null}
 */
function projectFromActiveSessionEdits(opts = {}) {
  const home = opts.home ?? os.homedir();
  const sessionsDir = opts.sessionsDir || getSessionsDir();
  const isAlive = opts.isAlive || isPidAlive;
  const active = opts.active;
  if (!Array.isArray(active) || active.length === 0) return null;

  // Prefer newest live session first
  const rows = [...active].sort((a, b) => sessionRecency(b) - sessionRecency(a));

  for (const row of rows) {
    const sessionId = row?.session_id;
    if (!sessionId) continue;
    const pid = Number(row?.pid);
    if (Number.isFinite(pid) && !isAlive(pid)) {
      // still try — edits are on disk
    }
    const sessionDir = findSessionDir(sessionsDir, sessionId, row?.cwd || null);
    if (!sessionDir) continue;
    const project = projectFromSessionEdits({ sessionDir, home });
    if (project) {
      return {
        ...project,
        sessionId,
      };
    }
  }
  return null;
}

/**
 * Resolve the open building project for the efficiency panel.
 *
 * Priority:
 * 1. GUM_PROJECT_LOCK + env
 * 2. Live session with focused project cwd
 * 3. Inferred from active session edit hunks (home-cwd builds)
 * 4. Recent session project cwd (pid may have exited)
 * 5. Env fallback
 *
 * Usage (plan + context) never uses this.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   home?: string,
 *   activeSessionsPath?: string,
 *   sessionsDir?: string,
 *   isAlive?: (pid: number) => boolean,
 * }} [opts]
 * @returns {OpenProject|null}
 */
function resolveOpenProject(opts = {}) {
  const env = opts.env ?? process.env;
  const home = opts.home ?? os.homedir();
  const isAlive = opts.isAlive || isPidAlive;
  const fromEnv = env.PEM_PROJECT || env.GUM_PROJECT;
  const lockEnv = env.GUM_PROJECT_LOCK === "1" || env.GUM_PROJECT_LOCK === "true";

  if (lockEnv && fromEnv && isFocusedProjectRoot(fromEnv, { home })) {
    const root = findProjectRoot(fromEnv, { home }) || path.resolve(fromEnv);
    return {
      root,
      name: path.basename(root),
      sessionId: null,
      source: "env",
      cwd: fromEnv,
    };
  }

  const activePath = opts.activeSessionsPath || getActiveSessionsPath();
  const sessionsDir = opts.sessionsDir || getSessionsDir();
  const active = readJsonSafe(activePath);

  // 1) Live sessions with focused project cwd
  const live = projectFromSessions(active || [], {
    home,
    isAlive,
    requireAlive: true,
  });
  if (live) return live;

  // 2) Infer from agent edits in the active session (home cwd → real project)
  const fromEdits = projectFromActiveSessionEdits({
    active: active || [],
    home,
    sessionsDir,
    isAlive,
  });
  if (fromEdits) return fromEdits;

  // 3) Recently listed sessions with project cwd
  const recent = projectFromSessions(active || [], {
    home,
    isAlive,
    requireAlive: false,
  });
  if (recent) return recent;

  // 4) Env fallback
  if (fromEnv && isFocusedProjectRoot(fromEnv, { home })) {
    const root = findProjectRoot(fromEnv, { home }) || path.resolve(fromEnv);
    return {
      root,
      name: path.basename(root),
      sessionId: null,
      source: "env",
      cwd: fromEnv,
    };
  }

  return null;
}

module.exports = {
  isFocusedProjectRoot,
  findProjectRoot,
  projectFromSessions,
  projectFromSessionEdits,
  projectFromActiveSessionEdits,
  findSessionDir,
  resolveOpenProject,
};
