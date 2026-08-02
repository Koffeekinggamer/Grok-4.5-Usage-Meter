"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  drawMeterFace,
  OUTER_R,
  INNER_R,
  PLATE_R,
} = require("../src/lib/paint");

function mockCtx() {
  const calls = [];
  const handler = {
    get(_t, prop) {
      if (prop === "calls") return calls;
      if (prop === "createRadialGradient") {
        return () => ({
          addColorStop: (...args) => calls.push(["addColorStop", args]),
        });
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

describe("drawMeterFace", () => {
  it("paints outer then inner tracks and two needles", () => {
    const ctx = mockCtx();
    drawMeterFace(ctx, {
      cursorAngle: -48,
      otherAngle: 12,
      cursorColor: "#2563eb",
      otherColor: "#1c1917",
      otherArcColor: "#2f6f4e",
      cursorArcColor: "#2563eb",
      hasFault: false,
    });

    const arcs = ctx.calls.filter((c) => c[0] === "arc");
    assert.ok(arcs.length >= 4);
    // Plate is centered; track radii scale from PLATE_R into the canvas.
    const radii = arcs.map((c) => c[1][2]);
    // First filled circle is the plate (radius ~ half canvas - 2)
    assert.ok(radii.some((r) => Math.abs(r - 98) < 0.01 || r === PLATE_R || r > 90));
    // Scaled outer/inner tracks appear
    assert.ok(radii.some((r) => r > 70 && r < 90));
    assert.ok(radii.some((r) => r > 55 && r < 75));
    // Center must be true center for a 200×200 dial (no vertical bias)
    const plateArc = arcs.find((c) => c[1][2] > 90);
    assert.ok(plateArc);
    assert.equal(plateArc[1][0], 100);
    assert.equal(plateArc[1][1], 100);

    const fills = ctx.calls.filter((c) => c[0] === "fill");
    assert.ok(fills.length >= 2);
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
    });
    const sets = ctx.calls.filter((c) => c[0] === "set" && c[1] === "fillStyle");
    assert.ok(sets.some((c) => c[2] === "#c23b22"));
  });
});
