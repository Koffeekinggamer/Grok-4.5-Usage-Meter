# Research: Reading→Face pipeline (BML grok-usage-meter)

**Date:** 2026-08-02  
**Question:** What does the smallest reliable Reading→Face path actually do today, and which seams prove acceptance for the experiment bet (operators keep the Meter visible and act on dual-needle Readings mid-session with **no blank dial**)?  
**Method:** Primary sources only (repo source + fixtures + scripts + tests). No secondary blogs.

## Summary

- **End-to-end path is wired and unit-proven:** `takeReading` (auth → billing → signals) → `reduceMeterState` → `buildFace` / `buildFaceView` → IPC `meter:face` → renderer `applyFace` + `MeterPaint.drawMeterFace`. Seams are pure functions with injectable adapters; fixtures cover billing/auth/signals shapes.
- **No snap-to-zero on poll failure when a prior Reading exists:** `reduceMeterState` keeps `reading`, sets `showingLastGood: true` and `fault`; Face keeps numeric needle labels and appends `· held` to plan copy; paint draws a red fault marker when `hasFault`.
- **No blank dial on cold start of the renderer:** `IDLE_FACE` seeds em-dash labels and zero-angle needles; paint always draws an opaque cream plate + tracks before any Reading arrives. SELFTEST / verify reject idle-only labels and unpainted canvas.
- **Single-instance + Watcher are implemented:** Electron `requestSingleInstanceLock` + `claimMeterSingleton` (`.meter.pid`); second instance quits / first focuses; `syncMeterWithGrok` start/stop state machine + `scripts/watch-grok.js` (optional LaunchAgent via `install-autolaunch`).
- **BML coach does not block the dial:** coach is created and IPC-registered separately; `refreshUsage` only calls `takeReading` → reduce → `publishFace`. Panel starts collapsed (`COLLAPSED` 200×200); BML is a chip + expandable panel.
- **Gaps vs full experiment AC:** `npm test` is **100/101** (one fail in BML live-view, outside Reading→Face core). Measure “≥80% sessions / fault rate” logging is **not** implemented as a session counter — only optional SELFTEST artifacts and weekly coach notes. Live cold-start &lt;5s is instrumented by SELFTEST wait (~2s) but not asserted as a session metric.

## Domain language (CONTEXT.md)

| Term | Definition (source) | Used in code as |
|------|---------------------|-----------------|
| **Meter** | Always-on-top overlay window with two analog needles | `BrowserWindow` overlay in `src/main.js`; shell/canvas in `src/renderer/` |
| **Plan usage** | `used` / `monthlyLimit` from CLI billing API; **blue needle** | `planPercentUsed` / blue `cursor` needle (`#2563eb`) |
| **Context usage** | `contextWindowUsage` from `signals.json`; **dark needle** | `contextPercentUsed` / dark `other` needle (`#1c1917`) |
| **On-demand usage** | Overage when `onDemandCap` &gt; 0; preferred for dark needle | `dualPercents` → `secondaryKind: "on-demand"`, legend `OD` |
| **Reading** | Single successful snapshot of plan (+ context/on-demand) | `Reading` typedef / `takeReading` ok branch |
| **Signed-in account** | Identity from `~/.grok/auth.json` only | `readGrokAccount` |
| **Last-good reading** | Prior successful Reading still shown after failed refresh | `showingLastGood` + held `reading` in `MeterState` |
| **Fault state** | Visible indication cannot produce a fresh Reading | `Fault.kind` + Face `hasFault` / cold `faultFace` |
| **Watcher** | Background process start Meter with Grok, stop when Grok closes | `syncMeterWithGrok` + `scripts/watch-grok.js` |
| **BML coach** | Build→Measure panel; optional for admin bets | `createBmlCoach`, `#bmlBtn` / `#bmlPanel` |

Source: [`CONTEXT.md`](../../CONTEXT.md) lines 7–56.

## Reading path (auth → billing → signals → Reading)

### Data sources, fields, URLs, env overrides

