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
 * Snapshot efficiency scores for the open building project.
 * @param {{
 *   resolveProject?: typeof resolveOpenProject,
 *   score?: typeof scoreProject,
 *   env?: NodeJS.ProcessEnv,
 * }} [opts]
 * @returns {Promise<{ ok: true, reading: EfficiencyReading } | { ok: false, fault: EfficiencyFault }>}
 */
async function takeEfficiencyReading(opts = {}) {
  const resolveProject = opts.resolveProject || resolveOpenProject;
  const score = opts.score || scoreProject;

  try {
    const project = resolveProject({ env: opts.env });
    if (!project) {
      return {
        ok: false,
        fault: {
          kind: "no-project",
          message:
            "No focused project — open Grok in a project folder or set GUM_PROJECT",
        },
      };
    }

    const scores = score(project.root, { name: project.name });
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

module.exports = {
  classifyEfficiencyFault,
  takeEfficiencyReading,
};
