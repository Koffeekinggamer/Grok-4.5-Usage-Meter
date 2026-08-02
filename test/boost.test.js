"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildBoostPrompt,
  alreadyAtTarget,
  launchBoost,
  MIN_TARGET,
} = require("../src/lib/boost");

const reading = {
  architecture: 70,
  codeEfficiency: 94,
  uiPerfection: 69,
  projectName: "demo",
  projectRoot: "/tmp/demo",
  hasUiSurface: true,
  notes: ["Missing README"],
};

describe("buildBoostPrompt", () => {
  it("includes scores, 80% goal, and carte blanche language", () => {
    const p = buildBoostPrompt(reading);
    assert.match(p, /CARTE BLANCHE/i);
    assert.match(p, /70%/);
    assert.match(p, /94%/);
    assert.match(p, /69%/);
    assert.match(p, new RegExp(String(MIN_TARGET)));
    assert.match(p, /Architecture/);
    assert.match(p, /Missing README/);
    assert.match(p, /demo/);
  });
});

describe("alreadyAtTarget", () => {
  it("is false when any bar is under 80", () => {
    assert.equal(alreadyAtTarget(reading), false);
  });

  it("is true when all bars meet the floor", () => {
    assert.equal(
      alreadyAtTarget({
        ...reading,
        architecture: 80,
        codeEfficiency: 90,
        uiPerfection: 80,
      }),
      true
    );
  });
});

describe("launchBoost", () => {
  it("writes prompt file and spawns grok with yolo flags", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gum-boost-"));
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    /** @type {string[][]} */
    const spawns = [];
    const result = launchBoost(
      { ...reading, projectRoot: root, projectName: "t" },
      {
        grokBin: "/usr/bin/true",
        spawnImpl: (bin, args, opts) => {
          spawns.push([bin, ...args]);
          assert.equal(opts.detached, true);
          return { pid: 4242, unref() {} };
        },
      }
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.pid, 4242);
      assert.ok(fs.existsSync(result.promptFile));
      const body = fs.readFileSync(result.promptFile, "utf8");
      assert.match(body, /CARTE BLANCHE/i);
      assert.ok(spawns[0].includes("--prompt-file"));
      assert.ok(spawns[0].includes("--yolo"));
      assert.ok(spawns[0].includes("--always-approve"));
      assert.ok(spawns[0].includes("--cwd"));
      assert.ok(spawns[0].includes(root));
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("fails without a project root", () => {
    const result = launchBoost({
      architecture: 1,
      codeEfficiency: 1,
      uiPerfection: 1,
      projectName: "x",
      projectRoot: "",
    });
    assert.equal(result.ok, false);
  });
});