| Step | Source | Path / URL | Key fields | Env override |
|------|--------|------------|------------|--------------|
| Grok home | filesystem | `~/.grok` | — | `GROK_HOME` |
| Auth | `auth.json` | `~/.grok/auth.json` | entry `key` (access token), `email`, `expires_at`, `user_id` | `GROK_AUTH_JSON` |
| Billing API | HTTP GET | `https://cli-chat-proxy.grok.com/v1/billing` (`DEFAULT_BILLING_ENDPOINT`) | `config.used`, `monthlyLimit`, `onDemandCap`, `onDemandUsed`, `billingPeriodStart/End` (often `{ val: number }`) | `endpoint` opt on `fetchBilling` / `takeReading` |
| Active sessions | JSON | `~/.grok/active_sessions.json` | `session_id`, `pid` | `GROK_ACTIVE_SESSIONS` |
| Context signals | `signals.json` under sessions tree | `~/.grok/sessions/**/<id>/signals.json` | `contextWindowUsage`, `contextTokensUsed`, `contextWindowTokens`, `primaryModelId` | `GROK_SESSIONS_DIR` |

Sources: [`src/lib/paths.js`](../../src/lib/paths.js) (`getGrokHome`, `getAuthPath`, `getActiveSessionsPath`, `getSessionsDir`); [`src/lib/usage.js`](../../src/lib/usage.js) (`DEFAULT_BILLING_ENDPOINT`, `parseBilling`, `fetchBilling`); [`src/lib/auth.js`](../../src/lib/auth.js) (`readGrokAccount`, `pickAuthEntry`); [`src/lib/context.js`](../../src/lib/context.js) (`readActiveContext`, `parseSignals`).

Fixture shapes (canonical examples):

- [`fixtures/auth.json`](../../fixtures/auth.json): issuer key → `{ key, email, expires_at, ... }`
- [`fixtures/billing.json`](../../fixtures/billing.json): `{ config: { monthlyLimit: { val: 19000 }, used: { val: 1900 }, onDemandCap: { val: 0 }, ... } }` → `parseBilling` → **10%** plan
- [`fixtures/signals.json`](../../fixtures/signals.json): `contextWindowUsage: 42`, tokens 210000/500000, `primaryModelId: "grok-4.5"`

### `takeReading` API

```text
takeReading(opts?) → Promise<
  { ok: true, reading: Reading } |
  { ok: false, fault: Fault }
>
```

Sequence inside [`src/lib/reading.js`](../../src/lib/reading.js) `takeReading`:

1. `readAccount` → `readGrokAccount` (throws → classified fault)
2. `fetchBillingFn` with `account.accessToken` → plan metrics
3. `readContext` → `readActiveContext()` (null-safe; missing context is **not** a fault)
4. Assemble `Reading`: `percent` / `planPercentUsed` from billing; `contextPercentUsed` from context; on-demand fields from billing; `displayMessage` like `Plan N% of included Grok usage · Ctx M%`; `email` from account; default model `"grok-4.5"` if context model missing

Main process poll ([`src/main.js`](../../src/main.js) `refreshUsage`):

```text
event = await takeReading()
meterState = reduceMeterState(meterState, event)
publishFace()  // webContents.send("meter:face", buildFaceView(meterState))
```

Default poll: `GUM_POLL_MS` or **60_000** ms. Manual: IPC `usage:refresh` / double-click in renderer.

### Fault kinds produced

`classifyFault` in [`src/lib/reading.js`](../../src/lib/reading.js):

