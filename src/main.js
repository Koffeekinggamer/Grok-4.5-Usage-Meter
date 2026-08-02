"use strict";

const path = require("path");
const { app, BrowserWindow, ipcMain, screen, shell } = require("electron");
const { takeReading } = require("./lib/reading");
const {
  emptyMeterState,
  reduceMeterState,
  buildFaceView,
} = require("./lib/meter-state");
const {
  defaultPidPath,
  clearPidFile,
  claimMeterSingleton,
} = require("./lib/pidfile");
const { createBmlCoach } = require("./lib/bml/coach");

const POLL_MS = Number(process.env.GUM_POLL_MS) || 60_000;
const OVERLAY_ASSERT_MS = Number(process.env.GUM_OVERLAY_MS) || 5_000;
const ROOT = path.join(__dirname, "..");
const pidFile = defaultPidPath(ROOT);

const SIZE = 200;
/** Collapsed = dial only (BML chip overlays the plate). Expanded = coach + dial. */
const COLLAPSED = { width: 200, height: 200 };
const EXPANDED = { width: 420, height: 520 };

// One Meter overlay per machine install — second launch focuses the first.
const gotSingletonLock = app.requestSingleInstanceLock();
if (!gotSingletonLock) {
  app.quit();
}

let mainWindow = null;
let pollTimer = null;
let overlayTimer = null;
/** @type {import('./lib/meter-state').MeterState} */
let meterState = emptyMeterState();
/** @type {ReturnType<typeof createBmlCoach>|null} */
let bmlCoach = null;

/**
 * Park the dial on the primary display, top-right of the work area.
 * Override with GUM_X / GUM_Y if needed.
 */
function defaultBounds(size = COLLAPSED) {
  const display = screen.getPrimaryDisplay();
  const { x, y, width } = display.workArea;
  const envX = Number(process.env.GUM_X);
  const envY = Number(process.env.GUM_Y);
  return {
    width: size.width,
    height: size.height,
    x: Number.isFinite(envX) ? envX : x + width - size.width - 24,
    y: Number.isFinite(envY) ? envY : y + 24,
  };
}

/**
 * Keep the Meter above Terminal / fullscreen Grok on macOS.
 * screen-saver is the highest public always-on-top level.
 */
function assertOverlay(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (typeof win.moveTop === "function") win.moveTop();
  } catch {
    try {
      win.setAlwaysOnTop(true);
    } catch {
      // ignore
    }
  }
}

/**
 * Resize for BML panel open/closed, keeping top-right anchor when possible.
 * @param {boolean} panelOpen
 */
function applyPanelLayout(panelOpen) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const size = panelOpen ? EXPANDED : COLLAPSED;
  const [x, y] = mainWindow.getPosition();
  const [prevW] = mainWindow.getSize();
  // Keep right edge stable when expanding/collapsing.
  const nextX = x + (prevW - size.width);
  mainWindow.setBounds({
    x: Math.round(nextX),
    y: Math.round(y),
    width: size.width,
    height: size.height,
  });
  // Panel needs focus for text fields; collapsed stays non-focus-stealing.
  try {
    mainWindow.setFocusable(true);
    if (panelOpen) {
      mainWindow.focus();
      mainWindow.webContents.focus();
    } else {
      // Return to non-focusable overlay after panel closes (macOS panel).
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (bmlCoach?.getState()?.panelOpen) return;
        try {
          mainWindow.setFocusable(false);
        } catch {
          // ignore
        }
      }, 150);
    }
  } catch {
    // ignore
  }
  assertOverlay(mainWindow);
}

function currentFace() {
  return buildFaceView(meterState);
}

function publishFace() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("meter:face", currentFace());
}

function publishBml(view) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("bml:state", view);
}

