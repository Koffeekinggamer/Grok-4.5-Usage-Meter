"use strict";

const path = require("path");
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { takeReading } = require("./lib/reading");
const { takeEfficiencyReading } = require("./lib/efficiency");
const {
  emptyMeterState,
  reduceMeterState,
  reduceEfficiencyState,
  buildFaceView,
} = require("./lib/meter-state");
const {
  defaultPidPath,
  writePidFile,
  clearPidFile,
} = require("./lib/pidfile");

const POLL_MS = Number(process.env.GUM_POLL_MS) || 60_000;
const EFF_POLL_MS = Number(process.env.GUM_EFF_POLL_MS) || 90_000;
const OVERLAY_ASSERT_MS = Number(process.env.GUM_OVERLAY_MS) || 5_000;
const pidFile = defaultPidPath(path.join(__dirname, ".."));
let mainWindow = null;
let pollTimer = null;
let effPollTimer = null;
let overlayTimer = null;
/** @type {import('./lib/meter-state').MeterState} */
let meterState = emptyMeterState();

/** Combined overlay: usage dial + efficiency panel */
const WIDTH = 368;
const HEIGHT = 200;

/**
 * Park the dial on the primary display, top-right of the work area.
 * Override with GUM_X / GUM_Y if needed.
 */
function defaultBounds() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width } = display.workArea;
  const envX = Number(process.env.GUM_X);
  const envY = Number(process.env.GUM_Y);
  return {
    width: WIDTH,
    height: HEIGHT,
    x: Number.isFinite(envX) ? envX : x + width - WIDTH - 24,
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
    // Order matters on macOS: always-on-top, then all-spaces + fullscreen.
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (typeof win.moveTop === "function") win.moveTop();
  } catch {
    // older Electron — best effort
    try {
      win.setAlwaysOnTop(true);
    } catch {
      // ignore
    }
  }
}

function createWindow() {
  const bounds = defaultBounds();

  /** @type {Electron.BrowserWindowConstructorOptions} */
  const opts = {
    ...bounds,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    minimizable: false,
    closable: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    focusable: false,
    // Don't let the OS hide us when the terminal is focused.
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };

  // Panel windows sit above normal apps more reliably on macOS.
  if (process.platform === "darwin") {
    opts.type = "panel";
  }

  mainWindow = new BrowserWindow(opts);

  assertOverlay(mainWindow);
  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // show() (not showInactive) so the first paint is visible.
    mainWindow.show();
    assertOverlay(mainWindow);
    // Nudge to front again after the compositor settles.
    setTimeout(() => assertOverlay(mainWindow), 250);
    setTimeout(() => assertOverlay(mainWindow), 1000);
  });

  // Re-assert after display / space changes.
  mainWindow.on("blur", () => assertOverlay(mainWindow));
  mainWindow.on("show", () => assertOverlay(mainWindow));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function publishFace() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const face = buildFaceView(meterState);
  mainWindow.webContents.send("meter:face", face);
}

async function refreshUsage() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const event = await takeReading();
  meterState = reduceMeterState(meterState, event);
  publishFace();
  // Stay above Terminal while the session is live.
  assertOverlay(mainWindow);
}

async function refreshEfficiency() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const event = await takeEfficiencyReading();
  meterState = reduceEfficiencyState(meterState, event);
  publishFace();
  assertOverlay(mainWindow);
}

async function refreshAll() {
  await Promise.all([refreshUsage(), refreshEfficiency()]);
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  if (effPollTimer) clearInterval(effPollTimer);
  refreshAll();
  pollTimer = setInterval(refreshUsage, POLL_MS);
  effPollTimer = setInterval(refreshEfficiency, EFF_POLL_MS);
}

function startOverlayAssert() {
  if (overlayTimer) clearInterval(overlayTimer);
  overlayTimer = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      assertOverlay(mainWindow);
    }
  }, OVERLAY_ASSERT_MS);
}

app.whenReady().then(() => {
  // Accessory: no Dock bounce / menu bar app competition; better as an overlay.
  if (process.platform === "darwin" && app.dock) {
    try {
      app.dock.hide();
    } catch {
      // ignore
    }
  }

  writePidFile(pidFile, process.pid);
  createWindow();
  startPolling();
  startOverlayAssert();

  // If the user plugs a display or the menu bar moves, re-park top-right
  // unless they set GUM_X/GUM_Y.
  screen.on("display-metrics-changed", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (process.env.GUM_X || process.env.GUM_Y) return;
    const b = defaultBounds();
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
  if (effPollTimer) clearInterval(effPollTimer);
  if (overlayTimer) clearInterval(overlayTimer);
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("usage:refresh", async () => {
  await refreshAll();
});

ipcMain.on("window:drag", (_event, { dx, dy }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
  assertOverlay(mainWindow);
});
