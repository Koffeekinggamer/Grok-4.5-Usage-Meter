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
  it("prefers live session project over GUM_PROJECT env", () => {
    const sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pem-sess-"));
    const envRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pem-env-"));
    fs.writeFileSync(path.join(sessionRoot, "package.json"), "{}");
    fs.writeFileSync(path.join(envRoot, "package.json"), "{}");
    const sessionsPath = path.join(sessionRoot, "active_sessions.json");
    fs.writeFileSync(
      sessionsPath,
      JSON.stringify([
        {
          session_id: "abc",
          pid: process.pid,
          cwd: sessionRoot,
          opened_at: "2026-08-01T12:00:00Z",
        },
      ])
    );
    try {
      const p = resolveOpenProject({
        env: { GUM_PROJECT: envRoot },
        home: os.homedir(),
        activeSessionsPath: sessionsPath,
        isAlive: () => true,
      });
      assert.ok(p);
      assert.equal(p.root, sessionRoot);
      assert.equal(p.source, "active-session");
    } finally {
      fs.rmSync(sessionRoot, { recursive: true, force: true });
      fs.rmSync(envRoot, { recursive: true, force: true });
    }
  });

  it("uses GUM_PROJECT only when no session project", () => {
    const envRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pem-env-only-"));
    fs.writeFileSync(path.join(envRoot, "package.json"), "{}");
    const sessionsPath = path.join(envRoot, "active_sessions.json");
    fs.writeFileSync(
      sessionsPath,
      JSON.stringify([
        {
          session_id: "home",
          pid: process.pid,
          cwd: os.homedir(),
          opened_at: "2026-08-01T12:00:00Z",
        },
      ])
    );
    try {
      const p = resolveOpenProject({
        env: { GUM_PROJECT: envRoot },
        home: os.homedir(),
        activeSessionsPath: sessionsPath,
        isAlive: () => true,
      });
      assert.ok(p);
      assert.equal(p.root, envRoot);
      assert.equal(p.source, "env");
    } finally {
      fs.rmSync(envRoot, { recursive: true, force: true });
    }
  });

  it("GUM_PROJECT_LOCK forces env over session", () => {
    const sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pem-lock-s-"));
    const envRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pem-lock-e-"));
    fs.writeFileSync(path.join(sessionRoot, "package.json"), "{}");
    fs.writeFileSync(path.join(envRoot, "package.json"), "{}");
    const sessionsPath = path.join(sessionRoot, "active_sessions.json");
    fs.writeFileSync(
      sessionsPath,
      JSON.stringify([
        {
          session_id: "abc",
          pid: process.pid,
          cwd: sessionRoot,
          opened_at: "2026-08-01T12:00:00Z",
        },
      ])
    );
    try {
      const p = resolveOpenProject({
        env: { GUM_PROJECT: envRoot, GUM_PROJECT_LOCK: "1" },
        home: os.homedir(),
        activeSessionsPath: sessionsPath,
        isAlive: () => true,
      });
      assert.ok(p);
      assert.equal(p.root, envRoot);
      assert.equal(p.source, "env");
    } finally {
      fs.rmSync(sessionRoot, { recursive: true, force: true });
      fs.rmSync(envRoot, { recursive: true, force: true });
    }
  });

  it("picks the newest focused session when several are open", () => {
    const older = fs.mkdtempSync(path.join(os.tmpdir(), "pem-old-"));
    const newer = fs.mkdtempSync(path.join(os.tmpdir(), "pem-new-"));
    fs.writeFileSync(path.join(older, "package.json"), "{}");
    fs.writeFileSync(path.join(newer, "package.json"), "{}");
    const sessionsPath = path.join(newer, "active_sessions.json");
    fs.writeFileSync(
      sessionsPath,
      JSON.stringify([
        {
          session_id: "old",
          pid: process.pid,
          cwd: older,
          opened_at: "2026-08-01T10:00:00Z",
        },
        {
          session_id: "new",
          pid: process.pid,
          cwd: newer,
          opened_at: "2026-08-01T14:00:00Z",
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
      assert.equal(p.root, newer);
      assert.equal(p.sessionId, "new");
    } finally {
      fs.rmSync(older, { recursive: true, force: true });
      fs.rmSync(newer, { recursive: true, force: true });
    }
  });
});
