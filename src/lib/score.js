"use strict";

const fs = require("fs");
const path = require("path");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".tox",
  "target",
  "vendor",
  ".idea",
  ".vscode",
  "Pods",
  "DerivedData",
  ".grok",
]);

const SOURCE_EXT = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".cs",
  ".php",
  ".vue",
  ".svelte",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".htm",
  ".jsx",
  ".tsx",
  ".mdx",
  ".dart",
  ".elm",
]);

const UI_EXT = new Set([
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".htm",
  ".jsx",
  ".tsx",
  ".vue",
  ".svelte",
  ".mdx",
]);

/**
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
 * }} ProjectScores
 */

/**
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 */
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * @param {number} points
 * @param {number} max
 */
function pct(points, max) {
  if (max <= 0) return 0;
  return clamp(Math.round((points / max) * 100), 0, 100);
}

/**
 * Walk project tree collecting lightweight stats.
 * @param {string} root
 * @param {{ maxFiles?: number, maxDepth?: number }} [opts]
 */
function scanProject(root, opts = {}) {
  const maxFiles = opts.maxFiles ?? 2500;
  const maxDepth = opts.maxDepth ?? 8;

  /** @type {string[]} */
  const files = [];
  /** @type {Map<string, number>} */
  const extCounts = new Map();
  let totalBytes = 0;
  let maxBytes = 0;
  let maxLines = 0;
  let godFiles = 0;
  let testFiles = 0;
  let uiFiles = 0;
  let a11yHits = 0;
  let mediaQueryHits = 0;
  let depthMax = 0;

  const rootResolved = path.resolve(root);

  /**
   * @param {string} dir
   * @param {number} depth
   */
  function walk(dir, depth) {
    if (files.length >= maxFiles || depth > maxDepth) return;
    depthMax = Math.max(depthMax, depth);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const name = entry.name;
      if (name.startsWith(".") && name !== ".github" && name !== ".gitignore") {
        if (entry.isDirectory() && !SKIP_DIRS.has(name) && name !== ".github") {
          // skip most dot dirs
          continue;
        }
        if (entry.isFile() && name !== ".gitignore") continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        walk(path.join(dir, name), depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;

      const full = path.join(dir, name);
      const ext = path.extname(name).toLowerCase();
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.size > 1_500_000) continue; // skip huge blobs

      files.push(full);
      extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
      totalBytes += st.size;
      maxBytes = Math.max(maxBytes, st.size);

      const lower = name.toLowerCase();
      if (
        /\.(test|spec)\./i.test(name) ||
        /(^|[/\\])(tests?|__tests__)[/\\]/i.test(full) ||
        lower.endsWith("_test.py") ||
        lower.endsWith("_test.go")
      ) {
        testFiles += 1;
      }
      if (UI_EXT.has(ext) || /components?|ui|views?|screens?|pages?/i.test(full)) {
        if (UI_EXT.has(ext) || /\.(jsx|tsx|vue|svelte)$/i.test(name)) {
          uiFiles += 1;
        }
      }

      // Sample text files under 200KB for a11y / responsive signals
      if (st.size < 200_000 && SOURCE_EXT.has(ext)) {
        try {
          const sample = fs.readFileSync(full, "utf8");
          const lines = sample.split(/\r?\n/).length;
          maxLines = Math.max(maxLines, lines);
          if (lines > 800) godFiles += 1;
          if (/\baria-[\w-]+|\brole\s*=/i.test(sample)) a11yHits += 1;
          if (/@media\b/i.test(sample)) mediaQueryHits += 1;
        } catch {
          // binary or unreadable
        }
      }
    }
  }

  walk(rootResolved, 0);

  return {
    files,
    extCounts,
    totalBytes,
    maxBytes,
    maxLines,
    godFiles,
    testFiles,
    uiFiles,
    a11yHits,
    mediaQueryHits,
    depthMax,
    fileCount: files.length,
  };
}

/**
 * @param {string} root
 * @param {string} rel
 */
function exists(root, rel) {
  try {
    return fs.existsSync(path.join(root, rel));
  } catch {
    return false;
  }
}

/**
 * @param {string} root
 * @param {string[]} names
 */
function anyExists(root, names) {
  return names.some((n) => exists(root, n));
}

/**
 * Architecture / code-quality score 0–100.
 * @param {string} root
 * @param {ReturnType<typeof scanProject>} scan
 * @param {string[]} notes
 */
