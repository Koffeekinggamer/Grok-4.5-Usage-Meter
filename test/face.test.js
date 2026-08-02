"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildFace, faceFromReading, faceFrame } = require("../src/lib/face");
const { PLAN_NEEDLE_COLOR } = require("../src/lib/gauge");
const { LEGEND } = require("../src/lib/face-copy");

const reading = {
  percent: 10,
  used: 1900,
  limit: 19000,
  remaining: 17100,
  planPercentUsed: 10,
  contextPercentUsed: 42,
  onDemandPercentUsed: null,
  onDemandUsed: 0,
  onDemandCap: 0,
  contextTokensUsed: 210000,
  contextWindowTokens: 500000,
  model: "grok-4.5",
  sessionId: "sess-1",
  membershipType: "grok",
  isUnlimited: false,
  billingCycleStart: null,
  billingCycleEnd: null,
  displayMessage: null,
  email: "a@b.c",
};

const efficiencyReading = {
  architecture: 80,
  codeEfficiency: 70,
  uiPerfection: 60,
  overall: 72,
  projectName: "shop",
  projectRoot: "/tmp/shop",
  hasUiSurface: true,
  fileCount: 12,
  notes: [],
  sessionId: "sess-1",
  source: "env",
};

describe("faceFromReading", () => {
  it("builds dual needle targets for plan and context", () => {
    const face = faceFromReading(reading);
    assert.equal(face.cursor.label, "10");
    assert.equal(face.other.label, "42");
    assert.equal(face.cursor.color, PLAN_NEEDLE_COLOR);
    assert.equal(face.legend.cursor, LEGEND.cursor);
    assert.equal(face.legend.other, LEGEND.other);
    assert.equal(face.plan, "grok-4.5");
    assert.equal(face.cursor.targetAngle, -120 + (240 * 10) / 100);
    assert.equal(face.other.targetAngle, -120 + (240 * 42) / 100);
  });
});

describe("buildFace", () => {
  it("keeps last-good Reading with held plan copy", () => {
    const face = buildFace({
      reading,
      fault: { kind: "http", message: "boom" },
      showingLastGood: true,
      efficiencyReading,
      efficiencyFault: null,
      showingLastGoodEfficiency: false,
    });
    assert.equal(face.cursor.label, "10");
    assert.equal(face.plan, "grok-4.5 · held");
    assert.equal(face.hasFault, true);
    assert.equal(face.showingLastGood, true);
    assert.equal(face.efficiency.architecture.label, "80");
  });

  it("cold Fault uses face-copy plan line", () => {
    const face = buildFace({
      reading: null,
      fault: { kind: "unsigned-in", message: "x" },
      showingLastGood: false,
      efficiencyReading: null,
      efficiencyFault: { kind: "no-project", message: "x" },
      showingLastGoodEfficiency: false,
    });
    assert.equal(face.cursor.label, "!");
    assert.equal(face.plan, "Sign in");
    assert.equal(face.legendText, "");
    assert.equal(face.efficiency.project, "No project");
  });

  it("marks efficiency held state", () => {
    const face = buildFace({
      reading,
      fault: null,
      showingLastGood: false,
      efficiencyReading,
      efficiencyFault: { kind: "unreadable", message: "x" },
      showingLastGoodEfficiency: true,
    });
    assert.equal(face.efficiency.showingLastGood, true);
    assert.equal(face.efficiency.hasFault, true);
    assert.match(face.efficiency.project, /held/);
  });
});

describe("faceFrame", () => {
  it("maps Face + angles for paint including efficiency", () => {
    const face = buildFace({
      reading,
      fault: null,
      showingLastGood: false,
      efficiencyReading,
      efficiencyFault: null,
      showingLastGoodEfficiency: false,
    });
    const frame = faceFrame(face, { cursor: -40, other: 10 });
    assert.equal(frame.cursorAngle, -40);
    assert.equal(frame.otherAngle, 10);
    assert.equal(frame.cursorColor, PLAN_NEEDLE_COLOR);
    assert.equal(frame.otherArcColor, face.other.arcColor);
    assert.equal(frame.efficiency.uiPerfection.label, "60");
  });
});
