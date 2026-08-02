"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {
  getGrokHome,
  getAuthPath,
  getActiveSessionsPath,
  getSessionsDir,
} = require("../src/lib/paths");

describe("getGrokHome", () => {
  it("uses GROK_HOME when set", () => {
    assert.equal(
      getGrokHome({ home: "/Users/x", env: { GROK_HOME: "/custom/grok" } }),
      "/custom/grok"
    );
  });

  it("defaults to ~/.grok", () => {
    assert.equal(
      getGrokHome({ home: "/Users/x", env: {} }),
      path.join("/Users/x", ".grok")
    );
  });
});

describe("getAuthPath", () => {
  it("uses GROK_AUTH_JSON when set", () => {
    assert.equal(
      getAuthPath({ env: { GROK_AUTH_JSON: "/tmp/auth.json" } }),
      "/tmp/auth.json"
    );
  });

  it("resolves ~/.grok/auth.json", () => {
    assert.equal(
      getAuthPath({ home: "/Users/x", env: {} }),
      path.join("/Users/x", ".grok", "auth.json")
    );
  });
});

describe("session paths", () => {
  it("resolves active sessions and sessions dir", () => {
    assert.equal(
      getActiveSessionsPath({ home: "/Users/x", env: {} }),
      path.join("/Users/x", ".grok", "active_sessions.json")
    );
    assert.equal(
      getSessionsDir({ home: "/Users/x", env: {} }),
      path.join("/Users/x", ".grok", "sessions")
    );
  });
});
