#!/usr/bin/env node
"use strict";

/**
 * Live terminal view of the BML Process:
 *   - wall-clock elapsed for the whole run
 *   - skill chain 1–13 progress
 *   - full prompts the coach injects into Grok
 *
 * Usage:
 *   npm run bml-live
 *   node scripts/bml-live.js --once
 */

const fs = require("fs");
const path = require("path");
const { defaultStatePath, loadBmlState } = require("../src/lib/bml/state");
const { renderBmlLive, ANSI } = require("../src/lib/bml/live-view");
const {
  promptLogPaths,
  readLatestPrompt,
} = require("../src/lib/bml/prompt-log");

const once = process.argv.includes("--once");
const noColor =
  process.argv.includes("--no-color") ||
  process.env.NO_COLOR === "1" ||
  !process.stdout.isTTY;

const statePath = process.env.GUM_BML_STATE || defaultStatePath();
const paths = promptLogPaths({ statePath });

function readState() {
  try {
    if (!fs.existsSync(statePath)) return null;
    return loadBmlState(statePath);
  } catch {
    return null;
  }
}

function frame() {
  const state = readState();
  const promptText = readLatestPrompt({ statePath, maxChars: 16_000 });
  const width = process.stdout.columns || 72;
  const body = renderBmlLive(state || {}, {
    color: !noColor,
    now: Date.now(),
    width,
    promptText,
    maxPromptLines: Math.max(12, Math.min(50, (process.stdout.rows || 40) - 28)),
  });
  if (once || !process.stdout.isTTY) {
    process.stdout.write(body);
    return state;
  }
  process.stdout.write(ANSI.clearHome + ANSI.hideCursor + body);
  process.stdout.write(
    (noColor ? "" : ANSI.dim) +
      `state: ${statePath}\nprompts: ${paths.latest}` +
      (noColor ? "" : ANSI.reset) +
      "\n"
  );
  return state;
}

function intervalFor(state) {
  // Tick elapsed live while running; still refresh often enough for prompts
  if (state?.runCost?.running) return 250;
  return 500;
}

if (once) {
  frame();
  process.exit(0);
}

let timer = null;

function tick() {
  const state = frame();
  const ms = intervalFor(state);
  timer = setTimeout(tick, ms);
}

function shutdown() {
  if (timer) clearTimeout(timer);
  if (process.stdout.isTTY) process.stdout.write(ANSI.showCursor);
  process.stdout.write("\n");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

tick();

// React immediately when Meter writes state or a new prompt
function watchMaybe(file) {
  try {
    fs.watch(file, { persistent: true }, () => frame());
  } catch {
    // optional
  }
}
watchMaybe(path.dirname(statePath));
watchMaybe(paths.latest);
