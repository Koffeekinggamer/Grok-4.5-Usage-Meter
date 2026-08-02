"use strict";

/**
 * Dual-needle Meter paint. Must run in the renderer — CanvasRenderingContext2D
 * cannot cross Electron's contextBridge.
 */

const OUTER_R = 78;
const INNER_R = 64;
const START = (-120 * Math.PI) / 180 - Math.PI / 2;
const END = (120 * Math.PI) / 180 - Math.PI / 2;

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
 * @param {CanvasRenderingContext2D} ctx
 * @param {{
 *   cursorAngle: number,
 *   otherAngle: number,
 *   cursorColor: string,
 *   otherColor: string,
 *   otherArcColor: string,
 *   cursorArcColor?: string,
 *   hasFault?: boolean,
 * }} frame
 * @param {{ width: number, height: number }} size
 */
function drawMeterFace(ctx, frame, size = { width: 200, height: 200 }) {
  const w = size.width;
  const h = size.height;
  const cx = w / 2;
  const cy = h / 2 + 8;
  const r = OUTER_R;

  ctx.clearRect(0, 0, w, h);

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

  // Other under, cursor (blue) on top
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

const api = {
  drawMeterFace,
  OUTER_R,
  INNER_R,
  START,
  END,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
} else {
  globalThis.MeterPaint = api;
}
