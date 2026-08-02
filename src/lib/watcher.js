"use strict";

/**
 * Sync the Meter with Terminal Grok: start when Grok opens, stop when Grok closes.
 *
 * @param {{
 *   isGrokRunning: () => boolean,
 *   isMeterRunning: () => boolean,
 *   startMeter: () => void,
 *   stopMeter: () => void,
 * }} adapters
 * @returns {'started'|'stopped'|'already-running'|'idle'}
 */
function syncMeterWithGrok(adapters) {
  const grokUp = adapters.isGrokRunning();
  const meterUp = adapters.isMeterRunning();

  if (grokUp && !meterUp) {
    adapters.startMeter();
    return "started";
  }

  if (!grokUp && meterUp) {
    adapters.stopMeter();
    return "stopped";
  }

  if (grokUp && meterUp) {
    return "already-running";
  }

  return "idle";
}

/** @deprecated use syncMeterWithGrok */
function ensureMeterRunning(adapters) {
  const result = syncMeterWithGrok({
    ...adapters,
    stopMeter: adapters.stopMeter || (() => {}),
  });
  if (result === "idle" || result === "stopped") return "grok-down";
  return result;
}

module.exports = { syncMeterWithGrok, ensureMeterRunning };
