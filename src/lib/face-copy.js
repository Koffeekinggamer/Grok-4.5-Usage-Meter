"use strict";

/**
 * Canonical Meter face copy (Plan / Context + Architecture / Efficiency / UI).
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

const EFFICIENCY_LEGEND = Object.freeze({
  architecture: "Arch",
  codeEfficiency: "Eff",
  uiPerfection: "UI",
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
 * @param {import('./efficiency').EfficiencyFault|null|undefined} fault
 */
function faultEfficiencyLine(fault) {
  if (!fault) return "No project";
  switch (fault.kind) {
    case "no-project":
      return "No project";
    case "unreadable":
      return "Unreadable";
    default:
      return "Eff fault";
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
 * @param {{ projectName?: string, hasUiSurface?: boolean }} reading
 * @param {{ showingLastGood?: boolean }} [opts]
 */
function projectLine(reading, opts = {}) {
  const name = reading.projectName || "project";
  const suffix = reading.hasUiSurface === false ? " · no UI" : "";
  if (opts.showingLastGood) return `${name}${suffix} · held`;
  return `${name}${suffix}`;
}

/**
 * @param {{ cursor: string, other: string }} legend
 */
function titleHint(legend = LEGEND) {
  return (
    `Blue ${legend.cursor} = monthly plan · Dark ${legend.other} = context · ` +
    `Arch / Eff / UI = open project scores · drag · double-click refresh`
  );
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
  EFFICIENCY_LEGEND,
  faultPlan,
  faultEfficiencyLine,
  planLine,
  projectLine,
  titleHint,
  legendText,
};
