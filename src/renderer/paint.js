"use strict";

/**
 * Combined Meter paint: usage dual-needle dial (left) + efficiency bars (right).
 * Must run in the renderer — CanvasRenderingContext2D cannot cross contextBridge.
 */

const OUTER_R = 78;
const INNER_R = 64;
const START = (-120 * Math.PI) / 180 - Math.PI / 2;
const END = (120 * Math.PI) / 180 - Math.PI / 2;

const DIAL_SIZE = 200;
const PANEL_W = 168;
const TOTAL_W = DIAL_SIZE + PANEL_W;
const TOTAL_H = 200;

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} angleDeg
 * @param {string} color
 * @param {number} width
 */
function drawArc(ctx, cx, cy, r, angleDeg, color, width) {
  const needleRad = (angleDeg * Math.PI) / 180 - Math.PI / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, START, needleRad);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.stroke();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} angleDeg
 * @param {string} color
 * @param {number} tipR
 * @param {number} widthScale
 */
function drawNeedle(ctx, cx, cy, angleDeg, color, tipR, widthScale) {
  const needleRad = (angleDeg * Math.PI) / 180 - Math.PI / 2;
  const backR = 12 * widthScale;
  const half = 3.2 * widthScale;
  const tipX = cx + Math.cos(needleRad) * tipR;
  const tipY = cy + Math.sin(needleRad) * tipR;
  const left = needleRad + Math.PI / 2;
  const right = needleRad - Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(cx + Math.cos(left) * half, cy + Math.sin(left) * half);
  ctx.lineTo(
    cx + Math.cos(needleRad + Math.PI) * backR,
    cy + Math.sin(needleRad + Math.PI) * backR
  );
  ctx.lineTo(cx + Math.cos(right) * half, cy + Math.sin(right) * half);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Usage dual-needle dial (left zone).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} frame
 * @param {{ cx: number, cy: number }} origin
 */
