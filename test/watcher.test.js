"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { syncMeterWithGrok } = require("../src/lib/watcher");

describe("syncMeterWithGrok", () => {
  it("stays idle when Grok and Meter are both down", () => {
    const result = syncMeterWithGrok({
      isGrokRunning: () => false,
      isMeterRunning: () => false,
      startMeter: () => {
        throw new Error("should not start");
      },
      stopMeter: () => {
        throw new Error("should not stop");
      },
    });
    assert.equal(result, "idle");
  });

  it("starts the Meter when Grok opens", () => {
    let started = false;
    const result = syncMeterWithGrok({
      isGrokRunning: () => true,
      isMeterRunning: () => false,
      startMeter: () => {
        started = true;
      },
      stopMeter: () => {
        throw new Error("should not stop");
      },
    });
    assert.equal(result, "started");
    assert.equal(started, true);
  });

  it("stops the Meter when Grok closes", () => {
    let stopped = false;
    const result = syncMeterWithGrok({
      isGrokRunning: () => false,
      isMeterRunning: () => true,
      startMeter: () => {
        throw new Error("should not start");
      },
      stopMeter: () => {
        stopped = true;
      },
    });
    assert.equal(result, "stopped");
    assert.equal(stopped, true);
  });

  it("leaves a running Meter alone while Grok stays open", () => {
    const result = syncMeterWithGrok({
      isGrokRunning: () => true,
      isMeterRunning: () => true,
      startMeter: () => {
        throw new Error("should not start");
      },
      stopMeter: () => {
        throw new Error("should not stop");
      },
    });
    assert.equal(result, "already-running");
  });
});
