"use strict";

/**
 * Headless-ish UI proof for the Meter overlay.
 * Run: env -u ELECTRON_RUN_AS_NODE electron scripts/verify-meter-ui.js
 *
 * Passes only when:
 *  - no renderer console errors
 *  - MeterPaint + tokenMeter present
 *  - face labels are numeric (not idle em-dash)
 *  - canvas has non-uniform painted pixels (dial tracks/needles)
 *  - screenshot written for visual inspection
 */

const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain } = require("electron");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "tmp");
const SHOT = path.join(OUT_DIR, "meter-verify.png");

/** @type {string[]} */
const consoleLines = [];
let mainWindow = null;

// Re-use production main pieces via require of libs only; keep window simple.
const { takeReading } = require("../src/lib/reading");
const {
  emptyMeterState,
  reduceMeterState,
  buildFaceView,
} = require("../src/lib/meter-state");

let meterState = emptyMeterState();

function fail(msg) {
  console.error("VERIFY FAIL:", msg);
  console.error("--- renderer console ---");
  console.error(consoleLines.join("\n") || "(empty)");
  app.exit(1);
}

function ok(msg) {
  console.log("VERIFY OK:", msg);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  ipcMain.handle("meter:getFace", async () => buildFaceView(meterState));
  ipcMain.handle("usage:refresh", async () => {
    const event = await takeReading();
    meterState = reduceMeterState(meterState, event);
    const face = buildFaceView(meterState);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("meter:face", face);
    }
    return face;
  });
  // BML stubs so preload does not hang if invoked
  for (const ch of [
    "bml:getState",
    "bml:setPanelOpen",
    "bml:togglePanel",
    "bml:setFields",
    "bml:createExperiment",
    "bml:selectExperiment",
    "bml:refreshBoard",
    "bml:advanceStage",
    "bml:runSkillStep",
    "bml:nextSkillStep",
    "bml:skipOptionalStep",
    "bml:setTinyBuild",
    "bml:setBuildFlags",
    "bml:setMeasureFlags",
    "bml:postMeasure",
    "bml:recordLearn",
    "bml:setStep",
    "bml:openUrl",
  ]) {
    ipcMain.handle(ch, async () => null);
  }
  ipcMain.on("window:drag", () => {});

  mainWindow = new BrowserWindow({
    width: 200,
    height: 200,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    show: true,
    webPreferences: {
      preload: path.join(ROOT, "src", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    const row = `[${level}] ${message} (${sourceId}:${line})`;
    consoleLines.push(row);
    console.log("RENDERER:", row);
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    fail(`did-fail-load ${code} ${desc}`);
  });

  await mainWindow.loadFile(path.join(ROOT, "src", "renderer", "index.html"));

  // Seed a known reading so face is deterministic if live API fails.
  try {
    const event = await takeReading();
    meterState = reduceMeterState(meterState, event);
  } catch (err) {
    console.warn("live reading failed, using synthetic", err);
    meterState = reduceMeterState(meterState, {
      ok: true,
      reading: {
        percent: 25,
        used: 100,
        limit: 400,
        remaining: 300,
        planPercentUsed: 25,
        contextPercentUsed: 60,
        onDemandPercentUsed: null,
        onDemandUsed: 0,
        onDemandCap: 0,
        contextTokensUsed: 300000,
        contextWindowTokens: 500000,
        model: "grok-4.5",
        sessionId: "verify",
        membershipType: "grok",
        isUnlimited: false,
        billingCycleStart: null,
        billingCycleEnd: null,
        displayMessage: null,
        email: "verify@test",
      },
    });
  }

  const face = buildFaceView(meterState);
  mainWindow.webContents.send("meter:face", face);

  // Allow paint loop + async getFace/refresh in renderer to settle
  await new Promise((r) => setTimeout(r, 1500));

  const diag = await mainWindow.webContents.executeJavaScript(`
    (() => {
      const canvas = document.getElementById("gauge");
      const ctx = canvas && canvas.getContext("2d");
      let sample = null;
      let nonCream = 0;
      let total = 0;
      if (ctx && canvas) {
        // Read CSS-pixel logical buffer (may be HiDPI — sample full bitmap)
        const w = canvas.width;
        const h = canvas.height;
        const img = ctx.getImageData(0, 0, w, h);
        const d = img.data;
        // Sample a grid
        for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 40))) {
          for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 40))) {
            const i = (y * w + x) * 4;
            const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
            total++;
            // Cream plate is roughly r>180,g>170,b>150 — needles/arcs are darker/bluer
            const isCream =
              a > 200 && r > 175 && g > 165 && b > 145 && Math.abs(r - g) < 40;
            const isTransparent = a < 10;
            if (!isCream && !isTransparent && a > 100) nonCream++;
          }
        }
        // Center pixel
        const ci = (Math.floor(h/2) * w + Math.floor(w/2)) * 4;
        sample = { r: d[ci], g: d[ci+1], b: d[ci+2], a: d[ci+3], w, h };
      }
      return {
        hasTokenMeter: typeof window.tokenMeter === "object" && window.tokenMeter !== null,
        hasMeterPaint: typeof globalThis.MeterPaint?.drawMeterFace === "function",
        cursorText: document.getElementById("cursorPct")?.textContent || null,
        otherText: document.getElementById("otherPct")?.textContent || null,
        planText: document.getElementById("plan")?.textContent || null,
        canvasW: canvas?.width || 0,
        canvasH: canvas?.height || 0,
        sample,
        nonCream,
        total,
        errors: performance.getEntriesByType?.("resource") ? null : null,
      };
    })()
  `);

  console.log("DIAG:", JSON.stringify(diag, null, 2));

  const img = await mainWindow.webContents.capturePage();
  fs.writeFileSync(SHOT, img.toPNG());
  ok(`screenshot ${SHOT} (${img.getSize().width}x${img.getSize().height})`);

  const errors = consoleLines.filter(
    (l) => /SyntaxError|Uncaught|TypeError|ReferenceError/i.test(l)
  );
  if (errors.length) {
    fail("renderer console errors:\n" + errors.join("\n"));
  }
  if (!diag.hasTokenMeter) fail("tokenMeter missing (preload failed)");
  if (!diag.hasMeterPaint) fail("MeterPaint.drawMeterFace missing");
  if (!diag.canvasW || !diag.canvasH) fail("canvas has zero size");

  // Labels should not stay idle em dash once face applied
  const idle = (t) => t === "—" || t === "-" || t === "–" || t === "—" || !t;
  if (idle(diag.cursorText) && idle(diag.otherText)) {
    // Try one more forced push + wait
    mainWindow.webContents.send("meter:face", face);
    await new Promise((r) => setTimeout(r, 500));
    const again = await mainWindow.webContents.executeJavaScript(`({
      c: document.getElementById("cursorPct")?.textContent,
      o: document.getElementById("otherPct")?.textContent,
    })`);
    console.log("labels after re-push:", again);
    if (idle(again.c) && idle(again.o)) {
      fail(
        `labels still idle after face push (cursor=${again.c} other=${again.o}); face was ${face.cursor.label}/${face.other.label}`
      );
    }
  }

  // Canvas must show something other than empty cream / transparent
  if (diag.nonCream < 3) {
    fail(
      `canvas looks unpainted (nonCream samples=${diag.nonCream}/${diag.total}, sample=${JSON.stringify(diag.sample)})`
    );
  }

  ok(`labels ${diag.cursorText} · ${diag.otherText}`);
  ok(`canvas paint samples nonCream=${diag.nonCream}/${diag.total}`);
  ok("all checks passed");
  app.exit(0);
});

app.on("window-all-closed", (e) => e.preventDefault());
