"use strict";

const fs = require("fs");
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
  clearPidFile,
  isPidAlive,
  claimMeterSingleton,
} = require("./lib/pidfile");
const { getActiveSessionsPath } = require("./lib/paths");
const { resolveOpenProject } = require("./lib/project");
const {
  launchBoost,
  alreadyAtTarget,
  MIN_TARGET,
} = require("./lib/boost");

// Plan usage is account-wide — keep polling regardless of open project.
const POLL_MS = Number(process.env.GUM_POLL_MS) || 60_000;
// Efficiency follows the live project; poll often + watch active_sessions.
const EFF_POLL_MS = Number(process.env.GUM_EFF_POLL_MS) || 15_000;
const OVERLAY_ASSERT_MS = Number(process.env.GUM_OVERLAY_MS) || 5_000;
const ROOT = path.join(__dirname, "..");
const pidFile = defaultPidPath(ROOT);

// One Meter overlay per machine install — second launch focuses the first.
const gotSingletonLock = app.requestSingleInstanceLock();
if (!gotSingletonLock) {
  app.quit();
}

let mainWindow = null;
let pollTimer = null;
let effPollTimer = null;
let overlayTimer = null;
let sessionsWatcher = null;
let boostWatchTimer = null;
/** @type {import('./lib/meter-state').MeterState} */
let meterState = emptyMeterState();
/** Last project root we scored — detect live switches */
let lastEfficiencyRoot = null;

/**
 * @type {{
 *   status: 'idle'|'running'|'done'|'error',
 *   label: string,
 *   title?: string,
 *   disabled?: boolean,
 *   pid?: number|null,
 *   logFile?: string|null,
 * }}
 */
let boostUi = {
  status: "idle",
  label: "↑ 80%",
  title:
    "Auto-prompt Grok with carte blanche to raise Arch · Eff · UI to ≥80%",
  disabled: false,
  pid: null,
  logFile: null,
};

/**
 * Serialize state commits so usage + efficiency never clobber each other.
 * (Parallel await + `meterState = reduce...` races lose readings.)
 * @type {Promise<void>}
 */
let commitChain = Promise.resolve();

/** Combined overlay: usage dial + efficiency panel + boost button */
const WIDTH = 368;
const HEIGHT = 228;

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
    // true so the ↑ 80% button can receive clicks reliably on macOS
    focusable: true,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };

  if (process.platform === "darwin") {
    opts.type = "panel";
  }

  mainWindow = new BrowserWindow(opts);

  assertOverlay(mainWindow);
  mainWindow.setIgnoreMouseEvents(false);
  // Clicking the boost control should not require activating another app first
  if (typeof mainWindow.setVisibleOnAllWorkspaces === "function") {
    try {
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {
      // ignore
    }
  }
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    assertOverlay(mainWindow);
    setTimeout(() => assertOverlay(mainWindow), 250);
    setTimeout(() => assertOverlay(mainWindow), 1000);
  });

  mainWindow.on("blur", () => assertOverlay(mainWindow));
  mainWindow.on("show", () => assertOverlay(mainWindow));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function publishFace() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const face = buildFaceView(meterState);
  const hasProject = Boolean(meterState.efficiencyReading?.projectRoot);
  const atTarget =
    hasProject && alreadyAtTarget(meterState.efficiencyReading, MIN_TARGET);

  if (boostUi.status === "idle") {
    face.boost = {
      status: "idle",
      label: atTarget ? "≥80 ✓" : "↑ 80%",
      disabled: !hasProject,
      title: !hasProject
        ? "No project to boost — open a build in Grok first"
        : atTarget
          ? `All bars already ≥${MIN_TARGET}% — click to push further`
          : `Carte blanche: launch Grok to raise Arch · Eff · UI to ≥${MIN_TARGET}%`,
    };
  } else {
    face.boost = { ...boostUi };
  }

  mainWindow.webContents.send("meter:face", face);
}

function setBoostUi(next) {
  boostUi = { ...boostUi, ...next };
  publishFace();
}

function watchBoostPid(pid) {
  if (boostWatchTimer) clearInterval(boostWatchTimer);
  boostWatchTimer = setInterval(() => {
    if (!pid || !isPidAlive(pid)) {
      clearInterval(boostWatchTimer);
      boostWatchTimer = null;
      setBoostUi({
        status: "idle",
        label: "↑ 80%",
        pid: null,
        disabled: false,
      });
      // Rescore after the headless run ends
      refreshEfficiency();
      return;
    }
  }, 4000);
}

/**
 * Apply a pure state transition on the serialized commit chain.
 * @param {(state: import('./lib/meter-state').MeterState) => import('./lib/meter-state').MeterState} fn
 */
function commit(fn) {
  commitChain = commitChain.then(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    meterState = fn(meterState);
    publishFace();
    assertOverlay(mainWindow);
  });
  return commitChain;
}

/**
 * Plan + context usage — always, any project / home session.
 */
async function refreshUsage() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const event = await takeReading();
  await commit((state) => reduceMeterState(state, event));
}

/**
 * Efficiency scores for the *currently open* project only.
 */
async function refreshEfficiency() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const event = await takeEfficiencyReading();

  if (event.ok) {
    const root = event.reading.projectRoot;
    if (lastEfficiencyRoot && lastEfficiencyRoot !== root) {
      // Project switched — drop previous hold before applying new scores
      lastEfficiencyRoot = root;
    } else {
      lastEfficiencyRoot = root;
    }
  } else if (event.fault?.kind === "no-project") {
    lastEfficiencyRoot = null;
  }

  await commit((state) => reduceEfficiencyState(state, event));
}

