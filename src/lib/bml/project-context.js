"use strict";

/**
 * Active project facts for BML Build + Measure planning.
 * Prefers Terminal Grok's live session cwd (active_sessions.json).
 */

const fs = require("fs");
const path = require("path");
const { listActiveSessions, pickActiveSession } = require("./active-session");

/**
 * @typedef {{
 *   cwd: string,
 *   name: string|null,
 *   description: string|null,
 *   packageManager: string|null,
 *   scripts: string[],
 *   topLevel: string[],
 *   contextMd: string|null,
 *   contextExcerpt: string|null,
 *   readmeExcerpt: string|null,
 *   adrPaths: string[],
 *   gitRemote: string|null,
 *   sessionId: string|null,
 *   buildNatures: string[],
 *   measureNatures: string[],
 *   technicalHints: string[],
 * }} ProjectContext
 */

/**
 * @param {string} p
 * @param {{ readFileSync?: typeof fs.readFileSync, existsSync?: typeof fs.existsSync }} [io]
 */
function readTextSafe(p, io = {}) {
  const exists = io.existsSync || fs.existsSync;
  const read = io.readFileSync || fs.readFileSync;
  try {
    if (!exists(p)) return null;
    return String(read(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {string} p
 * @param {{ readFileSync?: typeof fs.readFileSync, existsSync?: typeof fs.existsSync }} [io]
 */
function readJsonSafe(p, io = {}) {
  const raw = readTextSafe(p, io);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {string} text
 * @param {number} max
 */
function excerpt(text, max = 2500) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (t.length <= max) return t;
  return t.slice(0, max) + "\n…[truncated]";
}

/**
 * Infer Build natures from project shape (what kind of smallest test to ship).
 * @param {{
 *   scripts: string[],
 *   topLevel: string[],
 *   hasContextMd: boolean,
 *   pkg: Record<string, unknown>|null,
 * }} info
 * @returns {string[]}
 */
function inferBuildNatures(info) {
  /** @type {string[]} */
  const natures = [];
  const scripts = new Set(info.scripts || []);
  const top = new Set((info.topLevel || []).map((s) => s.toLowerCase()));
  const deps = {
    ...(info.pkg?.dependencies || {}),
    ...(info.pkg?.devDependencies || {}),
  };

  natures.push(
    "Smallest vertical slice that proves the hypothesis in this repo (tracer bullet)."
  );

  if (scripts.has("test") || top.has("test") || top.has("tests") || top.has("__tests__")) {
    natures.push("Test-first slice via /implement → /tdd at existing seams.");
  }
  if (deps.electron || scripts.has("start") && String(info.pkg?.main || "").includes("main")) {
    natures.push("UI/overlay change with a visible acceptance criterion (screenshot or interaction).");
  }
  if (top.has("src") || top.has("lib") || top.has("app")) {
    natures.push("Code change under existing modules; prefer deepening over new packages.");
  }
  if (info.hasContextMd) {
    natures.push(
      "Respect domain language in CONTEXT.md; update glossary/ADRs via /grill-with-docs if terms shift."
    );
  }
  if (top.has("scripts") || top.has("ops") || top.has("sops")) {
    natures.push("Admin/ops automation: smallest script or SOP change that is runnable.");
  }
  if (top.has(".github")) {
    natures.push("If the bet needs tracking, ship issue template / label / project field only as needed.");
  }
  return natures;
}

/**
 * Infer Measure natures (what evidence to collect) from project shape.
 * @param {{
 *   scripts: string[],
 *   topLevel: string[],
 *   pkg: Record<string, unknown>|null,
 *   contextExcerpt: string|null,
 * }} info
 * @returns {string[]}
 */
function inferMeasureNatures(info) {
  /** @type {string[]} */
  const natures = [];
  const scripts = new Set(info.scripts || []);

  natures.push(
    "Pre-register numeric pass AND kill thresholds + duration before Build leaves the column."
  );
  natures.push(
    "Post weekly numbers on the experiment issue — Measure is data collection, not a dev queue."
  );

  if (scripts.has("test")) {
    natures.push("CI/test green rate or failing suite count can back instrumentation (not vanity alone).");
  }
  if (scripts.has("start") || scripts.has("dev")) {
    natures.push("User-visible success: completion rate, time-to-done, or error rate for the admin job.");
  }

  const ctx = String(info.contextExcerpt || "").toLowerCase();
  if (ctx.includes("plan usage") || ctx.includes("context usage") || ctx.includes("meter")) {
    natures.push(
      "Product meter metrics: plan % / context % / fault rate only if they map to the hypothesis."
    );
  }
  if (ctx.includes("watcher") || ctx.includes("session")) {
    natures.push("Session lifecycle signals (start/stop, single-instance) if the bet is reliability.");
  }

  natures.push(
    "Prefer outcome metrics over vanity (logins/pageviews). Kill is success when criteria hit."
  );
  return natures;
}

/**
 * @param {string} cwd
 * @param {{
 *   readdirSync?: typeof fs.readdirSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   existsSync?: typeof fs.existsSync,
 * }} [io]
 * @returns {string[]}
 */
function listTopLevel(cwd, io = {}) {
  const readdir = io.readdirSync || fs.readdirSync;
  try {
    return readdir(cwd, { withFileTypes: true })
      .filter((e) => !e.name.startsWith(".") || e.name === ".github" || e.name === ".grok")
      .map((e) => e.name)
      .sort()
      .slice(0, 40);
  } catch {
    return [];
  }
}

/**
 * @param {string} cwd
 * @param {{ existsSync?: typeof fs.existsSync, readdirSync?: typeof fs.readdirSync }} [io]
 */
function findAdrPaths(cwd, io = {}) {
  const exists = io.existsSync || fs.existsSync;
  const readdir = io.readdirSync || fs.readdirSync;
  /** @type {string[]} */
  const found = [];
  const candidates = [
    path.join(cwd, "docs", "adr"),
    path.join(cwd, "docs", "adrs"),
    path.join(cwd, "adr"),
    path.join(cwd, "ADRs"),
  ];
  for (const dir of candidates) {
    if (!exists(dir)) continue;
    try {
      for (const name of readdir(dir)) {
        if (/\.md$/i.test(name)) found.push(path.join(dir, name));
      }
    } catch {
      // ignore
    }
  }
  return found.slice(0, 12);
}

/**
 * @param {string} cwd
 * @param {{ readFileSync?: typeof fs.readFileSync, existsSync?: typeof fs.existsSync }} [io]
 */
function readGitRemote(cwd, io = {}) {
  const cfg = readTextSafe(path.join(cwd, ".git", "config"), io);
  if (!cfg) return null;
  const m = cfg.match(/\[remote "origin"\][\s\S]*?url\s*=\s*(.+)/);
  return m ? m[1].trim() : null;
}

/**
 * Load project context for a cwd.
 * @param {string} cwd
 * @param {{
 *   sessionId?: string|null,
 *   readdirSync?: typeof fs.readdirSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   existsSync?: typeof fs.existsSync,
 * }} [opts]
 * @returns {ProjectContext}
 */
function loadProjectAt(cwd, opts = {}) {
  const io = {
    readdirSync: opts.readdirSync,
    readFileSync: opts.readFileSync,
    existsSync: opts.existsSync,
  };
  const root = path.resolve(cwd);
  const pkg = readJsonSafe(path.join(root, "package.json"), io);
  const scripts = pkg?.scripts && typeof pkg.scripts === "object"
    ? Object.keys(/** @type {object} */ (pkg.scripts))
    : [];
  const topLevel = listTopLevel(root, io);
  const contextPath = path.join(root, "CONTEXT.md");
  const contextMd = readTextSafe(contextPath, io);
  const readme =
    readTextSafe(path.join(root, "README.md"), io) ||
    readTextSafe(path.join(root, "readme.md"), io);
  const contextExcerpt = excerpt(contextMd, 3000);
  const hasContextMd = Boolean(contextMd);

  const buildNatures = inferBuildNatures({
    scripts,
    topLevel,
    hasContextMd,
    pkg,
  });
  const measureNatures = inferMeasureNatures({
    scripts,
    topLevel,
    pkg,
    contextExcerpt,
  });

  /** @type {string[]} */
  const technicalHints = [];
  if (hasContextMd) technicalHints.push("@CONTEXT.md");
  if (topLevel.includes("src")) technicalHints.push("@src");
  if (topLevel.includes("scripts")) technicalHints.push("@scripts");
  if (topLevel.includes("test") || topLevel.includes("tests")) {
    technicalHints.push(topLevel.includes("test") ? "@test" : "@tests");
  }
  if (topLevel.includes("docs")) technicalHints.push("@docs");

  let packageManager = null;
  const exists = io.existsSync || fs.existsSync;
  if (exists(path.join(root, "pnpm-lock.yaml"))) packageManager = "pnpm";
  else if (exists(path.join(root, "yarn.lock"))) packageManager = "yarn";
  else if (exists(path.join(root, "package-lock.json"))) packageManager = "npm";

  return {
    cwd: root,
    name: typeof pkg?.name === "string" ? pkg.name : path.basename(root),
    description: typeof pkg?.description === "string" ? pkg.description : null,
    packageManager,
    scripts,
    topLevel,
    contextMd: contextPath,
    contextExcerpt,
    readmeExcerpt: excerpt(readme, 1200),
    adrPaths: findAdrPaths(root, io),
    gitRemote: readGitRemote(root, io),
    sessionId: opts.sessionId || null,
    buildNatures,
    measureNatures,
    technicalHints,
  };
}

/**
 * Resolve active project from Grok session (preferred) or env/cwd fallback.
 * @param {{
 *   preferCwd?: string|null,
 *   env?: NodeJS.ProcessEnv,
 *   listSessions?: typeof listActiveSessions,
 *   pickSession?: typeof pickActiveSession,
 *   loadAt?: typeof loadProjectAt,
 * }} [opts]
 * @returns {ProjectContext}
 */
function loadActiveProjectContext(opts = {}) {
  const env = opts.env ?? process.env;
  const list = opts.listSessions || listActiveSessions;
  const pick = opts.pickSession || pickActiveSession;
  const loadAt = opts.loadAt || loadProjectAt;

  const sessions = list({ env });
  const prefer =
    opts.preferCwd ||
    env.GUM_BML_CWD ||
    env.GUM_PROJECT_CWD ||
    null;
  const session = pick(sessions, { preferCwd: prefer });
  const cwd =
    session?.cwd ||
    prefer ||
    process.cwd();

  return loadAt(cwd, { sessionId: session?.session_id || null });
}

/**
 * Markdown block for inject prompts — Build/Measure natures from the active project.
 * @param {ProjectContext} project
 * @returns {string}
 */
function formatProjectContextForPrompt(project) {
  if (!project?.cwd) return "";
  const lines = [
    "## Active project (source of Build + Measure nature)",
    `Path: ${project.cwd}`,
    project.name ? `Name: ${project.name}` : null,
    project.description ? `Description: ${project.description}` : null,
    project.gitRemote ? `Git remote: ${project.gitRemote}` : null,
    project.sessionId ? `Grok session: ${project.sessionId}` : null,
    project.packageManager ? `Package manager: ${project.packageManager}` : null,
    project.scripts?.length
      ? `Scripts: ${project.scripts.slice(0, 20).join(", ")}`
      : null,
    project.topLevel?.length
      ? `Top-level: ${project.topLevel.slice(0, 24).join(", ")}`
      : null,
    project.technicalHints?.length
      ? `Technical Context hints: ${project.technicalHints.join(" ")}`
      : null,
    "",
    "### Build nature (plan the smallest test from THIS repo)",
    ...(project.buildNatures || []).map((n) => `- ${n}`),
    "",
    "### Measure nature (plan evidence from THIS repo's reality)",
    ...(project.measureNatures || []).map((n) => `- ${n}`),
  ].filter((l) => l != null);

  if (project.contextExcerpt) {
    lines.push(
      "",
      "### CONTEXT.md (domain language — use these terms)",
      project.contextExcerpt
    );
  } else {
    lines.push(
      "",
      "### CONTEXT.md",
      "(missing — /grill-with-docs should establish domain language)"
    );
  }

  if (project.readmeExcerpt) {
    lines.push("", "### README excerpt", project.readmeExcerpt);
  }

  if (project.adrPaths?.length) {
    lines.push(
      "",
      "### ADRs present",
      ...project.adrPaths.map((p) => `- ${p}`)
    );
  }

  lines.push(
    "",
    "### Rules",
    "- Build and Measure sections of the experiment ticket MUST reflect this project, not generic advice.",
    "- Prefer existing scripts, modules, and seams listed above.",
    "- Technical Context / References must @ real folders/files from this tree for /grill-with-docs."
  );

  return lines.join("\n");
}

/**
 * Suggest Technical Context string from project.
 * @param {ProjectContext} project
 */
function suggestTechnicalContext(project) {
  const hints = project?.technicalHints?.length
    ? project.technicalHints
    : ["@."];
  return `${hints.join(" ")} (${project?.cwd || "project root"})`;
}

module.exports = {
  loadProjectAt,
  loadActiveProjectContext,
  formatProjectContextForPrompt,
  suggestTechnicalContext,
  inferBuildNatures,
  inferMeasureNatures,
  excerpt,
};
