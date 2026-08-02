"use strict";

const canvas = document.getElementById("gauge");
const cursorPctEl = document.getElementById("cursorPct");
const otherPctEl = document.getElementById("otherPct");
const planEl = document.getElementById("plan");
const legendEl = document.getElementById("legend");
const legendCursorEl = document.getElementById("legendCursor");
const legendOtherEl = document.getElementById("legendOther");
const shellEl = document.getElementById("shell");

const bmlBtn = document.getElementById("bmlBtn");
const bmlPanel = document.getElementById("bmlPanel");
const bmlChain = document.getElementById("bmlChain");
const bmlCost = document.getElementById("bmlCost");
const bmlCancel = document.getElementById("bmlCancel");
const mNotes = document.getElementById("mNotes");

const DIAL = 200;

/** @type {ReturnType<typeof setInterval>|null} */
let bmlElapsedTimer = null;
/** True while a single-skill or full-chain run is in flight from the UI */
let bmlBusy = false;

/**
 * Show Cancel whenever a run is active (UI busy or coach running).
 * @param {any} view
 */
function syncCancelButton(view) {
  if (!bmlCancel) return;
  const show = Boolean(bmlBusy || view?.runCost?.running || view?.canCancel);
  bmlCancel.hidden = !show;
  bmlCancel.disabled = !show;
}

/** Idle face so the dial paints immediately (never a transparent hole). */
const IDLE_FACE = {
  cursor: {
    percent: 0,
    label: "—",
    targetAngle: -120,
    color: "#2563eb",
    arcColor: "#2563eb",
  },
  other: {
    percent: 0,
    label: "—",
    targetAngle: -120,
    color: "#1c1917",
    arcColor: "#2f6f4e",
  },
  plan: "",
  legend: { cursor: "Plan", other: "Ctx" },
  legendText: "Plan · Ctx",
  titleHint: "Grok Usage Meter",
  showingLastGood: false,
  hasFault: false,
  account: "",
};

let face = IDLE_FACE;
let cursorNeedle = { angle: -120, velocity: 0 };
let otherNeedle = { angle: -120, velocity: 0 };
let lastTs = performance.now();
/** @type {any} */
let bml = null;
/** @type {CanvasRenderingContext2D|null} */
let ctx = null;

/**
 * Size the canvas for HiDPI and return a 2d context in CSS-pixel space.
 */
function setupCanvas() {
  if (!canvas) return null;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(DIAL * dpr);
  canvas.height = Math.round(DIAL * dpr);
  canvas.style.width = `${DIAL}px`;
  canvas.style.height = `${DIAL}px`;
  const c = canvas.getContext("2d", { alpha: true });
  if (!c) return null;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return c;
}

ctx = setupCanvas();

function paintFrameFromFace(activeFace, angles) {
  if (window.tokenMeter?.faceFrame) {
    return window.tokenMeter.faceFrame(activeFace, angles);
  }
  return {
    cursorAngle: angles.cursor,
    otherAngle: angles.other,
    cursorColor: activeFace.cursor.color,
    otherColor: activeFace.other.color,
    otherArcColor: activeFace.other.arcColor,
    cursorArcColor: activeFace.cursor.arcColor,
    hasFault: Boolean(activeFace.hasFault),
  };
}

function stepNeedleLocal(state, targetAngle, dt) {
  if (window.tokenMeter?.stepNeedle) {
    return window.tokenMeter.stepNeedle(state, targetAngle, dt);
  }
  const stiffness = 48;
  const damping = 10;
  const displacement = targetAngle - state.angle;
  const acceleration = stiffness * displacement - damping * state.velocity;
  const velocity = state.velocity + acceleration * dt;
  return { angle: state.angle + velocity * dt, velocity };
}

function frame(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;

  if (!ctx) ctx = setupCanvas();
  const draw = globalThis.MeterPaint?.drawMeterFace;
  const active = face || IDLE_FACE;

  if (draw && canvas && ctx) {
    cursorNeedle = stepNeedleLocal(cursorNeedle, active.cursor.targetAngle, dt);
    otherNeedle = stepNeedleLocal(otherNeedle, active.other.targetAngle, dt);
    const paintFrame = paintFrameFromFace(active, {
      cursor: cursorNeedle.angle,
      other: otherNeedle.angle,
    });
    try {
      draw(ctx, paintFrame, { width: DIAL, height: DIAL });
    } catch (err) {
      console.error("Meter paint failed", err);
    }
  }

  requestAnimationFrame(frame);
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
    if (legendCursorEl && payload.legend) {
      legendCursorEl.textContent = payload.legend.cursor;
    }
    if (legendOtherEl && payload.legend) {
      legendOtherEl.textContent = payload.legend.other;
    }
    planEl.textContent = payload.plan || "";
  }

  if (shellEl && payload.titleHint) {
    shellEl.title = payload.titleHint;
  }
}

