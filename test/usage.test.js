"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  parseBilling,
  fetchBilling,
  percentToNeedleAngle,
  DEFAULT_BILLING_ENDPOINT,
} = require("../src/lib/usage");
const {
  stepNeedle,
  colorForPercent,
  dualPercents,
  PLAN_NEEDLE_COLOR,
} = require("../src/lib/gauge");
const { faceFromReading } = require("../src/lib/face");

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "fixtures", "billing.json"), "utf8")
);

describe("parseBilling", () => {
  it("parses the fixture into gauge metrics", () => {
    const usage = parseBilling(fixture);
    assert.equal(usage.percent, 10);
    assert.equal(usage.used, 1900);
    assert.equal(usage.limit, 19000);
    assert.equal(usage.isUnlimited, false);
    assert.equal(usage.remaining, 17100);
  });

  it("marks unlimited when monthlyLimit is missing", () => {
    const usage = parseBilling({ config: { used: { val: 0 } } });
    assert.equal(usage.isUnlimited, true);
    assert.equal(usage.percent, 0);
  });
});

describe("fetchBilling", () => {
  it("sends bearer token and parses JSON", async () => {
    const usage = await fetchBilling({
      accessToken: "tok-abc",
      fetchImpl: async (url, init) => {
        assert.equal(url, DEFAULT_BILLING_ENDPOINT);
        assert.equal(init.headers.Authorization, "Bearer tok-abc");
        return {
          ok: true,
          async json() {
            return fixture;
          },
          async text() {
            return "";
          },
        };
      },
    });
    assert.equal(usage.percent, 10);
  });

  it("surfaces HTTP failures", async () => {
    await assert.rejects(
      () =>
        fetchBilling({
          accessToken: "x",
          fetchImpl: async () => ({
            ok: false,
            status: 401,
            async text() {
              return '{"error":"not_authenticated"}';
            },
          }),
        }),
      /401/
    );
  });
});

describe("needle math", () => {
  it("maps 0/50/100 percent to dial angles", () => {
    assert.equal(percentToNeedleAngle(0), -120);
    assert.equal(percentToNeedleAngle(50), 0);
    assert.equal(percentToNeedleAngle(100), 120);
  });

  it("steps spring-damper toward the target", () => {
    let state = { angle: -120, velocity: 0 };
    for (let i = 0; i < 120; i++) {
      state = stepNeedle(state, 0, 1 / 60);
    }
    assert.ok(Math.abs(state.angle) < 5);
  });

  it("picks warning colors by band", () => {
    assert.equal(colorForPercent(10), "#2f6f4e");
    assert.equal(colorForPercent(85), "#d97706");
    assert.equal(colorForPercent(99), "#c23b22");
  });

  it("resolves dual percents for plan vs context", () => {
    const dual = dualPercents({
      percent: 10,
      planPercentUsed: 10,
      contextPercentUsed: 42,
    });
    assert.equal(dual.cursorPercent, 10);
    assert.equal(dual.otherPercent, 42);
    assert.equal(dual.secondaryKind, "context");

    const face = faceFromReading({
      percent: 10,
      planPercentUsed: 10,
      contextPercentUsed: 42,
      onDemandPercentUsed: null,
      onDemandCap: 0,
      membershipType: "grok",
      model: "grok-4.5",
      email: "a@b.c",
      isUnlimited: false,
    });
    assert.equal(face.cursor.label, "10");
    assert.equal(face.other.label, "42");
    assert.equal(face.cursor.color, PLAN_NEEDLE_COLOR);
    assert.equal(face.legend.cursor, "Plan");
    assert.equal(face.legend.other, "Ctx");
    assert.equal(face.account, "a@b.c");
  });

  it("prefers on-demand when cap is set", () => {
    const dual = dualPercents({
      planPercentUsed: 80,
      contextPercentUsed: 20,
      onDemandCap: 1000,
      onDemandPercentUsed: 55,
    });
    assert.equal(dual.otherPercent, 55);
    assert.equal(dual.secondaryKind, "on-demand");
  });
});