function scoreArchitecture(root, scan, notes) {
  let points = 0;
  const max = 100;

  if (
    anyExists(root, [
      "package.json",
      "pyproject.toml",
      "Cargo.toml",
      "go.mod",
      "composer.json",
      "Gemfile",
      "pom.xml",
      "requirements.txt",
    ])
  ) {
    points += 10;
  } else {
    notes.push("No package manifest");
  }

  if (anyExists(root, ["README.md", "README", "README.txt", "readme.md"])) {
    points += 8;
  } else {
    notes.push("Missing README");
  }

  if (anyExists(root, ["src", "lib", "app", "pkg", "internal", "cmd"])) {
    points += 12;
  }

  if (scan.testFiles > 0 || anyExists(root, ["test", "tests", "__tests__", "spec"])) {
    points += Math.min(14, 6 + scan.testFiles);
  } else {
    notes.push("No tests detected");
  }

  if (exists(root, ".gitignore")) points += 4;

  if (
    anyExists(root, [
      ".eslintrc",
      ".eslintrc.js",
      ".eslintrc.cjs",
      ".eslintrc.json",
      "eslint.config.js",
      "eslint.config.mjs",
      ".prettierrc",
      ".prettierrc.json",
      "prettier.config.js",
      "ruff.toml",
      ".flake8",
      "pyproject.toml",
      ".rubocop.yml",
      "rustfmt.toml",
    ])
  ) {
    points += 8;
  }

  if (
    anyExists(root, [
      "tsconfig.json",
      "jsconfig.json",
      "py.typed",
      "mypy.ini",
      "setup.cfg",
    ])
  ) {
    points += 8;
  }

  if (exists(root, ".github/workflows") || exists(root, ".gitlab-ci.yml")) {
    points += 8;
  }

  if (anyExists(root, ["docs", "AGENTS.md", "CONTRIBUTING.md", "docs/"])) {
    points += 6;
  }

  // Separation: multiple source files, not a monofile
  const sourceCount = scan.files.filter((f) =>
    SOURCE_EXT.has(path.extname(f).toLowerCase())
  ).length;
  if (sourceCount >= 8) points += 10;
  else if (sourceCount >= 3) points += 6;
  else if (sourceCount === 1) {
    points += 2;
    notes.push("Single-file project");
  }

  if (scan.godFiles === 0) points += 8;
  else if (scan.godFiles <= 2) points += 4;
  else notes.push(`${scan.godFiles} very large source files`);

  if (anyExists(root, ["main.js", "main.ts", "index.js", "index.ts", "app.py", "main.py", "src/main.js", "src/index.ts"])) {
    points += 4;
  }

  return pct(points, max);
}

/**
 * Code efficiency score 0–100.
 * @param {string} root
 * @param {ReturnType<typeof scanProject>} scan
 * @param {string[]} notes
 */
function scoreCodeEfficiency(root, scan, notes) {
  let points = 0;
  const max = 100;

  const sourceFiles = scan.files.filter((f) =>
    SOURCE_EXT.has(path.extname(f).toLowerCase())
  );
  const n = sourceFiles.length || 1;
  const avgBytes = scan.totalBytes / n;

  // Lean average file size
  if (avgBytes < 4_000) points += 18;
  else if (avgBytes < 12_000) points += 14;
  else if (avgBytes < 30_000) points += 8;
  else {
    points += 3;
    notes.push("Large average file size");
  }

  // God-file pressure
  if (scan.godFiles === 0) points += 18;
  else if (scan.godFiles === 1) points += 10;
  else if (scan.godFiles <= 3) points += 5;
  else notes.push("God-file pressure");

  // Depth
  if (scan.depthMax <= 4) points += 12;
  else if (scan.depthMax <= 6) points += 8;
  else if (scan.depthMax <= 8) points += 4;
  else notes.push("Deep nesting");

  // Lockfile / reproducible installs
  if (
    anyExists(root, [
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lockb",
      "Cargo.lock",
      "poetry.lock",
      "Pipfile.lock",
      "go.sum",
      "composer.lock",
      "Gemfile.lock",
    ])
  ) {
    points += 10;
  }

  // Dependency bulk (JS)
  try {
    const pkgPath = path.join(root, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const deps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };
      const depCount = Object.keys(deps).length;
      if (depCount === 0) points += 12;
      else if (depCount <= 15) points += 14;
      else if (depCount <= 40) points += 10;
      else if (depCount <= 80) points += 5;
      else {
        points += 1;
        notes.push(`${depCount} npm dependencies`);
      }
    } else {
      points += 8; // non-JS: neutral credit
    }
  } catch {
    points += 4;
  }

  // File count sweet spot
  if (scan.fileCount === 0) {
    points += 0;
  } else if (scan.fileCount <= 80) points += 12;
  else if (scan.fileCount <= 250) points += 10;
  else if (scan.fileCount <= 800) points += 6;
  else {
    points += 2;
    notes.push("Very large tree");
  }

  // Extension chaos
  const exts = [...scan.extCounts.keys()].filter((e) => e && SOURCE_EXT.has(e));
  if (exts.length > 0 && exts.length <= 6) points += 8;
  else if (exts.length <= 10) points += 5;
  else points += 2;

  // Tests present help efficiency confidence
  if (scan.testFiles > 0) points += 6;

  return pct(points, max);
}