function applyBml(view) {
  if (!view) return;
  bml = view;

  bmlPanel.hidden = !view.panelOpen;
  document.body.classList.toggle("bml-open", Boolean(view.panelOpen));
  bmlBtn.classList.toggle("active", Boolean(view.panelOpen));
  bmlBtn.setAttribute("aria-expanded", view.panelOpen ? "true" : "false");

  if (bmlChain) {
    bmlChain.innerHTML = "";
    const steps = view.skillChain || [];
    steps.forEach((step, index) => {
      const li = document.createElement("li");
      // Compact: command only (CSS counter handles 1–13)
      li.textContent = step.command || step.label || "";
      li.dataset.stepIndex = String(index);
      li.setAttribute("role", "button");
      li.tabIndex = 0;
      if (step.active) li.classList.add("active");
      if (step.done) li.classList.add("done");
      if (bmlBusy) li.setAttribute("aria-disabled", "true");
      li.title = [
        `Click to run only ${step.command}`,
        step.label,
        step.role,
        step.done ? "completed" : step.active ? "running" : "pending",
        step.skillPath || null,
      ]
        .filter(Boolean)
        .join("\n");
      bmlChain.appendChild(li);
    });
  }

  paintBmlCost(view);
  syncBmlElapsedTick(view);
  syncCancelButton(view);

  const mDuration = document.getElementById("mDuration");
  const mKill = document.getElementById("mKill");
  if (mDuration) mDuration.checked = Boolean(view.measure?.durationElapsed);
  if (mKill) mKill.checked = Boolean(view.measure?.killHit);

  if (mNotes) {
    mNotes.innerHTML = "";
    for (const n of view.measure?.weekNotes || []) {
      const li = document.createElement("li");
      li.textContent = `${n.value ? n.value + " — " : ""}${n.text}`;
      mNotes.appendChild(li);
    }
  }

  // Build/skill UI always available; Measure/Learn only when those stages
  const stage = view.stage || "Backlog";
  const buildSec = document.getElementById("bmlBuildSection");
  const measureSec = document.getElementById("bmlMeasureSection");
  const learnSec = document.getElementById("bmlLearnSection");
  if (buildSec) buildSec.hidden = false;
  if (measureSec) measureSec.hidden = stage !== "Measure";
  if (learnSec) learnSec.hidden = !(stage === "Learn" || stage === "Done");
}

// —— Meter drag (ignore interactive BML chrome) ——

let dragging = false;
let lastX = 0;
let lastY = 0;

function isInteractiveTarget(t) {
  if (!t || !t.closest) return false;
  return Boolean(
    t.closest(
      "#bmlBtn, #bmlPanel, button, input, textarea, a, label, select"
    )
  );
}

window.addEventListener("pointerdown", (e) => {
  if (isInteractiveTarget(e.target)) return;
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
  if (isInteractiveTarget(e.target)) return;
  window.tokenMeter?.refresh()?.then((f) => {
    if (f) applyFace(f);
  });
});

// —— BML actions ——

function bmlApi() {
  return window.tokenMeter?.bml;
}

/**
 * Format whole-run wall-clock (not per-skill).
 * @param {number} sec
 */
function formatElapsedLive(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return m ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${String(rm).padStart(2, "0")}m ${String(r).padStart(2, "0")}s`;
}

/**
 * @param {any} view
 */
function paintBmlCost(view) {
  if (!bmlCost || !view) return;
  const rc = view.runCost || {};
  const running = Boolean(rc.running);
  bmlCost.classList.toggle("running", running);

  if (running && rc.startedAt) {
    const elapsedSec = (Date.now() - rc.startedAt) / 1000;
    const step = Math.min(rc.step || 0, rc.total || 13);
    const total = rc.total || 13;
    const tok = (rc.tokensIn || 0) + (rc.tokensOutEst || 0);
    const tokLabel =
      tok >= 1000 ? `~${Math.round(tok / 1000)}k` : `~${Math.round(tok)}`;
    bmlCost.textContent = `Elapsed ${formatElapsedLive(elapsedSec)} · ${step}/${total} · ${tokLabel}`;
  } else {
    bmlCost.textContent = view.costEstimate || "Est. —";
  }

  const d = view.costEstimateDetail;
  if (d) {
    bmlCost.title = [
      "Whole-run wall clock (not per skill)",
      `${d.steps} Matt skills`,
      `Est. ~${Math.round(d.secondsMin / 60)}–${Math.round(d.secondsMax / 60)} min`,
      `Tokens ~${Math.round(d.tokensMin / 1000)}k–${Math.round(d.tokensMax / 1000)}k`,
      "Click a skill line to run only that step (carte blanche)",
    ].join(" · ");
  }
}

/**
 * Tick the elapsed line every 250ms while a run is active.
 * @param {any} view
 */
function syncBmlElapsedTick(view) {
  const running = Boolean(view?.runCost?.running && view?.runCost?.startedAt);
  if (running && !bmlElapsedTimer) {
    bmlElapsedTimer = setInterval(() => {
      if (bml) paintBmlCost(bml);
    }, 250);
  } else if (!running && bmlElapsedTimer) {
    clearInterval(bmlElapsedTimer);
    bmlElapsedTimer = null;
  }
}

/**
 * Click a chain row (1–13) → run only that Matt skill.
 * @param {number} index
 */
async function runSingleSkill(index) {
  if (bmlBusy || !Number.isInteger(index) || index < 0) return;
  bmlBusy = true;
  syncCancelButton({ runCost: { running: true }, canCancel: true });
  const runBtn = document.getElementById("bmlRun");
  if (runBtn) {
    runBtn.disabled = true;
    runBtn.textContent = `Running #${index + 1}…`;
  }
  if (bmlChain) {
    for (const li of bmlChain.querySelectorAll("li")) {
      li.setAttribute("aria-disabled", "true");
      if (Number(li.dataset.stepIndex) === index) {
        li.classList.add("running-click");
      }
    }
  }
  try {
    const view = await bmlApi()?.runOneSkillStep(index);
    applyBml(view);
  } catch (err) {
    console.error("BML single skill failed", err);
  } finally {
    bmlBusy = false;
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.textContent = "Run All";
    }
    syncCancelButton(bml);
  }
}

