"use strict";

const { buildFace } = require("./face");

/**
 * @typedef {import('./reading').Reading} Reading
 * @typedef {import('./reading').Fault} Fault
 * @typedef {import('./efficiency').EfficiencyReading} EfficiencyReading
 * @typedef {import('./efficiency').EfficiencyFault} EfficiencyFault
 * @typedef {{
 *   reading: Reading|null,
 *   fault: Fault|null,
 *   showingLastGood: boolean,
 *   efficiencyReading: EfficiencyReading|null,
 *   efficiencyFault: EfficiencyFault|null,
 *   showingLastGoodEfficiency: boolean,
 * }} MeterState
 */

/**
 * @returns {MeterState}
 */
function emptyMeterState() {
  return {
    reading: null,
    fault: null,
    showingLastGood: false,
    efficiencyReading: null,
    efficiencyFault: null,
    showingLastGoodEfficiency: false,
  };
}

/**
 * Reduce a usage Reading producer event into Meter display state.
 * @param {MeterState|null|undefined} previous
 * @param {{ ok: true, reading: Reading } | { ok: false, fault: Fault }} event
 * @returns {MeterState}
 */
function reduceMeterState(previous, event) {
  const prev = previous || emptyMeterState();

  if (event.ok) {
    return {
      ...prev,
      reading: event.reading,
      fault: null,
      showingLastGood: false,
    };
  }

  if (prev.reading) {
    return {
      ...prev,
      reading: prev.reading,
      fault: event.fault,
      showingLastGood: true,
    };
  }

  return {
    ...prev,
    reading: null,
    fault: event.fault,
    showingLastGood: false,
  };
}

/**
 * Reduce an efficiency Reading event into Meter display state.
 * @param {MeterState|null|undefined} previous
 * @param {{ ok: true, reading: EfficiencyReading } | { ok: false, fault: EfficiencyFault }} event
 * @returns {MeterState}
 */
function reduceEfficiencyState(previous, event) {
  const prev = previous || emptyMeterState();

  if (event.ok) {
    return {
      ...prev,
      efficiencyReading: event.reading,
      efficiencyFault: null,
      showingLastGoodEfficiency: false,
    };
  }

  if (prev.efficiencyReading) {
    return {
      ...prev,
      efficiencyReading: prev.efficiencyReading,
      efficiencyFault: event.fault,
      showingLastGoodEfficiency: true,
    };
  }

  return {
    ...prev,
    efficiencyReading: null,
    efficiencyFault: event.fault,
    showingLastGoodEfficiency: false,
  };
}

/**
 * @param {MeterState} state
 */
function buildFaceView(state) {
  return buildFace(state);
}

module.exports = {
  emptyMeterState,
  reduceMeterState,
  reduceEfficiencyState,
  buildFaceView,
};
