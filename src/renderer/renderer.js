"use strict";

const canvas = document.getElementById("gauge");
const ctx = canvas.getContext("2d");
const cursorPctEl = document.getElementById("cursorPct");
const otherPctEl = document.getElementById("otherPct");
const planEl = document.getElementById("plan");
const legendEl = document.getElementById("legend");
const legendCursorEl = document.getElementById("legendCursor");
const legendOtherEl = document.getElementById("legendOther");
const shellEl = document.getElementById("shell");
const boostBtn = document.getElementById("boostBtn");
const boostEstimateEl = document.getElementById("boostEstimate");
const boostTimeEl = document.getElementById("boostTime");
const boostTokensEl = document.getElementById("boostTokens");

let face = null;
let cursorNeedle = { angle: -120, velocity: 0 };
let otherNeedle = { angle: -120, velocity: 0 };
let lastTs = performance.now();
let boostBusy = false;

function frame(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;

  if (!window.tokenMeter?.stepNeedle || !window.tokenMeter?.faceFrame) {
    requestAnimationFrame(frame);
    return;
  }

  const draw = globalThis.MeterPaint?.drawMeterFace;
  if (face && draw) {
    cursorNeedle = window.tokenMeter.stepNeedle(
      cursorNeedle,
      face.cursor.targetAngle,
      dt
    );
    otherNeedle = window.tokenMeter.stepNeedle(
      otherNeedle,
      face.other.targetAngle,
      dt
    );
    const paintFrame = window.tokenMeter.faceFrame(face, {
      cursor: cursorNeedle.angle,
      other: otherNeedle.angle,
    });
    draw(ctx, paintFrame, {
      width: canvas.width,
      height: canvas.height,
    });
  }

  requestAnimationFrame(frame);
}

function applyBoostUi(boost) {
  if (!boostBtn || !boost) return;
  boostBtn.classList.remove("boost-done", "boost-error");
  const status = boost.status || "idle";
  if (status === "running") {
    boostBusy = true;
    boostBtn.disabled = true;
    boostBtn.textContent = boost.label || "Building…";
  } else if (status === "error") {
    boostBusy = false;
    boostBtn.disabled = false;
    boostBtn.classList.add("boost-error");
    boostBtn.textContent = boost.label || "Failed";
  } else if (status === "done") {
    boostBusy = false;
    boostBtn.disabled = false;
    boostBtn.classList.add("boost-done");
    boostBtn.textContent = boost.label || "Launched";
  } else {
    boostBusy = false;
    boostBtn.disabled = Boolean(boost.disabled);
    boostBtn.textContent = boost.label || "↑ 80%";
    if (boost.title) boostBtn.title = boost.title;
  }
}

function applyFace(payload) {
  if (!payload?.cursor || !payload?.other) return;
  face = payload;

  if (payload.hasFault && !payload.showingLastGood) {
    cursorPctEl.textContent = payload.cursor.label;
    otherPctEl.textContent = payload.other.label;
    legendEl.hidden = true;
    planEl.textContent = payload.plan || "";
  } else {
    cursorPctEl.textContent = payload.cursor.label;
    otherPctEl.textContent = payload.other.label;
    legendEl.hidden = false;
    if (legendCursorEl) legendCursorEl.textContent = payload.legend.cursor;
    if (legendOtherEl) legendOtherEl.textContent = payload.legend.other;
    planEl.textContent = payload.plan || "";
  }

  if (shellEl && payload.titleHint) {
    shellEl.title = payload.titleHint;
  }

  if (payload.boost) applyBoostUi(payload.boost);

  const est = payload.efficiency?.estimate;
  if (boostEstimateEl && boostTimeEl && boostTokensEl) {
    if (est && (est.timeLabel || est.tokensLabel)) {
      boostEstimateEl.hidden = false;
      boostTimeEl.textContent = est.timeLabel || "—";
      boostTokensEl.textContent = est.tokensLabel || "— tok";
      boostEstimateEl.title = est.detail || "Approximate effort to reach ≥80%";
    } else if (payload.efficiency?.hasFault) {
      boostEstimateEl.hidden = false;
      boostTimeEl.textContent = "—";
      boostTokensEl.textContent = "no project";
      boostEstimateEl.title = "Open a project to estimate boost effort";
    } else {
      boostEstimateEl.hidden = true;
    }
  }
}

let dragging = false;
let lastX = 0;
let lastY = 0;

function isBoostTarget(el) {
  return el === boostBtn || (el && boostBtn && boostBtn.contains(el));
}

window.addEventListener("pointerdown", (e) => {
  if (isBoostTarget(e.target)) {
    // Button handles its own click — do not drag the overlay.
    e.stopPropagation();
    return;
  }
  dragging = true;
  lastX = e.screenX;
  lastY = e.screenY;
  e.target.setPointerCapture?.(e.pointerId);
});

window.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.screenX - lastX;
  const dy = e.screenY - lastY;
  lastX = e.screenX;
  lastY = e.screenY;
  window.tokenMeter?.dragBy(dx, dy);
});

window.addEventListener("pointerup", () => {
  dragging = false;
});

window.addEventListener("dblclick", (e) => {
  if (isBoostTarget(e.target)) return;
  window.tokenMeter?.refresh();
});

if (boostBtn) {
  boostBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (boostBusy) return;
    boostBusy = true;
    boostBtn.disabled = true;
    boostBtn.textContent = "Starting…";
    try {
      const result = await window.tokenMeter?.boostToEighty?.();
      if (result?.ok) {
        boostBtn.classList.add("boost-done");
        boostBtn.textContent = "Grok building";
        boostBtn.title = result.logFile
          ? `Grok launched (pid ${result.pid}). Log: ${result.logFile}`
          : `Grok launched (pid ${result.pid})`;
      } else {
        boostBtn.classList.add("boost-error");
        boostBtn.textContent = "Failed";
        boostBtn.disabled = false;
        boostBusy = false;
        boostBtn.title = result?.error || "Boost failed";
      }
    } catch (err) {
      boostBtn.classList.add("boost-error");
      boostBtn.textContent = "Failed";
      boostBtn.disabled = false;
      boostBusy = false;
      boostBtn.title = err instanceof Error ? err.message : String(err);
    }
  });
}

window.tokenMeter?.onFaceUpdate?.(applyFace);
requestAnimationFrame(frame);
