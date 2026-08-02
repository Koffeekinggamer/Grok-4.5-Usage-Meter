"use strict";

const { percentToNeedleAngle } = require("./usage");
const {
  dualPercents,
  colorForPercent,
  CURSOR_NEEDLE_COLOR,
  OTHER_NEEDLE_COLOR,
} = require("./gauge");
const {
  LEGEND,
  LEGEND_ON_DEMAND,
  EFFICIENCY_LEGEND,
  faultPlan,
  faultEfficiencyLine,
  planLine,
  projectLine,
  titleHint,
  legendText,
} = require("./face-copy");

/** Architecture needle / bar — indigo */
const ARCH_COLOR = "#4f46e5";
/** Code efficiency — teal */
const EFF_COLOR = "#0d9488";
/** UI perfection — amber */
const UI_COLOR = "#d97706";

/**
 * @typedef {{
 *   percent: number,
 *   label: string,
 *   targetAngle: number,
 *   color: string,
 *   arcColor: string,
 * }} NeedleFace
 *
 * @typedef {{
 *   percent: number,
 *   label: string,
 *   color: string,
 *   key: string,
 *   legend: string,
 * }} EfficiencyBar
 *
 * @typedef {{
 *   cursor: NeedleFace,
 *   other: NeedleFace,
 *   plan: string,
 *   legend: { cursor: string, other: string },
 *   legendText: string,
 *   titleHint: string,
 *   showingLastGood: boolean,
 *   hasFault: boolean,
 *   account: string,
 *   efficiency: {
 *     architecture: EfficiencyBar,
 *     codeEfficiency: EfficiencyBar,
 *     uiPerfection: EfficiencyBar,
 *     overall: number,
 *     project: string,
 *     hasFault: boolean,
 *     showingLastGood: boolean,
 *   },
 * }} Face
 */

/**
 * @param {number} percent
 * @param {string} color
 * @param {string} key
 * @param {string} legend
 * @returns {EfficiencyBar}
 */
function barFromPercent(percent, color, key, legend) {
  const p = Math.max(0, Math.min(Number(percent) || 0, 100));
  return {
    percent: p,
    label: String(Math.round(p)),
    color,
    key,
    legend,
  };
}

/**
 * @param {import('./efficiency').EfficiencyReading} reading
 */
function efficiencyFromReading(reading) {
  return {
    architecture: barFromPercent(
      reading.architecture,
      ARCH_COLOR,
      "architecture",
      EFFICIENCY_LEGEND.architecture
    ),
    codeEfficiency: barFromPercent(
      reading.codeEfficiency,
      EFF_COLOR,
      "codeEfficiency",
      EFFICIENCY_LEGEND.codeEfficiency
    ),
    uiPerfection: barFromPercent(
      reading.uiPerfection,
      UI_COLOR,
      "uiPerfection",
      EFFICIENCY_LEGEND.uiPerfection
    ),
    overall: reading.overall,
    project: projectLine(reading),
    hasFault: false,
    showingLastGood: false,
  };
}

/**
 * @param {import('./efficiency').EfficiencyFault|null} fault
 */
function efficiencyFaultFace(fault) {
  return {
    architecture: barFromPercent(0, "#c23b22", "architecture", EFFICIENCY_LEGEND.architecture),
    codeEfficiency: barFromPercent(0, "#c23b22", "codeEfficiency", EFFICIENCY_LEGEND.codeEfficiency),
    uiPerfection: barFromPercent(0, "#c23b22", "uiPerfection", EFFICIENCY_LEGEND.uiPerfection),
    overall: 0,
    project: faultEfficiencyLine(fault),
    hasFault: true,
    showingLastGood: false,
  };
}

/**
 * Reading → face targets (angles, colors, labels). No animation state.
 * @param {import('./reading').Reading} reading
 * @returns {Omit<Face, 'showingLastGood'|'hasFault'|'efficiency'>}
 */
