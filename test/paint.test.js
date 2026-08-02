"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  drawMeterFace,
  OUTER_R,
  INNER_R,
  TOTAL_W,
  TOTAL_H,
} = require("../src/lib/paint");

function mockCtx() {
  const calls = [];
  const handler = {
    get(_t, prop) {
      if (prop === "calls") return calls;
      if (prop === "createRadialGradient" || prop === "createLinearGradient") {
        return () => ({
          addColorStop: (...args) => calls.push(["addColorStop", args]),
        });
      }
      if (prop === "measureText") {
        return () => ({ width: 20 });
      }
      return (...args) => {
        calls.push([prop, args]);
      };
    },
    set(_t, prop, value) {
      calls.push(["set", prop, value]);
      return true;
    },
  };
  return new Proxy({}, handler);
}

const efficiency = {
  architecture: {
    percent: 72,
    label: "72",
    color: "#4f46e5",
    key: "architecture",
    legend: "Arch",
  },
  codeEfficiency: {
    percent: 65,
    label: "65",
    color: "#0d9488",
    key: "codeEfficiency",
    legend: "Eff",
  },
  uiPerfection: {
    percent: 58,
    label: "58",
    color: "#d97706",
    key: "uiPerfection",
    legend: "UI",
  },
  overall: 66,
  project: "demo-app",
  hasFault: false,
  showingLastGood: false,
};

describe("drawMeterFace", () => {
  it("paints usage dial tracks and efficiency panel text", () => {
    const ctx = mockCtx();
    drawMeterFace(
      ctx,
      {
        cursorAngle: -48,
        otherAngle: 12,
        cursorColor: "#2563eb",
        otherColor: "#1c1917",
        otherArcColor: "#2f6f4e",
        cursorArcColor: "#2563eb",
        hasFault: false,
        efficiency,
      },
      { width: TOTAL_W, height: TOTAL_H }
    );

    const arcs = ctx.calls.filter((c) => c[0] === "arc");
    assert.ok(arcs.length >= 4);
    const radii = arcs.map((c) => c[1][2]);
    assert.ok(radii.includes(OUTER_R));
    assert.ok(radii.includes(INNER_R));

    const fills = ctx.calls.filter((c) => c[0] === "fill");
    assert.ok(fills.length >= 2);

    const texts = ctx.calls.filter((c) => c[0] === "fillText").map((c) => c[1][0]);
    assert.ok(texts.includes("PROJECT"));
    assert.ok(texts.includes("Arch"));
    assert.ok(texts.includes("Eff"));
    assert.ok(texts.includes("UI"));
    assert.ok(!texts.includes("demo-app"), "project name is not painted on face");
  });

  it("draws fault marker when hasFault", () => {
    const ctx = mockCtx();
    drawMeterFace(ctx, {
      cursorAngle: -120,
      otherAngle: -120,
      cursorColor: "#c23b22",
      otherColor: "#1c1917",
      otherArcColor: "#c23b22",
      hasFault: true,
      efficiency: { ...efficiency, hasFault: true },
    });
    const sets = ctx.calls.filter((c) => c[0] === "set" && c[1] === "fillStyle");
    assert.ok(sets.some((c) => c[2] === "#c23b22"));
  });
});
