"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  pickActiveSession,
  decodeSessionGroupName,
  resolveChatSession,
  isPidAlive,
} = require("../src/lib/bml/active-session");

describe("decodeSessionGroupName", () => {
  it("decodes URL-encoded absolute paths", () => {
    assert.equal(
      decodeSessionGroupName("%2FUsers%2Fme%2Ffaf-website"),
      "/Users/me/faf-website"
    );
  });
});

describe("pickActiveSession", () => {
  it("prefers live chat session over dead ones", () => {
    const picked = pickActiveSession([
      {
        session_id: "old",
        cwd: "/old",
        opened_at: "2026-08-01T00:00:00Z",
        live: false,
        source: "active_sessions",
      },
      {
        session_id: "live",
        cwd: "/chat-project",
        opened_at: "2026-08-02T00:00:00Z",
        live: true,
        source: "active_sessions",
      },
    ]);
    assert.equal(picked.cwd, "/chat-project");
    assert.equal(picked.session_id, "live");
  });

  it("uses freshest tree session when active_sessions empty", () => {
    const picked = pickActiveSession([], {
      treeSessions: [
        {
          session_id: "a",
          cwd: "/a",
          mtimeMs: 100,
          source: "sessions_tree",
        },
        {
          session_id: "b",
          cwd: "/b-chat",
          mtimeMs: 999,
          source: "sessions_tree",
        },
      ],
    });
    assert.equal(picked.cwd, "/b-chat");
  });
});

describe("resolveChatSession", () => {
  it("binds to active_sessions cwd for the chat project", () => {
    const s = resolveChatSession({
      listActive: () => [
        {
          session_id: "s1",
          cwd: "/Users/me/real-chat-app",
          opened_at: "2026-08-02T12:00:00Z",
          live: true,
          source: "active_sessions",
        },
      ],
      listTree: () => [
        {
          session_id: "other",
          cwd: "/Users/me/other",
          mtimeMs: Date.now(),
          source: "sessions_tree",
        },
      ],
    });
    assert.equal(s.cwd, "/Users/me/real-chat-app");
    assert.equal(s.session_id, "s1");
  });
});

describe("isPidAlive", () => {
  it("detects current process", () => {
    assert.equal(isPidAlive(process.pid), true);
  });
});