function drawUsageDial(ctx, frame, origin) {
  const cx = origin.cx;
  const cy = origin.cy;
  const r = OUTER_R;

  const plate = ctx.createRadialGradient(cx - 16, cy - 20, 8, cx, cy, r + 18);
  plate.addColorStop(0, "rgba(250, 247, 241, 0.96)");
  plate.addColorStop(0.7, "rgba(232, 224, 210, 0.94)");
  plate.addColorStop(1, "rgba(196, 181, 160, 0.9)");
  ctx.beginPath();
  ctx.arc(cx, cy, r + 14, 0, Math.PI * 2);
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(68, 64, 60, 0.35)";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r, START, END);
  ctx.strokeStyle = "rgba(68, 64, 60, 0.16)";
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.stroke();
  drawArc(ctx, cx, cy, r, frame.otherAngle, frame.otherArcColor, 9);

  ctx.beginPath();
  ctx.arc(cx, cy, INNER_R, START, END);
  ctx.strokeStyle = "rgba(37, 99, 235, 0.18)";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.stroke();
  drawArc(
    ctx,
    cx,
    cy,
    INNER_R,
    frame.cursorAngle,
    frame.cursorArcColor || frame.cursorColor,
    7
  );

  for (let p = 0; p <= 100; p += 10) {
    const a = ((-120 + (240 * p) / 100) * Math.PI) / 180 - Math.PI / 2;
    const major = p % 50 === 0;
    const inner = r - (major ? 16 : 10);
    const outer = r + 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
    ctx.strokeStyle = major ? "rgba(28, 25, 23, 0.55)" : "rgba(28, 25, 23, 0.28)";
    ctx.lineWidth = major ? 2 : 1;
    ctx.stroke();
  }

  drawNeedle(ctx, cx, cy, frame.otherAngle, frame.otherColor, r - 8, 1);
  drawNeedle(ctx, cx, cy, frame.cursorAngle, frame.cursorColor, r - 22, 0.85);

  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fillStyle = frame.cursorColor;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = "#faf7f1";
  ctx.fill();

  if (frame.hasFault) {
    ctx.beginPath();
    ctx.arc(cx + r * 0.62, cy - r * 0.55, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#c23b22";
    ctx.fill();
  }
}

/**
 * Rounded rect helper.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} rad
 */
function roundRect(ctx, x, y, w, h, rad) {
  const r = Math.min(rad, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Efficiency panel (right zone): three score bars.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object|null|undefined} efficiency
 * @param {{ x: number, y: number, w: number, h: number }} box
 */
function drawEfficiencyPanel(ctx, efficiency, box) {
  const { x, y, w, h } = box;

  // Shared plate background blending with dial aesthetic
  const plate = ctx.createLinearGradient(x, y, x + w, y + h);
  plate.addColorStop(0, "rgba(250, 247, 241, 0.96)");
  plate.addColorStop(1, "rgba(232, 224, 210, 0.94)");
  roundRect(ctx, x + 4, y + 10, w - 12, h - 20, 18);
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(68, 64, 60, 0.28)";
  ctx.stroke();

  // Title
  ctx.fillStyle = "rgba(68, 64, 60, 0.72)";
  ctx.font = "700 10px 'Avenir Next', 'Segoe UI', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("PROJECT", x + 18, y + 28);

  const bars = efficiency
    ? [
        efficiency.architecture,
        efficiency.codeEfficiency,
        efficiency.uiPerfection,
      ]
    : [
        { legend: "Arch", label: "—", percent: 0, color: "#a8a29e" },
        { legend: "Eff", label: "—", percent: 0, color: "#a8a29e" },
        { legend: "UI", label: "—", percent: 0, color: "#a8a29e" },
      ];

  const barLeft = x + 18;
  const barWidth = w - 56;
  let by = y + 48;

  for (const bar of bars) {
    const legend = bar?.legend || "?";
    const label = bar?.label ?? "—";
    const percent = Math.max(0, Math.min(Number(bar?.percent) || 0, 100));
    const color = bar?.color || "#78716c";

    ctx.fillStyle = "rgba(28, 25, 23, 0.78)";
    ctx.font = "700 11px 'Avenir Next', 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(legend, barLeft, by);

    ctx.fillStyle = color;
    ctx.textAlign = "right";
    ctx.fillText(label, x + w - 20, by);

    // Track
    const trackY = by + 12;
    roundRect(ctx, barLeft, trackY, barWidth, 8, 4);
    ctx.fillStyle = "rgba(68, 64, 60, 0.12)";
    ctx.fill();

    // Fill
    const fillW = Math.max(0, (barWidth * percent) / 100);
    if (fillW > 0) {
      roundRect(ctx, barLeft, trackY, fillW, 8, 4);
      ctx.fillStyle = color;
      ctx.fill();
    }

    by += 36;
  }

  // Project name
  const project = efficiency?.project || "";
  ctx.fillStyle = "rgba(120, 113, 108, 0.95)";
  ctx.font = "600 9px 'Avenir Next', 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const maxChars = 22;
  const shown =
    project.length > maxChars ? `${project.slice(0, maxChars - 1)}…` : project;
  ctx.fillText(shown, x + w / 2, y + h - 22);

  if (efficiency?.hasFault) {
    ctx.beginPath();
    ctx.arc(x + w - 22, y + 26, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "#c23b22";
    ctx.fill();
  }
}

/**
 * Full combined Meter face.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{
 *   cursorAngle: number,
 *   otherAngle: number,
 *   cursorColor: string,
 *   otherColor: string,
 *   otherArcColor: string,
 *   cursorArcColor?: string,
 *   hasFault?: boolean,
 *   efficiency?: object,
 * }} frame
 * @param {{ width: number, height: number }} size
 */
function drawMeterFace(ctx, frame, size = { width: TOTAL_W, height: TOTAL_H }) {
  const w = size.width;
  const h = size.height;
  ctx.clearRect(0, 0, w, h);

  // Dial sits in left 200×200; panel in remaining width
  const dialCx = DIAL_SIZE / 2;
  const dialCy = h / 2 + 8;
  drawUsageDial(ctx, frame, { cx: dialCx, cy: dialCy });

  const panelX = DIAL_SIZE - 8;
  const panelW = w - panelX;
  drawEfficiencyPanel(ctx, frame.efficiency, {
    x: panelX,
    y: 0,
    w: panelW,
    h,
  });
}

const api = {
  drawMeterFace,
  drawUsageDial,
  drawEfficiencyPanel,
  OUTER_R,
  INNER_R,
  START,
  END,
  DIAL_SIZE,
  PANEL_W,
  TOTAL_W,
  TOTAL_H,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
} else {
  globalThis.MeterPaint = api;
}
