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
const bmlWip = document.getElementById("bmlWip");
const bmlChain = document.getElementById("bmlChain");
const mNotes = document.getElementById("mNotes");

const DIAL = 200;

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

  if (view.wipActive != null && bmlWip) {
    bmlWip.textContent = "";
  } else if (bmlWip) {
    bmlWip.textContent = "";
  }

  bmlChain.innerHTML = "";
  const steps = view.skillChain || [];
  steps.forEach((step, i) => {
    const li = document.createElement("li");
    const skillMark = step.skillOk === false ? " ⚠" : step.skillOk ? " ✓" : "";
    li.textContent = `${i + 1}. ${step.command} — ${step.label}${skillMark}`;
    if (step.active) li.classList.add("active");
    // Strikethrough as each task completes (done flag from coach)
    if (step.done) li.classList.add("done");
    li.title = [
      step.role,
      step.phase ? `phase: ${step.phase}` : null,
      step.done ? "completed" : step.active ? "running" : "pending",
      step.skillPath || (step.skillOk === false ? "SKILL.md missing" : null),
    ]
      .filter(Boolean)
      .join("\n");
    bmlChain.appendChild(li);
  });

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
  const btn = document.getElementById("bmlRun");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Running all skills…";
  }
  try {
    // Binds chat project as experiment + auto-runs all Matt skills in order
    const view = await bmlApi()?.runSkillStep();
    applyBml(view);
  } catch (err) {
    console.error("BML chain run failed", err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Run all → Grok";
    }
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
