"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  emptyMeterState,
  reduceMeterState,
  buildFaceView,
} = require("../src/lib/meter-state");

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
  sessionId: "s1",
  membershipType: "grok",
  isUnlimited: false,
  billingCycleStart: null,
  billingCycleEnd: null,
  displayMessage: null,
  email: "a@b.c",
};

describe("reduceMeterState", () => {
  it("stores a successful Reading", () => {
    const next = reduceMeterState(emptyMeterState(), {
      ok: true,
      reading,
    });
    assert.equal(next.reading.planPercentUsed, 10);
    assert.equal(next.fault, null);
    assert.equal(next.showingLastGood, false);
  });

  it("keeps last-good reading on fault", () => {
    const prev = reduceMeterState(emptyMeterState(), { ok: true, reading });
    const next = reduceMeterState(prev, {
      ok: false,
      fault: { kind: "http", message: "down" },
    });
    assert.equal(next.reading.planPercentUsed, 10);
    assert.equal(next.showingLastGood, true);
    assert.equal(next.fault.kind, "http");
  });

  it("shows fault with no reading when nothing is held", () => {
    const next = reduceMeterState(emptyMeterState(), {
      ok: false,
      fault: { kind: "unsigned-in", message: "x" },
    });
    assert.equal(next.reading, null);
    assert.equal(next.showingLastGood, false);
  });

  it("buildFaceView exposes Face DTO without snap-to-zero", () => {
    const state = reduceMeterState(emptyMeterState(), { ok: true, reading });
    const face = buildFaceView(state);
    assert.equal(face.cursor.label, "10");
    assert.equal(face.other.label, "42");
  });
});

describe("buildFaceView", () => {
  it("maps dual needles from plan and context percents", () => {
    const face = buildFaceView({
      reading,
      fault: null,
      showingLastGood: false,
    });
    assert.equal(face.cursor.label, "10");
    assert.equal(face.other.label, "42");
    assert.equal(face.legend.cursor, "Plan");
    assert.equal(face.legend.other, "Ctx");
  });

  it("renders cold fault without a reading", () => {
    const face = buildFaceView({
      reading: null,
      fault: { kind: "missing-auth", message: "x" },
      showingLastGood: false,
    });
    assert.equal(face.cursor.label, "!");
    assert.equal(face.plan, "No Grok auth");
  });
});
