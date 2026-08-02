"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  looksLikeGrokProcess,
  parsePsTable,
  isGrokProcessRunning,
  hasLiveActiveSession,
  isTerminalGrokOpen,
} = require("../src/lib/grok-presence");

describe("looksLikeGrokProcess", () => {
  it("matches bare macOS grok process", () => {
    assert.equal(looksLikeGrokProcess({ comm: "grok", args: "grok" }), true);
  });

  it("matches ~/.grok/bin/grok path", () => {
    assert.equal(
      looksLikeGrokProcess({
        comm: "grok",
        args: "/Users/x/.grok/bin/grok --fullscreen",
      }),
      true
    );
  });

  it("rejects the Meter and Watcher", () => {
    assert.equal(
      looksLikeGrokProcess({
        comm: "node",
        args: "node /Users/x/Grok Usage Meter/scripts/watch-grok.js",
      }),
      false
    );
    assert.equal(
      looksLikeGrokProcess({
        comm: "Electron",
        args: "/Users/x/Grok Usage Meter/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .",
      }),
      false
    );
  });
});

describe("parsePsTable + isGrokProcessRunning", () => {
  it("finds grok among mixed rows", () => {
    const ps = `
  100 zsh -zsh
70304 grok grok
  200 node /tmp/foo
`;
    const rows = parsePsTable(ps);
    assert.equal(rows.length, 3);
    assert.equal(isGrokProcessRunning({ psOutput: ps }), true);
    assert.equal(
      isGrokProcessRunning({
        psOutput: "  100 zsh -zsh\n  200 node /tmp/foo\n",
      }),
      false
    );
  });
});

describe("hasLiveActiveSession", () => {
  it("requires a live pid from active_sessions.json", () => {
    const live = hasLiveActiveSession({
      readFile: () =>
        JSON.stringify([{ session_id: "s1", pid: 42, cwd: "/tmp" }]),
      isAlive: (pid) => pid === 42,
    });
    assert.equal(live, true);

    const dead = hasLiveActiveSession({
      readFile: () =>
        JSON.stringify([{ session_id: "s1", pid: 42, cwd: "/tmp" }]),
      isAlive: () => false,
    });
    assert.equal(dead, false);
  });
});

describe("isTerminalGrokOpen", () => {
  it("is true if either process or live session", () => {
    assert.equal(
      isTerminalGrokOpen({
        psOutput: "  1 zsh -zsh\n",
        readFile: () => JSON.stringify([{ pid: 9 }]),
        isAlive: (pid) => pid === 9,
      }),
      true
    );
    assert.equal(
      isTerminalGrokOpen({
        psOutput: "70304 grok grok\n",
        readFile: () => {
          throw new Error("no file");
        },
      }),
      true
    );
    assert.equal(
      isTerminalGrokOpen({
        psOutput: "  1 zsh -zsh\n",
        readFile: () => JSON.stringify([{ pid: 9 }]),
        isAlive: () => false,
      }),
      false
    );
  });
});
