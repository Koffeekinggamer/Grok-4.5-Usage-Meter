"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  isFocusedProjectRoot,
  findProjectRoot,
  resolveOpenProject,
} = require("../src/lib/project");

describe("isFocusedProjectRoot", () => {
  it("rejects bare home", () => {
    assert.equal(isFocusedProjectRoot(os.homedir()), false);
  });

  it("accepts a real directory under home", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pem-proj-"));
    try {
      assert.equal(isFocusedProjectRoot(dir), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("findProjectRoot", () => {
  it("walks up to package.json", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pem-find-"));
    const nested = path.join(root, "src", "deep");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    try {
      assert.equal(findProjectRoot(nested, { home: os.tmpdir() }), root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("resolveOpenProject", () => {
  it("prefers GUM_PROJECT env", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pem-env-"));
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    try {
      const p = resolveOpenProject({
        env: { GUM_PROJECT: root },
        home: os.homedir(),
      });
      assert.ok(p);
      assert.equal(p.root, root);
      assert.equal(p.source, "env");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads alive active session cwd", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pem-sess-"));
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    const sessionsPath = path.join(root, "active_sessions.json");
    fs.writeFileSync(
      sessionsPath,
      JSON.stringify([
        {
          session_id: "abc",
          pid: process.pid,
          cwd: root,
        },
      ])
    );
    try {
      const p = resolveOpenProject({
        env: {},
        home: os.homedir(),
        activeSessionsPath: sessionsPath,
        isAlive: () => true,
      });
      assert.ok(p);
      assert.equal(p.root, root);
      assert.equal(p.sessionId, "abc");
      assert.equal(p.source, "active-session");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
