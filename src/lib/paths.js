"use strict";

const os = require("os");
const path = require("path");

/**
 * Resolve the Grok home directory (~/.grok by default).
 * @param {{ home?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
function getGrokHome(opts = {}) {
  const home = opts.home ?? os.homedir();
  const env = opts.env ?? process.env;
  if (env.GROK_HOME) return env.GROK_HOME;
  return path.join(home, ".grok");
}

/**
 * Resolve path to Terminal Grok auth.json.
 * @param {{ home?: string, env?: NodeJS.ProcessEnv, grokHome?: string }} [opts]
 */
function getAuthPath(opts = {}) {
  const env = opts.env ?? process.env;
  if (env.GROK_AUTH_JSON) return env.GROK_AUTH_JSON;
  const grokHome = opts.grokHome ?? getGrokHome(opts);
  return path.join(grokHome, "auth.json");
}

/**
 * Resolve path to Terminal Grok active_sessions.json.
 * @param {{ home?: string, env?: NodeJS.ProcessEnv, grokHome?: string }} [opts]
 */
function getActiveSessionsPath(opts = {}) {
  const env = opts.env ?? process.env;
  if (env.GROK_ACTIVE_SESSIONS) return env.GROK_ACTIVE_SESSIONS;
  const grokHome = opts.grokHome ?? getGrokHome(opts);
  return path.join(grokHome, "active_sessions.json");
}

/**
 * Resolve path to Terminal Grok sessions directory.
 * @param {{ home?: string, env?: NodeJS.ProcessEnv, grokHome?: string }} [opts]
 */
function getSessionsDir(opts = {}) {
  const env = opts.env ?? process.env;
  if (env.GROK_SESSIONS_DIR) return env.GROK_SESSIONS_DIR;
  const grokHome = opts.grokHome ?? getGrokHome(opts);
  return path.join(grokHome, "sessions");
}

module.exports = {
  getGrokHome,
  getAuthPath,
  getActiveSessionsPath,
  getSessionsDir,
};
