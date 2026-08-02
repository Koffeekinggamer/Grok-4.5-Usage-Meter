"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const MIN_TARGET = 80;

/**
 * @typedef {{
 *   architecture: number,
 *   codeEfficiency: number,
 *   uiPerfection: number,
 *   overall?: number,
 *   projectName: string,
 *   projectRoot: string,
 *   hasUiSurface?: boolean,
 *   notes?: string[],
 * }} BoostTarget
 */

/**
 * Locate the grok CLI binary.
 * @param {{ env?: NodeJS.ProcessEnv, home?: string }} [opts]
 * @returns {string}
 */
function resolveGrokBin(opts = {}) {
  const env = opts.env ?? process.env;
  if (env.GUM_GROK_BIN && fs.existsSync(env.GUM_GROK_BIN)) {
    return env.GUM_GROK_BIN;
  }
  const home = opts.home ?? os.homedir();
  const candidates = [
    path.join(home, ".grok", "bin", "grok"),
    path.join(home, ".local", "bin", "grok"),
    "/usr/local/bin/grok",
    "grok",
  ];
  for (const c of candidates) {
    if (c === "grok") return c;
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      // skip
    }
  }
  return "grok";
}

/**
 * Build the carte-blanche boost prompt for Grok headless.
 * @param {BoostTarget} reading
 * @param {{ minTarget?: number }} [opts]
 */
function buildBoostPrompt(reading, opts = {}) {
  const min = opts.minTarget ?? MIN_TARGET;
  const arch = Math.round(Number(reading.architecture) || 0);
  const eff = Math.round(Number(reading.codeEfficiency) || 0);
  const ui = Math.round(Number(reading.uiPerfection) || 0);
  const notes = Array.isArray(reading.notes) ? reading.notes.filter(Boolean) : [];
  const gaps = [];
  if (arch < min) gaps.push(`Architecture ${arch}% → ≥${min}%`);
  if (eff < min) gaps.push(`Code efficiency ${eff}% → ≥${min}%`);
  if (ui < min) gaps.push(`UI perfection ${ui}% → ≥${min}%`);

  const gapBlock =
    gaps.length > 0
      ? gaps.map((g) => `- ${g}`).join("\n")
      : `- All three already ≥${min}%. Still tighten weak spots and re-verify.`;

  return `You have CARTE BLANCHE to improve this codebase. Do not ask for permission. Implement changes freely.

## Project
- Root: ${reading.projectRoot}
- Name: ${reading.projectName}
- UI surface detected: ${reading.hasUiSurface === false ? "no (backend/CLI — polish docs/CLI UX for UI score)" : "yes"}

## Current Project Efficiency Meter scores (0–100)
- Architecture / code quality: ${arch}%
- Code efficiency: ${eff}%
- UI perfection: ${ui}%

## Goal
Raise **every** criterion to a **minimum of ${min}%**.
Keep iterating until Architecture ≥ ${min}, Code efficiency ≥ ${min}, and UI perfection ≥ ${min}.

Gaps to close:
${gapBlock}

${notes.length ? `Scanner notes:\n${notes.map((n) => `- ${n}`).join("\n")}\n` : ""}
## What the meter rewards (raise these deliberately)

**Architecture / code quality**
- Clear modules (src/lib/app), tests, README, .gitignore
- Lint/format + types (eslint/prettier/tsconfig/ruff/mypy)
- CI workflows, docs/AGENTS.md, separation of concerns
- Avoid god files (>800 LOC)

**Code efficiency**
- Lean average file size, few god files, shallow nesting
- Lockfiles, controlled dependency count
- Focused tree (not thousands of source files without structure)

**UI perfection**
- Stylesheets, components/ui folders, real markup (HTML/JSX/Vue/etc.)
- a11y (aria-*, role=), responsive @media
- Design tokens/theme, assets/favicon when applicable

## Rules of engagement
1. Work only under the project root above (unless a monorepo subpackage is clearly the target).
2. Prefer real structural fixes over cosmetic renames.
3. Run existing tests / add tests where architecture needs them.
4. When finished, summarize deltas that should move each meter bar and list remaining risks.
5. If a score cannot honestly hit ${min}% (e.g. pure library with no UI), push it as high as practical and state the ceiling.

Begin now. Build as needed.`;
}

/**
 * @typedef {{
 *   ok: true,
 *   pid: number,
 *   promptFile: string,
 *   logFile: string,
 *   projectRoot: string,
 * } | {
 *   ok: false,
 *   error: string,
 * }} BoostLaunchResult
 */

/**
 * Launch Grok headless with carte blanche to boost scores.
 * Detached process — does not block the Meter.
 *
 * @param {BoostTarget} reading
 * @param {{
 *   grokBin?: string,
 *   minTarget?: number,
 *   spawnImpl?: typeof spawn,
 *   env?: NodeJS.ProcessEnv,
 * }} [opts]
 * @returns {BoostLaunchResult}
 */
function launchBoost(reading, opts = {}) {
  if (!reading?.projectRoot) {
    return { ok: false, error: "No project root to boost" };
  }
  try {
    if (!fs.statSync(reading.projectRoot).isDirectory()) {
      return { ok: false, error: "Project root is not a directory" };
    }
  } catch {
    return { ok: false, error: "Project root missing" };
  }

  const prompt = buildBoostPrompt(reading, { minTarget: opts.minTarget });
  const stamp = Date.now();
  const promptFile = path.join(os.tmpdir(), `gum-boost-${stamp}.txt`);
  const logFile = path.join(os.tmpdir(), `gum-boost-${stamp}.log`);
  fs.writeFileSync(promptFile, prompt, "utf8");

  const grokBin = opts.grokBin || resolveGrokBin({ env: opts.env });
  const spawnImpl = opts.spawnImpl || spawn;

  const args = [
    "--prompt-file",
    promptFile,
    "--cwd",
    reading.projectRoot,
    "--yolo",
    "--always-approve",
  ];

  try {
    const logFd = fs.openSync(logFile, "a");
    const child = spawnImpl(grokBin, args, {
      cwd: reading.projectRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...(opts.env || process.env),
        // Never inherit a locked project from the Meter process
        GUM_PROJECT: reading.projectRoot,
      },
    });
    fs.closeSync(logFd);

    if (child.pid == null) {
      return { ok: false, error: "Failed to spawn grok" };
    }
    child.unref();
    return {
      ok: true,
      pid: child.pid,
      promptFile,
      logFile,
      projectRoot: reading.projectRoot,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * True when every score is already at/above the target.
 * @param {BoostTarget} reading
 * @param {number} [minTarget]
 */
function alreadyAtTarget(reading, minTarget = MIN_TARGET) {
  return (
    Number(reading.architecture) >= minTarget &&
    Number(reading.codeEfficiency) >= minTarget &&
    Number(reading.uiPerfection) >= minTarget
  );
}

module.exports = {
  MIN_TARGET,
  resolveGrokBin,
  buildBoostPrompt,
  launchBoost,
  alreadyAtTarget,
};
