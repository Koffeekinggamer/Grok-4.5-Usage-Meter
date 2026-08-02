"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseSignals, readActiveContext } = require("../src/lib/context");

describe("parseSignals", () => {
  it("reads contextWindowUsage percent", () => {
    const parsed = parseSignals({
      contextWindowUsage: 42,
      contextTokensUsed: 210000,
      contextWindowTokens: 500000,
      primaryModelId: "grok-4.5",
    });
    assert.equal(parsed.percent, 42);
    assert.equal(parsed.model, "grok-4.5");
  });

  it("derives percent from tokens when usage missing", () => {
    const parsed = parseSignals({
      contextTokensUsed: 250000,
      contextWindowTokens: 500000,
    });
    assert.equal(parsed.percent, 50);
  });
});

describe("readActiveContext", () => {
  it("prefers the active session signals", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gum-ctx-"));
    const sessionsDir = path.join(root, "sessions");
    const cwdDir = path.join(sessionsDir, "encoded-cwd");
    const sessId = "sess-active-1";
    const sessDir = path.join(cwdDir, sessId);
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessDir, "signals.json"),
      JSON.stringify({
        contextWindowUsage: 33,
        contextTokensUsed: 100,
        contextWindowTokens: 300,
        primaryModelId: "grok-4.5",
      })
    );
    const activePath = path.join(root, "active_sessions.json");
    fs.writeFileSync(
      activePath,
      JSON.stringify([{ session_id: sessId, pid: 1, cwd: "/tmp" }])
    );

    const ctx = readActiveContext({
      activeSessionsPath: activePath,
      sessionsDir,
    });
    assert.equal(ctx.percent, 33);
    assert.equal(ctx.sessionId, sessId);
  });
});
