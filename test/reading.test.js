"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { classifyFault, takeReading } = require("../src/lib/reading");

describe("classifyFault", () => {
  it("maps missing auth / unsigned-in / expired / http", () => {
    assert.equal(
      classifyFault(new Error("Grok auth file not found at /x")).kind,
      "missing-auth"
    );
    assert.equal(
      classifyFault(new Error("No access token in auth.json — run `grok login` first"))
        .kind,
      "unsigned-in"
    );
    assert.equal(
      classifyFault(new Error("Grok access token expired — run grok login")).kind,
      "expired"
    );
    assert.equal(
      classifyFault(new Error("billing failed (503): busy")).kind,
      "http"
    );
  });
});

describe("takeReading", () => {
  it("returns a Reading from account + billing + context adapters", async () => {
    const result = await takeReading({
      readAccount: () => ({
        accessToken: "tok",
        email: "a@b.c",
        userId: "u1",
        teamId: "t1",
        authMode: "oidc",
        issuer: "iss",
        expiresAt: null,
      }),
      fetchBillingFn: async () => ({
        percent: 10,
        used: 1900,
        limit: 19000,
        remaining: 17100,
        onDemandCap: 0,
        onDemandUsed: 0,
        onDemandPercent: null,
        isUnlimited: false,
        billingCycleStart: "2026-08-01T00:00:00+00:00",
        billingCycleEnd: "2026-09-01T00:00:00+00:00",
        history: [],
      }),
      readContext: () => ({
        percent: 42,
        tokensUsed: 210000,
        windowTokens: 500000,
        model: "grok-4.5",
        sessionId: "sess-1",
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.reading.planPercentUsed, 10);
    assert.equal(result.reading.contextPercentUsed, 42);
    assert.equal(result.reading.email, "a@b.c");
    assert.equal(result.reading.model, "grok-4.5");
  });

  it("returns a Fault instead of throwing", async () => {
    const result = await takeReading({
      readAccount: () => {
        throw new Error("Grok auth file not found at /missing");
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.fault.kind, "missing-auth");
  });
});