| `kind` | Message pattern (regex / check) |
|--------|----------------------------------|
| `missing-auth` | `/auth file not found/i` |
| `expired` | `/access token expired|token expired/i` |
| `unsigned-in` | `/No access token|run `?grok login/i` |
| `http` | `/billing failed/i` |
| `parse` | `/billing response is empty|auth\.json is not valid JSON|invalid/i` |
| `unknown` | fallback |

Face copy for cold fault ([`src/lib/face-copy.js`](../../src/lib/face-copy.js) `faultPlan`): e.g. `missing-auth` → `"No Grok auth"`, `unsigned-in` → `"Sign in"`, `http` → `"API error"`.

**Note:** Context/signals missing alone does **not** produce a fault; Reading still succeeds with `contextPercentUsed: null` (dark needle falls to 0 via `dualPercents` when no on-demand).

## Meter state: last-good + fault (no snap-to-zero)

### How success/failure updates state

[`src/lib/meter-state.js`](../../src/lib/meter-state.js) `reduceMeterState(previous, event)`:

| Event | Result |
|-------|--------|
| `ok: true` | `reading = event.reading`, `fault = null`, `showingLastGood = false` |
| `ok: false` **and** `prev.reading` | **keep** `prev.reading`, set `fault`, `showingLastGood = true` |
| `ok: false` **and** no prior reading | `reading = null`, `fault = event.fault`, `showingLastGood = false` |

`emptyMeterState()` → `{ reading: null, fault: null, showingLastGood: false }`.

There is **no** code path that zeros plan/context percents on fault when a last-good Reading is held.

### What Face shows

| State | Labels | Plan line | Paint |
|-------|--------|-----------|-------|
| Success | `Math.round` plan % and other % | model / membership (e.g. `grok-4.5`) | dual needles at target angles; `hasFault: false` |
| Fault + last-good | **same numeric labels as held Reading** | `planLine` → `"${model} · held"` | needles hold last targets; `hasFault: true` → red fault dot |
| Cold fault (no reading) | cursor/other `"!"`, angles `-120` | `faultPlan(fault)` | red-tinted arcs; fault marker |

Sources: [`src/lib/face.js`](../../src/lib/face.js) `buildFace`, `faultFace`, `faceFromReading`; [`src/lib/face-copy.js`](../../src/lib/face-copy.js) `planLine`, `faultPlan`.

### Tests that lock this behavior

- [`test/meter-state.test.js`](../../test/meter-state.test.js): `"keeps last-good reading on fault"`; `"shows fault with no reading when nothing is held"`; `"buildFaceView exposes Face DTO without snap-to-zero"`; cold fault `"!"` / `"No Grok auth"`.
- [`test/face.test.js`](../../test/face.test.js): `"keeps last-good Reading with held plan copy"` (`hasFault`, `showingLastGood`, plan `"grok-4.5 · held"`); cold `"Sign in"` + `"!"`.
- [`test/reading.test.js`](../../test/reading.test.js): `"returns a Fault instead of throwing"` (`missing-auth`).

## Face + dual needles (paint)

### `buildFaceView` / paint inputs

- `buildFaceView(state)` ≡ `buildFace(state)` ([`meter-state.js`](../../src/lib/meter-state.js)).
- `faceFromReading` → `dualPercents(reading)` then needle DTO with `targetAngle = percentToNeedleAngle(percent)`.
- Angle map ([`usage.js`](../../src/lib/usage.js) `percentToNeedleAngle`): **-120° at 0%** → **+120° at 100%**, overshoot toward +150° above 100% (capped input 125%).
- Renderer ([`renderer.js`](../../src/renderer/renderer.js)): rAF loop springs needles via `stepNeedle` toward `targetAngle`; calls `MeterPaint.drawMeterFace(ctx, frame, { width: 200, height: 200 })`.
- Frame fields ([`face.js`](../../src/lib/face.js) `faceFrame`): `cursorAngle`, `otherAngle`, colors, `hasFault`.
- Preload exposes `tokenMeter.onFaceUpdate`, `getFace`, `refresh`, `stepNeedle`, `faceFrame` ([`preload.js`](../../src/preload.js)).

### Blue vs dark needle mapping

[`src/lib/gauge.js`](../../src/lib/gauge.js) `dualPercents` + colors:

| Needle | Role | Color | Source percent |
|--------|------|-------|----------------|
| **cursor** (inner track, drawn on top) | Plan | `PLAN_NEEDLE_COLOR` / `CURSOR_NEEDLE_COLOR` = `#2563eb` | `planPercentUsed` else `percent` |
| **other** (outer track, under blue) | Context **or** on-demand | body `#1c1917`; arc via `colorForPercent` | If `onDemandCap > 0` and finite `onDemandPercentUsed` → **on-demand**; else if finite `contextPercentUsed` → **context**; else **0** |

Legend ([`face-copy.js`](../../src/lib/face-copy.js)): default `Plan` · `Ctx`; on-demand secondary → `Plan` · `OD`. Title hint: `"Blue Plan = monthly plan · Dark Ctx = context window · …"`.

Paint geometry ([`src/renderer/paint.js`](../../src/renderer/paint.js)): plate radius ~98 on 200×200; outer track R≈80 (context); inner R≈66 (plan); opaque cream plate first (critical for transparent Electron windows).

### Idle / blank / em-dash vs numeric labels

- HTML defaults ([`index.html`](../../src/renderer/index.html)): `#cursorPct` / `#otherPct` text `—`.
- Renderer `IDLE_FACE` ([`renderer.js`](../../src/renderer/renderer.js)): labels `"—"`, angles `-120`, comment **“never a transparent hole”**.
- On successful Face: labels become `String(Math.round(percent))` (or `"∞"` unlimited, or `"!"` cold fault).
- `applyFace`: cold fault (`hasFault && !showingLastGood`) hides legend; last-good still shows legend + numeric labels.

