"use strict";

const { resolveOpenProject } = require("./project");
const { scoreProject } = require("./score");

/**
 * @typedef {{ kind: 'no-project'|'unreadable'|'unknown', message: string }} EfficiencyFault
 * @typedef {{
 *   architecture: number,
 *   codeEfficiency: number,
 *   uiPerfection: number,
 *   overall: number,
 *   projectName: string,
 *   projectRoot: string,
 *   hasUiSurface: boolean,
 *   fileCount: number,
 *   notes: string[],
 *   sessionId: string|null,
 *   source: string|null,
 * }} EfficiencyReading
 */

/** @type {Map<string, { mtimeMs: number, scores: import('./score').ProjectScores }>} */
const scoreCache = new Map();

/**
 * @param {unknown} err
 * @returns {EfficiencyFault}
 */
function classifyEfficiencyFault(err) {
  const message = err instanceof Error ? err.message : String(err);
  if (/no open project|no focused project/i.test(message)) {
    return { kind: "no-project", message };
  }
  if (/ENOENT|not a directory|unreadable/i.test(message)) {
    return { kind: "unreadable", message };
  }
  return { kind: "unknown", message };
}

/**
 * Directory mtime as a cheap "did tree change" signal.
 * @param {string} root
 */
function rootMtimeMs(root) {
  try {
    return require("fs").statSync(root).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Score with a short-lived cache so live project switches stay snappy,
 * while the same project isn't fully re-walked every few seconds.
 *
 * @param {string} root
 * @param {{ name?: string, score?: typeof scoreProject, cacheMs?: number }} [opts]
 */
function scoreProjectCached(root, opts = {}) {
  const score = opts.score || scoreProject;
  const mtimeMs = rootMtimeMs(root);
  const hit = scoreCache.get(root);
  if (hit && hit.mtimeMs === mtimeMs) {
    return hit.scores;
  }
  const scores = score(root, { name: opts.name });
  scoreCache.set(root, { mtimeMs, scores });
  // Bound memory if user hops many projects
  if (scoreCache.size > 24) {
    const first = scoreCache.keys().next().value;
    if (first) scoreCache.delete(first);
  }
  return scores;
}

/**
 * Snapshot efficiency scores for the *currently open* building project.
 * Always re-resolves the project from live Grok sessions (see project.js).
 *
 * @param {{
 *   resolveProject?: typeof resolveOpenProject,
 *   score?: typeof scoreProject,
 *   env?: NodeJS.ProcessEnv,
 *   useCache?: boolean,
 * }} [opts]
 * @returns {Promise<{ ok: true, reading: EfficiencyReading } | { ok: false, fault: EfficiencyFault }>}
 */
async function takeEfficiencyReading(opts = {}) {
  const resolveProject = opts.resolveProject || resolveOpenProject;
  const useCache = opts.useCache !== false;

  try {
    const project = resolveProject({ env: opts.env });
    if (!project) {
      return {
        ok: false,
        fault: {
          kind: "no-project",
          message:
            "No focused project — open Grok in a project folder (usage still tracks plan)",
        },
      };
    }

    const scores = useCache
      ? scoreProjectCached(project.root, {
          name: project.name,
          score: opts.score,
        })
      : (opts.score || scoreProject)(project.root, { name: project.name });

    return {
      ok: true,
      reading: {
        architecture: scores.architecture,
        codeEfficiency: scores.codeEfficiency,
        uiPerfection: scores.uiPerfection,
        overall: scores.overall,
        projectName: scores.projectName,
        projectRoot: scores.projectRoot,
        hasUiSurface: scores.hasUiSurface,
        fileCount: scores.fileCount,
        notes: scores.notes,
        sessionId: project.sessionId,
        source: project.source,
      },
    };
  } catch (err) {
    return { ok: false, fault: classifyEfficiencyFault(err) };
  }
}

/** @private test helper */
function clearScoreCache() {
  scoreCache.clear();
}

module.exports = {
  classifyEfficiencyFault,
  takeEfficiencyReading,
  scoreProjectCached,
  clearScoreCache,
};
