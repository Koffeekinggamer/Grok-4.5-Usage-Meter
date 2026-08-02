"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { getActiveSessionsPath } = require("./paths");
const { isPidAlive } = require("./pidfile");

/**
 * @typedef {{
 *   root: string,
 *   name: string,
 *   sessionId: string|null,
 *   source: 'env'|'active-session',
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

  // Fallback: use start if it is a focused directory
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
 * Pick the newest focused project from active_sessions rows.
 * Live pid preferred; dead pid rows are fallback.
 *
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

  // Newest first; prefer alive when recency ties
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
 * Resolve the open building project for the efficiency panel.
 *
 * Live session wins so efficiency tracks whichever project Grok has open.
 * Env (`GUM_PROJECT` / `PEM_PROJECT`) is a fallback when no session project
 * is focused — unless `GUM_PROJECT_LOCK=1`, which forces the env path.
 *
 * Usage (plan + context) never uses this — account/session billing is separate.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   home?: string,
 *   activeSessionsPath?: string,
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
  const active = readJsonSafe(activePath);

  // 1) Live sessions with focused project cwd (newest first)
  const live = projectFromSessions(active || [], {
    home,
    isAlive,
    requireAlive: true,
  });
  if (live) return live;

  // 2) Recently listed sessions (pid may have just exited)
  const recent = projectFromSessions(active || [], {
    home,
    isAlive,
    requireAlive: false,
  });
  if (recent) return recent;

  // 3) Env fallback (not locked) when Grok has no project-focused session
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
  resolveOpenProject,
};
