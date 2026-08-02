"use strict";

const { percentToNeedleAngle } = require("./usage");

/** Blue needle — monthly plan usage. */
const PLAN_NEEDLE_COLOR = "#2563eb";

/** Dark needle body for context / on-demand. */
const OTHER_NEEDLE_COLOR = "#1c1917";

// Back-compat aliases used by face.js naming from the Cursor meter.
const CURSOR_NEEDLE_COLOR = PLAN_NEEDLE_COLOR;

/**
 * Spring-damper step toward a target needle angle.
 * @param {{ angle: number, velocity: number }} state
 * @param {number} targetAngle
 * @param {number} dtSeconds
 * @param {{ stiffness?: number, damping?: number }} [opts]
 */
function stepNeedle(state, targetAngle, dtSeconds, opts = {}) {
  const stiffness = opts.stiffness ?? 48;
  const damping = opts.damping ?? 10;
  const dt = Math.max(0, Math.min(dtSeconds, 0.05));
  const displacement = targetAngle - state.angle;
  const acceleration = stiffness * displacement - damping * state.velocity;
  const velocity = state.velocity + acceleration * dt;
  const angle = state.angle + velocity * dt;
  return { angle, velocity };
}

/**
 * Color for a usage percent band (used on the secondary arc).
 * @param {number} percent
 */
function colorForPercent(percent) {
  if (percent >= 95) return "#c23b22";
  if (percent >= 80) return "#d97706";
  if (percent >= 50) return "#ca8a04";
  return "#2f6f4e";
}

/**
 * Resolve plan % (blue) and secondary % (dark: on-demand if capped, else context).
 * @param {{
 *   percent?: number,
 *   planPercentUsed?: number|null,
 *   contextPercentUsed?: number|null,
 *   onDemandPercentUsed?: number|null,
 *   onDemandCap?: number|null,
 *   isUnlimited?: boolean,
 * }} usage
 */
function dualPercents(usage) {
  if (usage.isUnlimited) {
    return { cursorPercent: 0, otherPercent: 0, secondaryKind: "context" };
  }

  const planPercent = Number.isFinite(Number(usage.planPercentUsed))
    ? Number(usage.planPercentUsed)
    : Number(usage.percent) || 0;

  let otherPercent = 0;
  let secondaryKind = "context";

  if (
    Number.isFinite(Number(usage.onDemandCap)) &&
    Number(usage.onDemandCap) > 0 &&
    Number.isFinite(Number(usage.onDemandPercentUsed))
  ) {
    otherPercent = Number(usage.onDemandPercentUsed);
    secondaryKind = "on-demand";
  } else if (Number.isFinite(Number(usage.contextPercentUsed))) {
    otherPercent = Number(usage.contextPercentUsed);
    secondaryKind = "context";
  }

  return {
    cursorPercent: Math.max(0, Math.min(planPercent, 150)),
    otherPercent: Math.max(0, Math.min(otherPercent, 150)),
    secondaryKind,
  };
}

module.exports = {
  stepNeedle,
  colorForPercent,
  dualPercents,
  percentToNeedleAngle,
  PLAN_NEEDLE_COLOR,
  CURSOR_NEEDLE_COLOR,
  OTHER_NEEDLE_COLOR,
};