function createWindow() {
  const bounds = defaultBounds(COLLAPSED);

  /** @type {Electron.BrowserWindowConstructorOptions} */
  const opts = {
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    minimizable: false,
    closable: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    // false so the dial does not steal Terminal focus; BML open re-enables focus.
    focusable: false,
    // First click activates controls without a separate focus click (macOS).
    acceptFirstMouse: true,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  };

  if (process.platform === "darwin") {
    opts.type = "panel";
  }

  mainWindow = new BrowserWindow(opts);

  assertOverlay(mainWindow);
  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  // After the renderer has run scripts, push face + kick a fresh reading.
  // (ipc send before listeners are registered is dropped.)
  mainWindow.webContents.on("did-finish-load", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    publishFace();
    if (bmlCoach) publishBml(bmlCoach.getView());
    refreshUsage();
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    assertOverlay(mainWindow);
    publishFace();
    setTimeout(() => assertOverlay(mainWindow), 250);
    setTimeout(() => assertOverlay(mainWindow), 1000);
    if (bmlCoach) {
      const view = bmlCoach.getView();
      if (view.panelOpen) applyPanelLayout(true);
      publishBml(view);
    }
  });

  mainWindow.on("blur", () => assertOverlay(mainWindow));
  mainWindow.on("show", () => assertOverlay(mainWindow));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function refreshUsage() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const event = await takeReading();
  meterState = reduceMeterState(meterState, event);
  publishFace();
  assertOverlay(mainWindow);
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  refreshUsage();
  pollTimer = setInterval(refreshUsage, POLL_MS);
}

function startOverlayAssert() {
  if (overlayTimer) clearInterval(overlayTimer);
  overlayTimer = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      assertOverlay(mainWindow);
    }
  }, OVERLAY_ASSERT_MS);
}

function registerBmlIpc() {
  ipcMain.handle("bml:getState", async () => bmlCoach?.getView() || null);

  ipcMain.handle("bml:setPanelOpen", async (_e, open) => {
    const view = bmlCoach.setPanelOpen(Boolean(open));
    applyPanelLayout(view.panelOpen);
    publishBml(view);
    return view;
  });

  ipcMain.handle("bml:togglePanel", async () => {
    const view = bmlCoach.togglePanel();
    applyPanelLayout(view.panelOpen);
    publishBml(view);
    return view;
  });

  ipcMain.handle("bml:setFields", async (_e, fields) => {
    const view = bmlCoach.setFields(fields);
    publishBml(view);
    return view;
  });

  ipcMain.handle("bml:applyProjectToFields", async (_e, opts) => {
    const view = bmlCoach.applyProjectToFields(opts || {});
    publishBml(view);
    return view;
  });

  ipcMain.handle("bml:createExperiment", async (_e, fields) => {
    const view = await bmlCoach.createExperiment(fields);
    publishBml(view);
    return view;
  });

  ipcMain.handle("bml:selectExperiment", async (_e, issueRef) => {
    const view = await bmlCoach.selectExperiment(issueRef);
    publishBml(view);
    return view;
  });

  ipcMain.handle("bml:refreshBoard", async () => {
    const view = await bmlCoach.refreshBoard();
    publishBml(view);
    return view;
  });

  ipcMain.handle("bml:advanceStage", async () => {
    const view = await bmlCoach.advanceStage();
    publishBml(view);
    return view;
  });

  ipcMain.handle("bml:runSkillStep", async () => {
    const view = await bmlCoach.runSkillStep();
    publishBml(view);
    return view;
  });

  ipcMain.handle("bml:nextSkillStep", async () => {
    const view = bmlCoach.nextSkillStep();
    publishBml(view);
    return view;
  });

  ipcMain.handle("bml:skipOptionalStep", async () => {
    const view = bmlCoach.skipOptionalStep();
    publishBml(view);
    return view;
  });

  ipcMain.handle("bml:setTinyBuild", async () => {
    const view = bmlCoach.setTinyBuild();
    publishBml(view);
    return view;
  });

  ipcMain.handle("bml:setBuildFlags", async (_e, flags) => {
    const view = bmlCoach.setBuildFlags(flags || {});
    publishBml(view);
    return view;
  });

  ipcMain.handle("bml:setMeasureFlags", async (_e, flags) => {
    const view = bmlCoach.setMeasureFlags(flags || {});
    publishBml(view);
    return view;
  });

  ipcMain.handle("bml:postMeasure", async (_e, note) => {
    const view = await bmlCoach.postMeasure(note || {});
    publishBml(view);
    return view;
  });

  ipcMain.handle("bml:recordLearn", async (_e, payload) => {
    const view = await bmlCoach.recordLearn(
      payload?.decision,
      payload?.evidence
    );
    publishBml(view);
    return view;
  });

  ipcMain.handle("bml:setStep", async (_e, index) => {
    const view = bmlCoach.setStep(index);
    publishBml(view);
    return view;
  });

  ipcMain.handle("bml:openUrl", async (_e, url) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      await shell.openExternal(url);
      return true;
    }
    return false;
  });
}

/**
 * Production self-test: capture page + renderer diagnostics, write under tmp/, exit.
 * Run: GUM_SELFTEST=1 npm start
 */