### Tests

- [`test/face.test.js`](../../test/face.test.js): dual labels `"10"` / `"42"`, angles, held + cold fault.
- [`test/paint.test.js`](../../test/paint.test.js): plate centered (100,100), tracks, fault marker fill `#c23b22`.
- [`test/usage.test.js`](../../test/usage.test.js): `dualPercents` plan/context; prefers on-demand when cap set; needle angles 0/50/100 → -120/0/120.

## Single-instance + Watcher

### Pidfile path and second-launch behavior

| Mechanism | Behavior | Source |
|-----------|----------|--------|
| Electron lock | `app.requestSingleInstanceLock()`; if false → `app.quit()` | [`main.js`](../../src/main.js) |
| Second instance | `second-instance` → `mainWindow.show()` + `assertOverlay` | [`main.js`](../../src/main.js) |
| Pidfile | `{projectRoot}/.meter.pid` via `defaultPidPath(root)` | [`pidfile.js`](../../src/lib/pidfile.js) |
| Claim | `claimMeterSingleton(ROOT, process.pid)` on ready: kill other Meter Electron pids, write pid | [`main.js`](../../src/main.js) + [`pidfile.js`](../../src/lib/pidfile.js) |
| Clear | `will-quit` → `clearPidFile` | [`main.js`](../../src/main.js) |

`findMeterPids` uses pidfile + `pgrep` for Electron processes whose cmdline includes the install root (excludes Helper/GPU/self).

### Watcher start/stop conditions

Pure state machine [`src/lib/watcher.js`](../../src/lib/watcher.js) `syncMeterWithGrok`:

| Grok | Meter | Action | Return |
|------|-------|--------|--------|
| up | down | `startMeter()` | `"started"` |
| down | up | `stopMeter()` | `"stopped"` |
| up | up | none | `"already-running"` |
| down | down | none | `"idle"` |

Script [`scripts/watch-grok.js`](../../scripts/watch-grok.js):

- Interval `GUM_WATCH_MS` default **3000** ms; start cooldown `GUM_START_COOLDOWN_MS` default **8000** ms.
- `isGrokRunning` → `isTerminalGrokOpen` ([`grok-presence.js`](../../src/lib/grok-presence.js)): live `grok` process **or** alive pid in `active_sessions.json`.
- `startMeter`: collapse orphans, skip if already running, `spawn(electron, ["."], { detached, env GUM_METER=1 })`.
- `stopMeter`: SIGTERM → brief wait → SIGKILL; clear pidfile.
- Auto-install: [`scripts/install-autolaunch.js`](../../scripts/install-autolaunch.js) → LaunchAgent `com.grok-usage-meter.grok-watch` / Linux `.desktop`.

### Tests

- [`test/watcher.test.js`](../../test/watcher.test.js): all four transitions.
- [`test/pidfile.test.js`](../../test/pidfile.test.js): round-trip, `claimMeterSingleton` writes pid, self excluded from `findMeterPids`.

## Verification & Measure instrumentation already present

### npm test

- Script: `"test": "node --test test/*.test.js"` ([`package.json`](../../package.json)).
- **21** test files under `test/`; run on 2026-08-02: **101 tests, 50 suites, 100 pass, 1 fail**.
- Fail: `renderBmlLive` → `"shows running cost with step progress"` ([`test/bml-live-view.test.js`](../../test/bml-live-view.test.js)) — **BML UI live view**, not Reading→Face core.
- Reading→Face-critical suites all present and green when isolated by purpose: `reading`, `meter-state`, `face`, `paint`, `usage`, `context`, `auth`, `pidfile`, `watcher`, `paths`, `grok-presence`.

### `GUM_SELFTEST` ([`main.js`](../../src/main.js) `runSelfTest`)

- Run: `GUM_SELFTEST=1 npm start`.
- Waits **2000** ms after ready; executes in-page diagnostics; writes:
  - `tmp/meter-selftest.png`
  - `tmp/meter-selftest.json` (`diag`, `face`, `shotPath`)
- Pass criteria (exit 0):
  - `window.tokenMeter` present
  - `MeterPaint.drawMeterFace` present
  - **not** both labels idle (`—` / `-` / `–`)
  - canvas sample `nonCream >= 3` (needles/tracks vs cream plate)