function faceFromReading(reading) {
  const dual = dualPercents(reading);
  const legend =
    dual.secondaryKind === "on-demand" ? { ...LEGEND_ON_DEMAND } : { ...LEGEND };

  if (reading.isUnlimited) {
    return {
      cursor: {
        percent: 0,
        label: "∞",
        targetAngle: -120,
        color: CURSOR_NEEDLE_COLOR,
        arcColor: CURSOR_NEEDLE_COLOR,
      },
      other: {
        percent: 0,
        label: "∞",
        targetAngle: -120,
        color: OTHER_NEEDLE_COLOR,
        arcColor: "#2f6f4e",
      },
      plan: planLine(reading),
      legend,
      legendText: legendText(legend),
      titleHint: titleHint(legend),
      account: reading.email || "",
    };
  }

  return {
    cursor: {
      percent: dual.cursorPercent,
      label: String(Math.round(dual.cursorPercent)),
      targetAngle: percentToNeedleAngle(dual.cursorPercent),
      color: CURSOR_NEEDLE_COLOR,
      arcColor: CURSOR_NEEDLE_COLOR,
    },
    other: {
      percent: dual.otherPercent,
      label: String(Math.round(dual.otherPercent)),
      targetAngle: percentToNeedleAngle(dual.otherPercent),
      color: OTHER_NEEDLE_COLOR,
      arcColor: colorForPercent(dual.otherPercent),
    },
    plan: planLine(reading),
    legend,
    legendText: legendText(legend),
    titleHint: titleHint(legend),
    account: reading.email || "",
  };
}

/**
 * Cold Fault face (no last-good Reading).
 * @param {import('./reading').Fault|null} fault
 * @returns {Omit<Face, 'efficiency'>}
 */
function faultFace(fault) {
  const legend = { ...LEGEND };
  return {
    cursor: {
      percent: 0,
      label: "!",
      targetAngle: -120,
      color: "#c23b22",
      arcColor: "#c23b22",
    },
    other: {
      percent: 0,
      label: "!",
      targetAngle: -120,
      color: OTHER_NEEDLE_COLOR,
      arcColor: "#c23b22",
    },
    plan: faultPlan(fault),
    legend,
    legendText: "",
    titleHint: titleHint(legend),
    showingLastGood: false,
    hasFault: true,
    account: "",
  };
}

/**
 * Meter state → Face DTO (single IPC interface).
 * @param {{
 *   reading: import('./reading').Reading|null,
 *   fault: import('./reading').Fault|null,
 *   showingLastGood: boolean,
 *   efficiencyReading?: import('./efficiency').EfficiencyReading|null,
 *   efficiencyFault?: import('./efficiency').EfficiencyFault|null,
 *   showingLastGoodEfficiency?: boolean,
 * }} state
 * @returns {Face}
 */
function buildFace(state) {
  /** @type {Face['efficiency']} */
  let efficiency;
  if (state.efficiencyReading) {
    efficiency = efficiencyFromReading(state.efficiencyReading);
    if (state.showingLastGoodEfficiency) {
      efficiency = {
        ...efficiency,
        project: projectLine(state.efficiencyReading, { showingLastGood: true }),
        showingLastGood: true,
        hasFault: Boolean(state.efficiencyFault),
      };
    }
  } else {
    efficiency = efficiencyFaultFace(state.efficiencyFault || null);
  }

  if (!state.reading) {
    return {
      ...faultFace(state.fault),
      efficiency,
    };
  }

  const base = faceFromReading(state.reading);
  return {
    ...base,
    plan: planLine(state.reading, { showingLastGood: state.showingLastGood }),
    showingLastGood: state.showingLastGood,
    hasFault: Boolean(state.fault),
    efficiency,
  };
}

/**
 * Paint/animation frame derived from Face + live needle angles.
 * @param {Face} face
 * @param {{ cursor: number, other: number }} angles
 */
function faceFrame(face, angles) {
  return {
    cursorAngle: angles.cursor,
    otherAngle: angles.other,
    cursorColor: face.cursor.color,
    otherColor: face.other.color,
    otherArcColor: face.other.arcColor,
    cursorArcColor: face.cursor.arcColor,
    hasFault: face.hasFault,
    efficiency: face.efficiency,
  };
}

module.exports = {
  faceFromReading,
  faultFace,
  buildFace,
  faceFrame,
  efficiencyFromReading,
  ARCH_COLOR,
  EFF_COLOR,
  UI_COLOR,
};
