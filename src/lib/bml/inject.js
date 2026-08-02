"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { resolveChatSession } = require("./active-session");
const { getGrokHome } = require("../paths");

/**
 * @typedef {{
 *   ok: boolean,
 *   method: 'resume'|'headless'|'clipboard'|'typed',
 *   detail?: string,
 *   stdout?: string,
 * }} InjectResult
 */

/**
 * Resolve `grok` binary path.
 * @param {{ env?: NodeJS.ProcessEnv, which?: (cmd: string) => string|null }} [opts]
 */
function resolveGrokBin(opts = {}) {
  const env = opts.env ?? process.env;
  if (env.GUM_GROK_BIN) return env.GUM_GROK_BIN;
  const home = env.HOME || os.homedir();
  const candidates = [
    path.join(home, ".grok", "bin", "grok"),
    path.join(home, ".local", "bin", "grok"),
    "grok",
  ];
  for (const c of candidates) {
    if (c === "grok") return c;
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {
      // try next
    }
  }
  return "grok";
}

/** @type {import('child_process').ChildProcess|null} */
let activeChild = null;

/**
 * Kill the in-flight grok inject process (if any). Used by BML Cancel.
 * @returns {boolean} true if a process was signaled
 */
function abortActiveInject() {
  if (!activeChild) return false;
  const child = activeChild;
  activeChild = null;
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
  // Escalate if still around shortly after
  setTimeout(() => {
    try {
      if (!child.killed) child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }, 400);
  return true;
}

/**
 * Run a command and collect stdout/stderr.
 * @param {string} bin
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, spawnImpl?: typeof spawn, timeoutMs?: number, trackActive?: boolean }} [opts]
 * @returns {Promise<{ code: number|null, stdout: string, stderr: string, aborted?: boolean }>}
 */
function runCommand(bin, args, opts = {}) {
  const spawnImpl = opts.spawnImpl || spawn;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const trackActive = opts.trackActive !== false;
  return new Promise((resolve) => {
    const child = spawnImpl(bin, args, {
      cwd: opts.cwd || process.cwd(),
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (trackActive) activeChild = child;
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      settled = true;
      if (trackActive && activeChild === child) activeChild = null;
      resolve({ code: null, stdout, stderr: stderr + "\n[timeout]" });
    }, timeoutMs);

    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (trackActive && activeChild === child) activeChild = null;
      resolve({ code: 1, stdout, stderr: String(err.message || err) });
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (trackActive && activeChild === child) activeChild = null;
      const aborted = signal === "SIGTERM" || signal === "SIGKILL";
      resolve({
        code,
        stdout,
        stderr: aborted ? (stderr || "") + "\n[aborted]" : stderr,
        aborted,
      });
    });
  });
}

/**
 * Write prompt to clipboard backup file and try pbcopy.
 * @param {string} prompt
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   writeFileSync?: typeof fs.writeFileSync,
 *   runCommand?: typeof runCommand,
 * }} [opts]
 * @returns {Promise<InjectResult>}
 */
async function copyPromptToClipboard(prompt, opts = {}) {
  const env = opts.env ?? process.env;
  const write = opts.writeFileSync || fs.writeFileSync;
  const grokHome = getGrokHome({ env });
  const copyPath = env.GROK_COPY_FILE || path.join(grokHome, "last-copy.txt");
  try {
    write(copyPath, prompt, "utf8");
  } catch (err) {
    return {
      ok: false,
      method: "clipboard",
      detail: `Failed to write copy file: ${err instanceof Error ? err.message : err}`,
    };
  }

  // pbcopy reads stdin on macOS
  if (process.platform === "darwin") {
    const r = await new Promise((resolve) => {
      const spawnImpl = opts.spawnImpl || spawn;
      const child = spawnImpl("pbcopy", [], {
        env: { ...process.env, ...env },
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr?.on("data", (d) => {
        stderr += String(d);
      });
      child.on("error", (err) => {
        resolve({ code: 1, stderr: String(err.message || err) });
      });
      child.on("close", (code) => resolve({ code, stderr }));
      child.stdin.write(prompt);
      child.stdin.end();
    });
    if (r.code === 0) {
      return {
        ok: true,
        method: "clipboard",
        detail: `Copied to clipboard (backup: ${copyPath}). Paste into Grok (⌘V).`,
      };
    }
  }

  return {
    ok: true,
    method: "clipboard",
    detail: `Prompt saved to ${copyPath}. Paste into Grok.`,
  };
}

/**
 * Inject a BML skill prompt into Grok (cascade).
 * @param {string} prompt
 * @param {{
 *   preferCwd?: string|null,
 *   env?: NodeJS.ProcessEnv,
 *   resolveSession?: typeof resolveChatSession,
 *   runCommand?: typeof runCommand,
 *   copyPrompt?: typeof copyPromptToClipboard,
 *   spawnImpl?: typeof spawn,
 *   yolo?: boolean,
 * }} [opts]
 * @returns {Promise<InjectResult>}
 */
async function injectIntoGrok(prompt, opts = {}) {
  const env = opts.env ?? process.env;
  const resolve = opts.resolveSession || resolveChatSession;
  const run = opts.runCommand || runCommand;
  const copy = opts.copyPrompt || copyPromptToClipboard;
  const yolo =
    opts.yolo === true ||
    env.GUM_BML_YOLO === "1" ||
    env.GUM_BML_YOLO === "true";

  // Always bind inject to the active chat project when possible
  const session = resolve({
    env,
    preferCwd: opts.preferCwd || env.GUM_BML_CWD || null,
  });
  const grokBin = resolveGrokBin({ env });
  const cwd = session?.cwd || opts.preferCwd || process.cwd();

  /** @type {string[]} */
  const baseArgs = ["-p", prompt, "--cwd", cwd];
  if (yolo) baseArgs.push("--always-approve");

  // 1) Resume active session when possible
  if (session?.session_id) {
    const resumeArgs = [...baseArgs, "-r", session.session_id];
    const r = await run(grokBin, resumeArgs, {
      cwd,
      env,
      spawnImpl: opts.spawnImpl,
      timeoutMs: 180_000,
    });
    if (r.aborted) {
      return {
        ok: false,
        method: "resume",
        detail: "Cancelled during inject",
        stdout: r.stdout,
      };
    }
    if (r.code === 0) {
      return {
        ok: true,
        method: "resume",
        detail: `Injected into session ${session.session_id}`,
        stdout: r.stdout,
      };
    }
    // continue cascade
  }

  // 2) Headless new turn in cwd
  {
    const r = await run(grokBin, baseArgs, {
      cwd,
      env,
      spawnImpl: opts.spawnImpl,
      timeoutMs: 180_000,
    });
    if (r.aborted) {
      return {
        ok: false,
        method: "headless",
        detail: "Cancelled during inject",
        stdout: r.stdout,
      };
    }
    if (r.code === 0) {
      return {
        ok: true,
        method: "headless",
        detail: `Headless grok completed in ${cwd}`,
        stdout: r.stdout,
      };
    }
  }

  // 3) Clipboard fallback
  const clip = await copy(prompt, {
    env,
    spawnImpl: opts.spawnImpl,
    runCommand: run,
  });
  if (clip.ok) {
    return {
      ...clip,
      detail:
        (clip.detail || "Copied.") +
        " Headless inject failed; paste into the Grok TUI.",
    };
  }

  return {
    ok: false,
    method: "clipboard",
    detail: clip.detail || "All inject methods failed.",
  };
}

module.exports = {
  resolveGrokBin,
  runCommand,
  copyPromptToClipboard,
  injectIntoGrok,
  abortActiveInject,
};
