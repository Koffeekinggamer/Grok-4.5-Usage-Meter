"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { injectIntoGrok } = require("../src/lib/bml/inject");

describe("injectIntoGrok", () => {
  it("prefers resume when session available and command succeeds", async () => {
    const calls = [];
    const result = await injectIntoGrok("/grill-with-docs\nhello", {
      preferCwd: "/proj",
      listSessions: () => [
        {
          session_id: "sess-1",
          cwd: "/proj",
          opened_at: "2026-08-01T00:00:00Z",
        },
      ],
      runCommand: async (bin, args) => {
        calls.push({ bin, args });
        return { code: 0, stdout: "ok", stderr: "" };
      },
      copyPrompt: async () => ({ ok: false, method: "clipboard" }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.method, "resume");
    assert.ok(calls[0].args.includes("-r"));
    assert.ok(calls[0].args.includes("sess-1"));
  });

  it("falls back to clipboard when headless fails", async () => {
    const result = await injectIntoGrok("prompt text", {
      listSessions: () => [],
      runCommand: async () => ({ code: 1, stdout: "", stderr: "locked" }),
      copyPrompt: async () => ({
        ok: true,
        method: "clipboard",
        detail: "copied",
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.method, "clipboard");
  });
});
