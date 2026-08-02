"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  emptyMeterState,
  reduceMeterState,
  reduceEfficiencyState,
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

const efficiencyReading = {
  architecture: 72,
  codeEfficiency: 65,
  uiPerfection: 58,
  overall: 66,
  projectName: "demo-app",
  projectRoot: "/tmp/demo-app",
  hasUiSurface: true,
  fileCount: 40,
  notes: [],
  sessionId: "s1",
  source: "active-session",
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
    let state = reduceMeterState(emptyMeterState(), { ok: true, reading });
    state = reduceEfficiencyState(state, {
      ok: true,
      reading: efficiencyReading,
    });
    const face = buildFaceView(state);
    assert.equal(face.cursor.label, "10");
    assert.equal(face.other.label, "42");
    assert.equal(face.efficiency.architecture.label, "72");
    assert.equal(face.efficiency.project, "demo-app");
  });
});

describe("reduceEfficiencyState", () => {
  it("holds last-good only on transient scan faults", () => {
    const prev = reduceEfficiencyState(emptyMeterState(), {
      ok: true,
      reading: efficiencyReading,
    });
    assert.equal(prev.efficiencyReading.architecture, 72);

    const next = reduceEfficiencyState(prev, {
      ok: false,
      fault: { kind: "unreadable", message: "io" },
    });
    assert.equal(next.efficiencyReading.architecture, 72);
    assert.equal(next.showingLastGoodEfficiency, true);
    assert.equal(next.efficiencyFault.kind, "unreadable");
  });

  it("clears previous project when no project is open", () => {
    const prev = reduceEfficiencyState(emptyMeterState(), {
      ok: true,
      reading: efficiencyReading,
    });
    const next = reduceEfficiencyState(prev, {
      ok: false,
      fault: { kind: "no-project", message: "gone" },
    });
    assert.equal(next.efficiencyReading, null);
    assert.equal(next.showingLastGoodEfficiency, false);
    assert.equal(next.efficiencyFault.kind, "no-project");
  });

  it("does not drop usage reading when efficiency updates", () => {
    let state = reduceMeterState(emptyMeterState(), { ok: true, reading });
    state = reduceEfficiencyState(state, {
      ok: true,
      reading: efficiencyReading,
    });
    assert.equal(state.reading.planPercentUsed, 10);
    assert.equal(state.efficiencyReading.architecture, 72);

    state = reduceEfficiencyState(state, {
      ok: false,
      fault: { kind: "no-project", message: "switched to home" },
    });
    assert.equal(state.reading.planPercentUsed, 10, "usage stays");
    assert.equal(state.efficiencyReading, null);
  });
});

describe("buildFaceView", () => {
  it("maps dual needles from plan and context percents", () => {
    const face = buildFaceView({
      reading,
      fault: null,
      showingLastGood: false,
      efficiencyReading,
      efficiencyFault: null,
      showingLastGoodEfficiency: false,
    });
    assert.equal(face.cursor.label, "10");
    assert.equal(face.other.label, "42");
    assert.equal(face.legend.cursor, "Plan");
    assert.equal(face.legend.other, "Ctx");
    assert.equal(face.efficiency.codeEfficiency.label, "65");
    assert.equal(face.efficiency.uiPerfection.label, "58");
  });

  it("renders cold fault without a reading", () => {
    const face = buildFaceView({
      reading: null,
      fault: { kind: "missing-auth", message: "x" },
      showingLastGood: false,
      efficiencyReading: null,
      efficiencyFault: { kind: "no-project", message: "x" },
      showingLastGoodEfficiency: false,
    });
    assert.equal(face.cursor.label, "!");
    assert.equal(face.plan, "No Grok auth");
    assert.equal(face.efficiency.project, "No project");
    assert.equal(face.efficiency.hasFault, true);
  });
});