- Existing artifact ([`tmp/meter-selftest.json`](../../tmp/meter-selftest.json)): live face labels `"5"` / `"40"`, `nonCream: 128`, dual needles Plan/Ctx — proves path works against real auth on this machine at capture time.

### `scripts/verify-meter-ui.js`

- Standalone Electron script (not an npm script entry; run via electron as documented in file header).
- Seeds live `takeReading` or **synthetic** Reading (25% plan / 60% context) if live fails.
- Stubs all `bml:*` IPC to null so coach cannot hang the proof.
- Writes `tmp/meter-verify.png`.
- Fail on renderer Syntax/Type/Reference errors, missing paint, zero canvas, idle labels after re-push, `nonCream < 3`.

### What supports Measure pass/kill **without new product scope**

| Measure idea (from ticket template in code) | Already available |
|---------------------------------------------|-------------------|
| Non-idle dual-needle Face | SELFTEST + verify-meter-ui + face/paint unit tests |
| Fault without snap-to-zero | `reduceMeterState` + face tests |
| npm test stays green (~90+) | 100/101; one BML fail is the only red |
| Session-level ≥80% / fault rate &lt;10% | **Not automated** — would need operator notes / optional log line (ticket text in `project-context.js` mentions “optional log line in main refreshUsage”; **that log line is not present today**) |
| Watcher/Meter up with Grok | unit machine + watch-grok + autolaunch; no hermetic e2e of process table |

Experiment AC text embedded in [`src/lib/bml/project-context.js`](../../src/lib/bml/project-context.js) (`synthesizeMeterTicket` acceptance list) aligns with this research question.

## Gaps vs experiment Acceptance Criteria

| AC item | Status in code | Evidence path |
|---------|----------------|---------------|
| npm test green (full suite) | **Partial** — 100/101; fail is BML live-view cost string, not dial | `npm test`; `test/bml-live-view.test.js` |
| Cold start dual needles + numeric labels within 5s when signed in | **Proven path / partial timing** — renderer IDLE then push Face; SELFTEST waits 2s and has passed with numeric labels on this machine; no hard 5s assertion in CI | `renderer.js` IDLE_FACE; `main.js` refresh on `did-finish-load`; `tmp/meter-selftest.json` |
| Last-good Reading + fault marker; no snap-to-zero | **Proven** | `meter-state.js` `reduceMeterState`; `face.js` + tests; paint `hasFault` dot |
| Single instance; second launch focuses existing | **Proven** | `main.js` lock + `second-instance`; `pidfile.js` `claimMeterSingleton` |
| Watcher starts on Grok open / quits on close | **Proven logic**; runtime depends on LaunchAgent/process detection | `watcher.js` + `watch-grok.js` + `grok-presence.js` + tests |
| GUM_SELFTEST or verify-meter-ui captures painted dial + labels | **Proven present**; artifacts under `tmp/` | `main.js` `runSelfTest`; `scripts/verify-meter-ui.js` |
| CONTEXT.md domain terms stable | **Present** | `CONTEXT.md` |
| BML optional; does not block dial | **Proven** | `refreshUsage` independent of BML; panel collapsed by default; verify stubs BML |
| Measure session counts (≥80% / kill thresholds) | **Missing as instrumentation** | No poll/session metrics file; coach Measure notes are manual |

## Recommendations for next Build (smallest vertical slice)

Stay inside existing modules; no new packages. Tracer-bullet only:

1. **Keep Reading→Face green as the product surface:** do not expand BML for this bet. If full `npm test` must be green for AC, fix or quarantine the single `renderBmlLive` failure without touching dial code.
2. **Optional one-line Measure hook (if needed for weekly counts):** in `refreshUsage` after `reduceMeterState`, append a single JSONL line (e.g. under `tmp/` or userData) with `{ ts, ok, faultKind, showingLastGood, plan%, ctx% }` — already named as optional in ticket template; does not change Face.
3. **Cold-start confidence:** run `GUM_SELFTEST=1 npm start` (and/or `verify-meter-ui.js`) as the Build acceptance ritual; treat `tmp/meter-selftest.json` labels + `nonCream` as the visual proof seam.
4. **Do not change** dual-percent priority (on-demand over context), last-good reduce rules, or IDLE_FACE cream plate — those already encode “no blank dial” and “no snap-to-zero”.
5. **Watcher reliability is ops, not new feature:** document `npm run watch-grok` / `install-autolaunch` for Measure sample; unit tests already lock start/stop table.