bmlChain?.addEventListener("click", (e) => {
  const li = e.target?.closest?.("li[data-step-index]");
  if (!li || li.getAttribute("aria-disabled") === "true") return;
  e.preventDefault();
  e.stopPropagation();
  const index = Number(li.dataset.stepIndex);
  if (Number.isInteger(index)) runSingleSkill(index);
});

bmlChain?.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const li = e.target?.closest?.("li[data-step-index]");
  if (!li) return;
  e.preventDefault();
  const index = Number(li.dataset.stepIndex);
  if (Number.isInteger(index)) runSingleSkill(index);
});

bmlBtn?.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
});

bmlBtn?.addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  try {
    const view = await bmlApi()?.togglePanel();
    applyBml(view);
  } catch (err) {
    console.error("BML toggle failed", err);
  }
});

bmlPanel?.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
});

document.getElementById("bmlRun")?.addEventListener("click", async () => {
  if (bmlBusy) return;
  bmlBusy = true;
  syncCancelButton({ runCost: { running: true }, canCancel: true });
  const btn = document.getElementById("bmlRun");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Running all skills…";
  }
  if (bmlChain) {
    for (const li of bmlChain.querySelectorAll("li")) {
      li.setAttribute("aria-disabled", "true");
    }
  }
  try {
    // Binds chat project as experiment + auto-runs all Matt skills (carte blanche)
    const view = await bmlApi()?.runSkillStep();
    applyBml(view);
  } catch (err) {
    console.error("BML chain run failed", err);
  } finally {
    bmlBusy = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Run All";
    }
    syncCancelButton(bml);
  }
});

bmlCancel?.addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (bmlCancel) {
    bmlCancel.disabled = true;
    bmlCancel.textContent = "Cancelling…";
  }
  try {
    const view = await bmlApi()?.cancel();
    applyBml(view);
  } catch (err) {
    console.error("BML cancel failed", err);
  } finally {
    if (bmlCancel) {
      bmlCancel.textContent = "Cancel";
    }
    // bmlBusy clears when the in-flight run promise settles
    syncCancelButton(bml);
  }
});

document.getElementById("mDuration")?.addEventListener("change", async (e) => {
  applyBml(
    await bmlApi()?.setMeasureFlags({ durationElapsed: e.target.checked })
  );
});

document.getElementById("mKill")?.addEventListener("change", async (e) => {
  applyBml(await bmlApi()?.setMeasureFlags({ killHit: e.target.checked }));
});

document
  .getElementById("bmlPostMeasure")
  ?.addEventListener("click", async () => {
    applyBml(
      await bmlApi()?.postMeasure({
        text: document.getElementById("mText")?.value,
        value: document.getElementById("mValue")?.value,
      })
    );
  });

for (const btn of document.querySelectorAll("[data-learn]")) {
  btn.addEventListener("click", async () => {
    applyBml(
      await bmlApi()?.recordLearn({
        decision: btn.getAttribute("data-learn"),
        evidence: document.getElementById("learnEvidence")?.value,
      })
    );
  });
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && bml?.panelOpen) {
    bmlApi()?.setPanelOpen(false).then(applyBml);
  }
});

// Subscribe to pushes, then pull current face (fixes race before listeners).
window.tokenMeter?.onFaceUpdate?.(applyFace);
window.tokenMeter?.getFace?.()
  .then((f) => {
    if (f) applyFace(f);
  })
  .catch((err) => console.error("getFace failed", err));
window.tokenMeter?.refresh?.()
  .then((f) => {
    if (f) applyFace(f);
  })
  .catch((err) => console.error("refresh failed", err));

window.tokenMeter?.bml?.onState?.(applyBml);
window.tokenMeter?.bml?.getState?.().then(applyBml);

requestAnimationFrame(frame);