/**
 * UI perfection score 0–100.
 * @param {string} root
 * @param {ReturnType<typeof scanProject>} scan
 * @param {string[]} notes
 */
function scoreUiPerfection(root, scan, notes) {
  let points = 0;
  const max = 100;

  const hasStyles = anyExists(root, [
    "styles.css",
    "style.css",
    "globals.css",
    "src/styles.css",
    "src/index.css",
    "src/app.css",
    "app/globals.css",
  ]) ||
    [...scan.extCounts.keys()].some((e) =>
      [".css", ".scss", ".sass", ".less"].includes(e)
    );

  const hasComponents =
    anyExists(root, [
      "components",
      "src/components",
      "app/components",
      "ui",
      "src/ui",
      "views",
      "src/views",
      "pages",
      "src/pages",
    ]) || scan.uiFiles >= 2;

  const hasMarkup =
    scan.extCounts.has(".html") ||
    scan.extCounts.has(".htm") ||
    scan.extCounts.has(".jsx") ||
    scan.extCounts.has(".tsx") ||
    scan.extCounts.has(".vue") ||
    scan.extCounts.has(".svelte") ||
    anyExists(root, ["index.html", "public/index.html", "src/renderer/index.html"]);

  const hasUiSurface = hasStyles || hasComponents || hasMarkup || scan.uiFiles > 0;

  if (!hasUiSurface) {
    notes.push("No UI surface");
    // Backend / CLI: modest score for docs polish only
    if (anyExists(root, ["README.md", "docs"])) points += 25;
    if (exists(root, "AGENTS.md")) points += 10;
    return { score: pct(points, max), hasUiSurface: false };
  }

  if (hasStyles) points += 16;
  else notes.push("No stylesheets");

  if (hasComponents) points += 14;
  if (hasMarkup) points += 12;

  if (scan.uiFiles >= 5) points += 10;
  else if (scan.uiFiles >= 2) points += 6;

  if (scan.a11yHits > 0) points += Math.min(14, 6 + scan.a11yHits);
  else notes.push("No a11y attributes found");

  if (scan.mediaQueryHits > 0) points += Math.min(10, 5 + scan.mediaQueryHits);
  else notes.push("No responsive @media");

  if (
    anyExists(root, [
      "tailwind.config.js",
      "tailwind.config.ts",
      "theme.css",
      "tokens.css",
      "src/theme",
      "styles/theme.css",
      "src/styles/tokens.css",
    ])
  ) {
    points += 10;
  }

  if (
    anyExists(root, [
      "favicon.ico",
      "favicon.png",
      "public/favicon.ico",
      "assets/favicon.png",
      "src/renderer/styles.css",
    ]) ||
    anyExists(root, ["assets", "public", "static", "images"])
  ) {
    points += 6;
  }

  // Design-system-ish naming
  const componentish = scan.files.filter((f) =>
    /components?|ui[/\\]/i.test(f)
  ).length;
  if (componentish >= 3) points += 8;
  else if (componentish >= 1) points += 4;

  return { score: pct(points, max), hasUiSurface: true };
}

/**
 * Score an open project on the three Meter criteria.
 * @param {string} root
 * @param {{ name?: string, maxFiles?: number }} [opts]
 * @returns {ProjectScores}
 */
function scoreProject(root, opts = {}) {
  const notes = [];
  if (!root || !fs.existsSync(root)) {
    return {
      architecture: 0,
      codeEfficiency: 0,
      uiPerfection: 0,
      overall: 0,
      projectName: opts.name || "?",
      projectRoot: root || "",
      hasUiSurface: false,
      fileCount: 0,
      notes: ["Project root missing"],
    };
  }

  const scan = scanProject(root, { maxFiles: opts.maxFiles });
  const architecture = scoreArchitecture(root, scan, notes);
  const codeEfficiency = scoreCodeEfficiency(root, scan, notes);
  const ui = scoreUiPerfection(root, scan, notes);
  const overall = Math.round(
    architecture * 0.4 + codeEfficiency * 0.35 + ui.score * 0.25
  );

  return {
    architecture,
    codeEfficiency,
    uiPerfection: ui.score,
    overall,
    projectName: opts.name || path.basename(root),
    projectRoot: path.resolve(root),
    hasUiSurface: ui.hasUiSurface,
    fileCount: scan.fileCount,
    notes: notes.slice(0, 6),
  };
}

module.exports = {
  scanProject,
  scoreArchitecture,
  scoreCodeEfficiency,
  scoreUiPerfection,
  scoreProject,
  SKIP_DIRS,
};
