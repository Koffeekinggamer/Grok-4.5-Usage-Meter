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
 *   source: 'env'|'active-session'|'session-dir',
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
 * Resolve the open building project for the Meter.
 *
 * Priority:
 * 1. PEM_PROJECT / GUM_PROJECT env
 * 2. Live active_sessions.json entry (alive pid, focused cwd)
 * 3. Newest session signals parent with cwd metadata if present
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
  if (fromEnv && isFocusedProjectRoot(fromEnv, { home })) {
    const root = findProjectRoot(fromEnv, { home }) || path.resolve(fromEnv);
    return {
      root,
      name: path.basename(root),
      sessionId: null,
      source: "env",
    };
  }

  const activePath = opts.activeSessionsPath || getActiveSessionsPath();
  const active = readJsonSafe(activePath);
  if (Array.isArray(active)) {
    for (const row of active) {
      const pid = Number(row?.pid);
      const cwd = row?.cwd;
      const sessionId = row?.session_id || null;
      if (!cwd || !Number.isFinite(pid) || !isAlive(pid)) continue;
      if (!isFocusedProjectRoot(cwd, { home })) continue;
      const root = findProjectRoot(cwd, { home }) || path.resolve(cwd);
      return {
        root,
        name: path.basename(root),
        sessionId,
        source: "active-session",
      };
    }
  }

  // Fallback: any active session cwd even if pid died recently
  if (Array.isArray(active)) {
    for (const row of active) {
      const cwd = row?.cwd;
      if (!cwd || !isFocusedProjectRoot(cwd, { home })) continue;
      const root = findProjectRoot(cwd, { home }) || path.resolve(cwd);
      return {
        root,
        name: path.basename(root),
        sessionId: row?.session_id || null,
        source: "active-session",
      };
    }
  }

  return null;
}

module.exports = {
  isFocusedProjectRoot,
  findProjectRoot,
  resolveOpenProject,
};
