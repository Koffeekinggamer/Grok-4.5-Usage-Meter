"use strict";

/**
 * Canonical Meter face copy (Plan usage / Context usage).
 * HTML and CSS are adapters — change labels here.
 */

const LEGEND = Object.freeze({
  cursor: "Plan",
  other: "Ctx",
});

const LEGEND_ON_DEMAND = Object.freeze({
  cursor: "Plan",
  other: "OD",
});

/**
 * @param {import('./reading').Fault|null|undefined} fault
 */
function faultPlan(fault) {
  if (!fault) return "Unavailable";
  switch (fault.kind) {
    case "missing-auth":
      return "No Grok auth";
    case "unsigned-in":
      return "Sign in";
    case "expired":
      return "Token expired";
    case "http":
      return "API error";
    case "parse":
      return "Bad data";
    default:
      return "Fault";
  }
}

/**
 * @param {{ membershipType?: string|null, isUnlimited?: boolean, model?: string|null }} reading
 * @param {{ showingLastGood?: boolean }} [opts]
 */
function planLine(reading, opts = {}) {
  if (reading.isUnlimited) {
    return opts.showingLastGood ? "Unlimited · held" : "Unlimited";
  }
  const base = reading.model || reading.membershipType || "Grok";
  if (opts.showingLastGood) {
    return `${base} · held`;
  }
  return base;
}

/**
 * @param {{ cursor: string, other: string }} legend
 */
function titleHint(legend = LEGEND) {
  return `Blue ${legend.cursor} = monthly plan · Dark ${legend.other} = context window · drag · double-click refresh`;
}

/**
 * @param {{ cursor: string, other: string }} legend
 */
function legendText(legend = LEGEND) {
  return `${legend.cursor} · ${legend.other}`;
}

module.exports = {
  LEGEND,
  LEGEND_ON_DEMAND,
  faultPlan,
  planLine,
  titleHint,
  legendText,
};