async function runSelfTest() {
  const fs = require("fs");
  const outDir = path.join(ROOT, "tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const shotPath = path.join(outDir, "meter-selftest.png");
  const logPath = path.join(outDir, "meter-selftest.json");

  // Wait for first reading + paint loop
  await new Promise((r) => setTimeout(r, 2000));
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.error("SELFTEST FAIL: no window");
    app.exit(1);
    return;
  }

  const diag = await mainWindow.webContents.executeJavaScript(`
    (() => {
      const canvas = document.getElementById("gauge");
      const ctx = canvas && canvas.getContext("2d");
      let nonCream = 0, total = 0, sample = null;
      if (ctx && canvas) {
        const w = canvas.width, h = canvas.height;
        const d = ctx.getImageData(0, 0, w, h).data;
        for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 40))) {
          for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 40))) {
            const i = (y * w + x) * 4;
            total++;
            const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
            const isCream = a > 200 && r > 175 && g > 165 && b > 145 && Math.abs(r - g) < 40;
            if (a > 100 && !isCream) nonCream++;
          }
        }
        const ci = (Math.floor(h/2) * w + Math.floor(w/2)) * 4;
        sample = { r: d[ci], g: d[ci+1], b: d[ci+2], a: d[ci+3], w, h };
      }
      return {
        hasTokenMeter: !!window.tokenMeter,
        hasMeterPaint: typeof globalThis.MeterPaint?.drawMeterFace === "function",
        cursorText: document.getElementById("cursorPct")?.textContent,
        otherText: document.getElementById("otherPct")?.textContent,
        planText: document.getElementById("plan")?.textContent,
        nonCream, total, sample,
      };
    })()
  `);

  const img = await mainWindow.webContents.capturePage();
  fs.writeFileSync(shotPath, img.toPNG());
  const report = {
    diag,
    shotPath,
    face: currentFace(),
    consoleHint: "see stderr for renderer console if wired",
  };
  fs.writeFileSync(logPath, JSON.stringify(report, null, 2));
  console.log("SELFTEST REPORT", JSON.stringify(report, null, 2));

  const idle = (t) => !t || t === "—" || t === "-" || t === "–";
  let code = 0;
  if (!diag.hasTokenMeter || !diag.hasMeterPaint) code = 1;
  if (idle(diag.cursorText) && idle(diag.otherText)) code = 1;
  if (diag.nonCream < 3) code = 1;
  if (code === 0) console.log("SELFTEST PASS");
  else console.error("SELFTEST FAIL");
  app.exit(code);
}

app.whenReady().then(() => {
  if (!gotSingletonLock) return;

  if (process.platform === "darwin" && app.dock) {
    try {
      app.dock.hide();
    } catch {
      // ignore
    }
  }

  bmlCoach = createBmlCoach({
    appData: app.getPath("userData"),
  });

  claimMeterSingleton(ROOT, process.pid);
  registerBmlIpc();
  createWindow();
  startPolling();
  startOverlayAssert();

  if (process.env.GUM_SELFTEST === "1") {
    mainWindow?.webContents?.on("console-message", (_e, level, message, line, sourceId) => {
      console.log(`RENDERER[${level}] ${message} (${sourceId}:${line})`);
    });
    runSelfTest().catch((err) => {
      console.error("SELFTEST ERROR", err);
      app.exit(1);
    });
    return;
  }

  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      startPolling();
      startOverlayAssert();
      return;
    }
    mainWindow.show();
    assertOverlay(mainWindow);
  });

  screen.on("display-metrics-changed", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (process.env.GUM_X || process.env.GUM_Y) return;
    const open = bmlCoach?.getState()?.panelOpen;
    const b = defaultBounds(open ? EXPANDED : COLLAPSED);
    mainWindow.setBounds(b);
    assertOverlay(mainWindow);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      startPolling();
      startOverlayAssert();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      assertOverlay(mainWindow);
    }
  });
});

app.on("will-quit", () => {
  clearPidFile(pidFile);
  if (overlayTimer) clearInterval(overlayTimer);
});

app.on("window-all-closed", () => {
  if (pollTimer) clearInterval(pollTimer);
  if (overlayTimer) clearInterval(overlayTimer);
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("usage:refresh", async () => {
  await refreshUsage();
  return currentFace();
});

ipcMain.handle("meter:getFace", async () => currentFace());

ipcMain.on("window:drag", (_event, { dx, dy }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
  assertOverlay(mainWindow);
});
