"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { pickAuthEntry, readGrokAccount } = require("../src/lib/auth");

const fixtureAuth = path.join(__dirname, "..", "fixtures", "auth.json");

describe("pickAuthEntry", () => {
  it("prefers a non-expired entry", () => {
    const picked = pickAuthEntry(
      {
        a: {
          key: "old",
          expires_at: "2000-01-01T00:00:00.000Z",
          email: "old@example.com",
        },
        b: {
          key: "live",
          expires_at: "2099-01-01T00:00:00.000Z",
          email: "live@example.com",
        },
      },
      { now: new Date("2026-08-01T00:00:00.000Z") }
    );
    assert.equal(picked.entry.key, "live");
    assert.equal(picked.expired, false);
  });

  it("throws when no token keys exist", () => {
    assert.throws(() => pickAuthEntry({ a: { email: "x" } }), /No access token/);
  });
});

describe("readGrokAccount", () => {
  it("reads account fields from an auth.json fixture", () => {
    const account = readGrokAccount({ authPath: fixtureAuth });
    assert.equal(account.email, "tester@example.com");
    assert.equal(account.accessToken, "test-access-token-not-a-real-jwt");
    assert.equal(account.userId, "user-test-1");
  });
});
