"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { takeEfficiencyReading } = require("../src/lib/efficiency");

describe("takeEfficiencyReading", () => {
  it("returns no-project fault when nothing is focused", async () => {
    const event = await takeEfficiencyReading({
      resolveProject: () => null,
    });
    assert.equal(event.ok, false);
    assert.equal(event.fault.kind, "no-project");
  });

  it("scores a resolved project", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pem-eff-"));
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"x"}');
    fs.writeFileSync(path.join(root, "README.md"), "# x\n");
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "main.js"), "console.log(1)\n");
    try {
      const event = await takeEfficiencyReading({
        resolveProject: () => ({
          root,
          name: "x",
          sessionId: "s1",
          source: "env",
        }),
      });
      assert.equal(event.ok, true);
      assert.equal(event.reading.projectName, "x");
      assert.equal(event.reading.sessionId, "s1");
      assert.ok(event.reading.architecture >= 0);
      assert.ok(event.reading.codeEfficiency >= 0);
      assert.ok(event.reading.uiPerfection >= 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
