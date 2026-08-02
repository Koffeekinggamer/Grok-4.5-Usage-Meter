"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { scoreProject } = require("../src/lib/score");

describe("scoreProject", () => {
  /** @type {string} */
  let root;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pem-score-"));
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "demo",
        dependencies: { leftpad: "1.0.0" },
        devDependencies: { electron: "33.0.0" },
      })
    );
    fs.writeFileSync(path.join(root, "package-lock.json"), "{}");
    fs.writeFileSync(path.join(root, "README.md"), "# Demo\n");
    fs.writeFileSync(path.join(root, ".gitignore"), "node_modules\n");
    fs.writeFileSync(path.join(root, "tsconfig.json"), "{}");
    fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });
    fs.mkdirSync(path.join(root, "tests"), { recursive: true });
    fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".github", "workflows", "ci.yml"),
      "name: ci\n"
    );
    fs.writeFileSync(
      path.join(root, "src", "index.ts"),
      "export const x = 1;\n".repeat(20)
    );
    fs.writeFileSync(
      path.join(root, "src", "components", "Button.tsx"),
      `export function Button() {\n  return <button aria-label="ok">Go</button>;\n}\n`
    );
    fs.writeFileSync(
      path.join(root, "src", "styles.css"),
      `@media (max-width: 600px) { body { margin: 0 } }\n.btn { color: red }\n`
    );
    fs.writeFileSync(
      path.join(root, "tests", "index.test.ts"),
      "test('ok', () => {});\n"
    );
    fs.writeFileSync(path.join(root, "eslint.config.js"), "export default [];\n");
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("scores architecture, efficiency, and UI above baseline", () => {
    const s = scoreProject(root, { name: "demo" });
    assert.equal(s.projectName, "demo");
    assert.ok(s.architecture >= 50, `arch ${s.architecture}`);
    assert.ok(s.codeEfficiency >= 40, `eff ${s.codeEfficiency}`);
    assert.ok(s.uiPerfection >= 40, `ui ${s.uiPerfection}`);
    assert.equal(s.hasUiSurface, true);
    assert.ok(s.fileCount > 5);
    assert.ok(s.overall > 0);
  });

  it("returns zeros for missing root", () => {
    const s = scoreProject(path.join(root, "does-not-exist"));
    assert.equal(s.architecture, 0);
    assert.ok(s.notes.some((n) => /missing/i.test(n)));
  });
});