## Sources index

- [`CONTEXT.md`](../../CONTEXT.md) — domain language (Meter, Reading, Plan/Context usage, Fault, Watcher, BML coach).
- [`package.json`](../../package.json) — scripts (`test`, `start`, `watch-grok`, autolaunch); electron dep only.
- [`README.md`](../../README.md) — product summary of path, auth table, controls, BML.
- [`src/lib/paths.js`](../../src/lib/paths.js) — `GROK_*` path resolution.
- [`src/lib/auth.js`](../../src/lib/auth.js) — `readGrokAccount` / `pickAuthEntry` from auth.json.
- [`src/lib/usage.js`](../../src/lib/usage.js) — billing endpoint, `parseBilling`, `fetchBilling`, `percentToNeedleAngle`.
- [`src/lib/context.js`](../../src/lib/context.js) — `parseSignals`, `readActiveContext` (active sessions → signals).
- [`src/lib/reading.js`](../../src/lib/reading.js) — `takeReading`, `classifyFault`, `Reading`/`Fault` types.
- [`src/lib/meter-state.js`](../../src/lib/meter-state.js) — `reduceMeterState`, last-good, `buildFaceView`.
- [`src/lib/gauge.js`](../../src/lib/gauge.js) — `dualPercents`, needle colors, `stepNeedle`.
- [`src/lib/face.js`](../../src/lib/face.js) — `buildFace`, `faceFromReading`, `faultFace`, `faceFrame`.
- [`src/lib/face-copy.js`](../../src/lib/face-copy.js) — legend, `faultPlan`, `planLine` held copy.
- [`src/lib/paint.js`](../../src/lib/paint.js) — re-exports renderer paint for Node tests.
- [`src/renderer/paint.js`](../../src/renderer/paint.js) — `drawMeterFace` canvas implementation.
- [`src/renderer/renderer.js`](../../src/renderer/renderer.js) — IDLE_FACE, animation loop, `applyFace`, BML UI hooks.
- [`src/renderer/index.html`](../../src/renderer/index.html) — dial shell, idle `—`, BML panel markup.
- [`src/preload.js`](../../src/preload.js) — `tokenMeter` bridge (face + optional bml).
- [`src/main.js`](../../src/main.js) — window, poll, singleton, SELFTEST, BML IPC, `refreshUsage`.
- [`src/lib/pidfile.js`](../../src/lib/pidfile.js) — `.meter.pid`, kill/claim singleton.
- [`src/lib/watcher.js`](../../src/lib/watcher.js) — `syncMeterWithGrok`.
- [`src/lib/grok-presence.js`](../../src/lib/grok-presence.js) — Terminal Grok process/session detection.
- [`scripts/watch-grok.js`](../../scripts/watch-grok.js) — Watcher process loop.
- [`scripts/install-autolaunch.js`](../../scripts/install-autolaunch.js) — LaunchAgent / desktop autostart.
- [`scripts/verify-meter-ui.js`](../../scripts/verify-meter-ui.js) — UI proof (labels + paint samples).
- [`fixtures/auth.json`](../../fixtures/auth.json), [`fixtures/billing.json`](../../fixtures/billing.json), [`fixtures/signals.json`](../../fixtures/signals.json) — fixture contracts.
- [`test/reading.test.js`](../../test/reading.test.js), [`test/meter-state.test.js`](../../test/meter-state.test.js), [`test/face.test.js`](../../test/face.test.js), [`test/paint.test.js`](../../test/paint.test.js), [`test/usage.test.js`](../../test/usage.test.js), [`test/context.test.js`](../../test/context.test.js), [`test/auth.test.js`](../../test/auth.test.js), [`test/pidfile.test.js`](../../test/pidfile.test.js), [`test/watcher.test.js`](../../test/watcher.test.js) — acceptance locks.
- [`src/lib/bml/coach.js`](../../src/lib/bml/coach.js), [`src/lib/bml/index.js`](../../src/lib/bml/index.js) — coach orchestration (optional; not on Reading path).
- [`src/lib/bml/project-context.js`](../../src/lib/bml/project-context.js) — embedded experiment AC / Measure wording for this Meter bet.
- [`tmp/meter-selftest.json`](../../tmp/meter-selftest.json) — prior live SELFTEST capture (numeric dual labels + paint samples).
