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
const bmlStageChip = document.getElementById("bmlStageChip");
const bmlStage = document.getElementById("bmlStage");
const bmlIssue = document.getElementById("bmlIssue");
const bmlWip = document.getElementById("bmlWip");
const bmlError = document.getElementById("bmlError");
const bmlStatus = document.getElementById("bmlStatus");
const bmlGate = document.getElementById("bmlGate");
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

function readFieldsFromForm() {
  return {
    hypothesis: document.getElementById("fHypothesis").value,
    build: document.getElementById("fBuild").value,
    measure: document.getElementById("fMeasure").value,
    learn: "",
    acceptanceCriteria: document.getElementById("fAC").value,
    technicalContext: document.getElementById("fTech").value,
  };
}

function applyBml(view) {
  if (!view) return;
  bml = view;

  bmlPanel.hidden = !view.panelOpen;
  document.body.classList.toggle("bml-open", Boolean(view.panelOpen));
  bmlBtn.classList.toggle("active", Boolean(view.panelOpen));
  bmlBtn.setAttribute("aria-expanded", view.panelOpen ? "true" : "false");

  if (view.stage) {
    bmlStage.textContent = view.stage;
    bmlStageChip.hidden = false;
    bmlStageChip.textContent = view.stage;
  }

  if (view.activeIssue) {
    bmlIssue.textContent = "";
    const link = document.createElement("button");
    link.type = "button";
    link.className = "btn ghost xs";
    link.textContent = `#${view.activeIssue.number}`;
    link.title = view.activeIssue.url;
    link.addEventListener("click", (e) => {
      e.stopPropagation();
      bmlApi()?.openUrl(view.activeIssue.url);
    });
    bmlIssue.appendChild(link);
    bmlIssue.appendChild(
      document.createTextNode(" " + view.activeIssue.title)
    );
  } else {
    bmlIssue.textContent = "No experiment selected — create one below";
  }

  if (view.wipActive != null) {
    bmlWip.textContent = `WIP ${view.wipActive}/${view.wipLimit}`;
  } else {
    bmlWip.textContent = `WIP ?/${view.wipLimit || 3}`;
  }

  if (view.lastError) {
    bmlError.hidden = false;
    bmlError.textContent = view.lastError;
  } else {
    bmlError.hidden = true;
    bmlError.textContent = "";
  }

  if (view.lastInject?.detail) {
    bmlStatus.hidden = false;
    bmlStatus.textContent = `${view.lastInject.ok ? "✓" : "…"} ${view.lastInject.method}: ${view.lastInject.detail}`;
  } else {
    bmlStatus.hidden = true;
  }

  if (view.canAdvance) {
    bmlGate.textContent = view.nextStage
      ? `Ready to move → ${view.nextStage}`
      : "";
  } else {
    bmlGate.textContent = (view.advanceErrors || []).join(" · ");
  }

  const projEl = document.getElementById("bmlProject");
  if (projEl) {
    if (view.project?.cwd) {
      const short = view.project.cwd.replace(/^.*?([^/]+)$/, "$1");
      projEl.textContent = `Active project: ${view.project.name || short} · ${view.project.cwd}${
        view.project.hasContextMd ? " · CONTEXT.md" : ""
      }`;
      projEl.title = [
        ...(view.project.buildNatures || []).map((n) => `Build: ${n}`),
        ...(view.project.measureNatures || []).map((n) => `Measure: ${n}`),
      ].join("\n");
    } else {
      projEl.textContent = "Active project: (none — open Grok in a repo)";
      projEl.title = "";
    }
  }

  

  bmlChain.innerHTML = "";
  for (const step of view.skillChain || []) {
    const li = document.createElement("li");
    const skillMark = step.skillOk === false ? " ⚠" : step.skillOk ? " ✓" : "";
    li.textContent = `${step.command} — ${step.label}${skillMark}`;
    if (step.active) li.classList.add("active");
    if (step.done) li.classList.add("done");
    li.title = [
      step.role,
      step.phase ? `phase: ${step.phase}` : null,
      step.skillPath || (step.skillOk === false ? "SKILL.md missing" : null),
    ]
      .filter(Boolean)
      .join("\n");
    bmlChain.appendChild(li);
  }

  document.getElementById("bmlSkip").disabled = !view.canSkipCurrent;
  document.getElementById("bmlShipped").checked = Boolean(
    view.build?.smallestTestShipped
  );
  document.getElementById("bmlMeasurePath").checked = Boolean(
    view.build?.measurePathNamed
  );
  document.getElementById("mDuration").checked = Boolean(
    view.measure?.durationElapsed
  );
  document.getElementById("mKill").checked = Boolean(view.measure?.killHit);

  mNotes.innerHTML = "";
  for (const n of view.measure?.weekNotes || []) {
    const li = document.createElement("li");
    li.textContent = `${n.value ? n.value + " — " : ""}${n.text}`;
    mNotes.appendChild(li);
  }

  const stage = view.stage || "Backlog";
  document.getElementById("bmlCreateSection").hidden = Boolean(
    view.activeIssue
  );
  document.getElementById("bmlBuildSection").hidden = !(
    stage === "Build" || stage === "Backlog"
  );
  document.getElementById("bmlMeasureSection").hidden = stage !== "Measure";
  document.getElementById("bmlLearnSection").hidden = !(
    stage === "Learn" || stage === "Done"
  );
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

document.getElementById("bmlRefresh")?.addEventListener("click", async () => {
  applyBml(await bmlApi()?.refreshBoard());
});

document.getElementById("bmlAdvance")?.addEventListener("click", async () => {
  applyBml(await bmlApi()?.advanceStage());
});

document.getElementById("bmlCreate")?.addEventListener("click", async () => {
  applyBml(await bmlApi()?.createExperiment(readFieldsFromForm()));
});

document
  .getElementById("bmlFromProject")
  ?.addEventListener("click", async () => {
    const view = await bmlApi()?.applyProjectToFields({ force: true });
    applyBml(view);
    if (view?.fields) {
      const set = (id, val) => {
        const el = document.getElementById(id);
        if (el && val != null) el.value = val;
      };
      set("fHypothesis", view.fields.hypothesis);
      set("fBuild", view.fields.build);
      set("fMeasure", view.fields.measure);
      set("fAC", view.fields.acceptanceCriteria);
      set("fTech", view.fields.technicalContext);
    }
  });

document.getElementById("bmlRun")?.addEventListener("click", async () => {
  await bmlApi()?.setFields(readFieldsFromForm());
  applyBml(await bmlApi()?.runSkillStep());
});

document.getElementById("bmlNext")?.addEventListener("click", async () => {
  applyBml(await bmlApi()?.nextSkillStep());
});

document.getElementById("bmlSkip")?.addEventListener("click", async () => {
  applyBml(await bmlApi()?.skipOptionalStep());
});

document.getElementById("bmlTiny")?.addEventListener("click", async () => {
  applyBml(await bmlApi()?.setTinyBuild());
});

document.getElementById("bmlShipped")?.addEventListener("change", async (e) => {
  applyBml(
    await bmlApi()?.setBuildFlags({ smallestTestShipped: e.target.checked })
  );
});

document
  .getElementById("bmlMeasurePath")
  ?.addEventListener("change", async (e) => {
    applyBml(
      await bmlApi()?.setBuildFlags({ measurePathNamed: e.target.checked })
    );
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
        text: document.getElementById("mText").value,
        value: document.getElementById("mValue").value,
      })
    );
  });

for (const btn of document.querySelectorAll("[data-learn]")) {
  btn.addEventListener("click", async () => {
    applyBml(
      await bmlApi()?.recordLearn({
        decision: btn.getAttribute("data-learn"),
        evidence: document.getElementById("learnEvidence").value,
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
// Force a refresh so numbers update even if first push was lost.
window.tokenMeter?.refresh?.()
  .then((f) => {
    if (f) applyFace(f);
  })
  .catch((err) => console.error("refresh failed", err));

window.tokenMeter?.bml?.onState?.(applyBml);
window.tokenMeter?.bml?.getState?.().then(applyBml);

requestAnimationFrame(frame);