async function refreshAll() {
  // Fetch in parallel (network + disk), commit serially so neither side is lost.
  const [usageEvent, effEvent] = await Promise.all([
    takeReading(),
    takeEfficiencyReading(),
  ]);
  if (effEvent.ok) {
    lastEfficiencyRoot = effEvent.reading.projectRoot;
  } else if (effEvent.fault?.kind === "no-project") {
    lastEfficiencyRoot = null;
  }
  await commit((state) => {
    let next = reduceMeterState(state, usageEvent);
    next = reduceEfficiencyState(next, effEvent);
    return next;
  });
}

/**
 * When active_sessions.json changes (new project / session), rescore immediately
 * and refresh context usage — plan billing still rides its own interval.
 */
function startSessionWatch() {
  if (sessionsWatcher) {
    try {
      sessionsWatcher.close();
    } catch {
      // ignore
    }
    sessionsWatcher = null;
  }

  const activePath = getActiveSessionsPath();
  let debounce = null;
  let lastRoot = null;

  const onChange = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      const project = resolveOpenProject();
      const root = project?.root || null;
      // Always refresh efficiency when sessions file changes
      refreshEfficiency();
      // Context needle should follow the active session too
      if (root !== lastRoot) {
        lastRoot = root;
        refreshUsage();
      }
    }, 250);
  };

  try {
    sessionsWatcher = fs.watch(activePath, { persistent: true }, onChange);
  } catch {
    // File may not exist yet — poll will still pick up projects
    try {
      sessionsWatcher = fs.watch(
        path.dirname(activePath),
        { persistent: true },
        (eventType, filename) => {
          if (!filename || String(filename) === path.basename(activePath)) {
            onChange();
          }
        }
      );
    } catch {
      // ignore — EFF_POLL covers it
    }
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  if (effPollTimer) clearInterval(effPollTimer);
  refreshAll();
  // Account plan usage keeps counting on its interval no matter the project.
  pollTimer = setInterval(refreshUsage, POLL_MS);
  // Live project efficiency
  effPollTimer = setInterval(refreshEfficiency, EFF_POLL_MS);
  startSessionWatch();
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
  if (!gotSingletonLock) return;

  if (process.platform === "darwin" && app.dock) {
    try {
      app.dock.hide();
    } catch {
      // ignore
    }
  }

  // Kill orphan overlays left by older launches / detached restarts.
  claimMeterSingleton(ROOT, process.pid);
  createWindow();
  startPolling();
  startOverlayAssert();

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
  if (boostWatchTimer) clearInterval(boostWatchTimer);
  if (sessionsWatcher) {
    try {
      sessionsWatcher.close();
    } catch {
      // ignore
    }
  }
});

app.on("window-all-closed", () => {
  if (pollTimer) clearInterval(pollTimer);
  if (effPollTimer) clearInterval(effPollTimer);
  if (overlayTimer) clearInterval(overlayTimer);
  if (boostWatchTimer) clearInterval(boostWatchTimer);
  if (sessionsWatcher) {
    try {
      sessionsWatcher.close();
    } catch {
      // ignore
    }
  }
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("usage:refresh", async () => {
  await refreshAll();
});

/**
 * Carte-blanche boost: spawn Grok headless against the open project
 * with a prompt to raise all efficiency scores to ≥80%.
 */
ipcMain.handle("efficiency:boost", async () => {
  // Fresh reading so the prompt has current bars
  const event = await takeEfficiencyReading({ useCache: false });
  await commit((state) => reduceEfficiencyState(state, event));

  if (!event.ok || !event.reading?.projectRoot) {
    setBoostUi({
      status: "error",
      label: "No project",
      disabled: false,
    });
    return {
      ok: false,
      error: event.ok
        ? "No project root"
        : event.fault?.message || "No focused project",
    };
  }

  if (boostUi.status === "running" && boostUi.pid && isPidAlive(boostUi.pid)) {
    return {
      ok: false,
      error: `Boost already running (pid ${boostUi.pid})`,
      pid: boostUi.pid,
    };
  }

  setBoostUi({
    status: "running",
    label: "Building…",
    disabled: true,
  });

  const result = launchBoost(event.reading);
  if (!result.ok) {
    setBoostUi({
      status: "error",
      label: "Failed",
      disabled: false,
      title: result.error,
    });
    return result;
  }

  // Grok CLI can exit in milliseconds on bad flags — verify it stayed up.
  await new Promise((r) => setTimeout(r, 400));
  if (!isPidAlive(result.pid)) {
    let logSnippet = "";
    try {
      const fs = require("fs");
      if (result.logFile && fs.existsSync(result.logFile)) {
        logSnippet = fs.readFileSync(result.logFile, "utf8").trim().slice(0, 280);
      }
    } catch {
      // ignore
    }
    const errMsg = logSnippet || "Grok exited immediately — check boost log";
    setBoostUi({
      status: "error",
      label: "Failed",
      disabled: false,
      title: errMsg,
      pid: null,
      logFile: result.logFile,
    });
    return { ok: false, error: errMsg, logFile: result.logFile };
  }

  setBoostUi({
    status: "running",
    label: "Grok building",
    disabled: true,
    pid: result.pid,
    logFile: result.logFile,
    title: `Grok pid ${result.pid} · log ${result.logFile}`,
  });
  watchBoostPid(result.pid);

  return {
    ok: true,
    pid: result.pid,
    logFile: result.logFile,
    promptFile: result.promptFile,
    projectRoot: result.projectRoot,
  };
});

ipcMain.on("window:drag", (_event, { dx, dy }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
  assertOverlay(mainWindow);
});
