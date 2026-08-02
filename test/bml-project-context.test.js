"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  loadProjectAt,
  loadActiveProjectContext,
  formatProjectContextForPrompt,
  suggestTechnicalContext,
  inferBuildNatures,
  inferMeasureNatures,
} = require("../src/lib/bml/project-context");

describe("inferBuildNatures / inferMeasureNatures", () => {
  it("mentions tdd when tests exist", () => {
    const b = inferBuildNatures({
      scripts: ["test", "start"],
      topLevel: ["src", "test"],
      hasContextMd: true,
      pkg: { name: "demo" },
    });
    assert.ok(b.some((n) => /tdd|test/i.test(n)));
    assert.ok(b.some((n) => /CONTEXT/i.test(n)));

    const m = inferMeasureNatures({
      scripts: ["test"],
      topLevel: ["src"],
      pkg: {},
      contextExcerpt: "Plan usage and context usage on the Meter.",
    });
    assert.ok(m.some((n) => /pass AND kill|kill/i.test(n)));
    assert.ok(m.some((n) => /plan %|meter/i.test(n)));
  });
});

describe("loadProjectAt", () => {
  it("reads package.json and CONTEXT.md from a fixture tree", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-proj-"));
    try {
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({
          name: "admin-tools",
          description: "Ops automation",
          scripts: { test: "node --test", start: "node ." },
        })
      );
      fs.writeFileSync(
        path.join(dir, "CONTEXT.md"),
        "# Domain\n\n**Meter**: always-on-top overlay\n"
      );
      fs.mkdirSync(path.join(dir, "src"));
      fs.mkdirSync(path.join(dir, "test"));

      const p = loadProjectAt(dir);
      assert.equal(p.name, "admin-tools");
      assert.equal(p.description, "Ops automation");
      assert.ok(p.scripts.includes("test"));
      assert.ok(p.contextExcerpt && p.contextExcerpt.includes("Meter"));
      assert.ok(p.buildNatures.length >= 2);
      assert.ok(p.measureNatures.length >= 2);
      assert.ok(p.technicalHints.includes("@CONTEXT.md"));
      assert.ok(p.technicalHints.includes("@src"));

      const block = formatProjectContextForPrompt(p);
      assert.match(block, /Active project/);
      assert.match(block, /Build nature/);
      assert.match(block, /Measure nature/);
      assert.match(block, /admin-tools/);
      assert.match(block, /CONTEXT\.md/);

      assert.match(suggestTechnicalContext(p), /@CONTEXT\.md|@src/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("loadActiveProjectContext", () => {
  it("prefers active session cwd", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-sess-"));
    try {
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "from-session" })
      );
      const p = loadActiveProjectContext({
        preferCwd: dir,
        listSessions: () => [
          {
            session_id: "s1",
            cwd: dir,
            opened_at: "2026-08-02T00:00:00Z",
          },
        ],
      });
      assert.equal(p.cwd, path.resolve(dir));
      assert.equal(p.name, "from-session");
      assert.equal(p.sessionId, "s1");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
