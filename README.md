# Grok Usage Meter

Always-on-top combined overlay for **Terminal Grok 4.5**:

1. **Usage dial** — monthly plan + context (dual analog needles)  
2. **Project efficiency** — Architecture · Code efficiency · UI perfection for the open project

**Repo:** https://github.com/Koffeekinggamer/Grok-4.5-Usage-Meter

Forked shape of [Token Usage Meter](https://github.com/Koffeekinggamer/Token-Usage-Meter) (Cursor), rewired for Grok, then extended with project scoring in the same window.

| Zone | What it shows |
|------|----------------|
| Left dial | **Blue** = monthly plan · **Dark** = context window (or on-demand when capped) |
| Right panel | **Arch** · **Eff** · **UI** bars for the focused project |

- Reads the signed-in account from `~/.grok/auth.json` (no manual token paste)
- Polls `https://cli-chat-proxy.grok.com/v1/billing`
- Reads active session context from `~/.grok/sessions/**/signals.json`
- Scores the open project from live session `cwd` (or `GUM_PROJECT`)
- Frameless, always-on-top overlay you can drag; double-click to refresh both sides
- Optional Watcher auto-launches the Meter whenever Terminal Grok is open

## Requirements

- Node.js 18+
- Terminal Grok installed and signed in (`grok login`)
- macOS recommended for auto-launch (Linux autostart supported)

## Install

```bash
cd ~/Grok\ Usage\ Meter
export PATH="$HOME/.local/node/bin:$PATH"   # if needed
npm install
npm test
npm start
```

### Auto-launch when Terminal Grok opens

```bash
npm run install-autolaunch
```

This installs a background Watcher (`scripts/watch-grok.js`) that:

1. **Starts** the always-on-top Meter when Terminal Grok is open  
2. **Quits** the Meter when Grok exits (closing the session / terminal process)

Detection uses the live `grok` process and `~/.grok/active_sessions.json` (alive pids).

```bash
npm run uninstall-autolaunch
```

Manual watcher (same behavior, foreground):

```bash
npm run watch-grok
```

## How auth works

| Source | Path |
|---|---|
| Auth file | `~/.grok/auth.json` (override: `GROK_AUTH_JSON`) |
| Grok home | `~/.grok` (override: `GROK_HOME`) |
| Active sessions | `~/.grok/active_sessions.json` |
| Session signals | `~/.grok/sessions/**/<id>/signals.json` |

The Meter re-reads `auth.json` on every poll so it picks up silent token refresh from the CLI. Tokens are never written to disk by this app.

## Two independent tracks

| Track | Scope | Behavior |
|-------|--------|----------|
| **Usage dial** (left) | Account plan + active session context | Keeps counting across project switches and home sessions |
| **Efficiency panel** (right) | Open project only | Live: follows the newest focused Grok session `cwd` |

Usage never depends on which project is open. Efficiency never freezes plan %.

## Project efficiency (right panel)

Scores the **currently open building project** on three criteria (0–100 heuristics):

| Bar | Color | Criterion |
|-----|-------|-----------|
| Arch | Indigo | Architecture / code quality — modules, tests, docs, lint/types, CI |
| Eff  | Teal   | Code efficiency — file sizes, god files, deps, depth, lockfiles |
| UI   | Amber  | UI perfection — components, styles, a11y, responsive patterns |

### How the project is chosen (live)

| Priority | Source |
|----------|--------|
| 1 | Newest **live** Grok session with a focused project `cwd` |
| 2 | **Session edits** — when Grok’s cwd is home (common for Grok Build), infer from recent `hunk_records.jsonl` file paths |
| 3 | Recent session project cwd (pid just exited) |
| 4 | `GUM_PROJECT` / `PEM_PROJECT` env fallback |
| 5 | Fault: **No project** (usage dial still works) |

Force a fixed path: `GUM_PROJECT_LOCK=1 GUM_PROJECT=/path/to/app`.

The Meter watches `active_sessions.json` and re-scores when the open project changes.

## Controls

- Drag the overlay to reposition
- Double-click to force a refresh of **usage + efficiency**
- **↑ 80%** button (efficiency panel) — launches **Grok headless** with carte blanche to raise Architecture, Code efficiency, and UI perfection each to **≥ 80%** (`grok --prompt-file … --cwd <project> --yolo --always-approve`)
- Usage poll: `GUM_POLL_MS` (default `60000`) — plan/context, always on
- Efficiency poll: `GUM_EFF_POLL_MS` (default `15000`) — plus session file watch
- Position: `GUM_X` / `GUM_Y`
- Grok binary override: `GUM_GROK_BIN`

## Reliability

- **Usage reading** — `src/lib/reading.js`
- **Efficiency reading** — `src/lib/efficiency.js` + `src/lib/score.js` + `src/lib/project.js`
- **Meter state** — `src/lib/meter-state.js` (last-good for both sides)
- **Face DTO / copy** — `src/lib/face.js` + `src/lib/face-copy.js`
- **Paint** — `src/renderer/paint.js` (dial + bars)
- **Watcher** — `src/lib/watcher.js` + `scripts/watch-grok.js`

## Domain glossary

See [`CONTEXT.md`](./CONTEXT.md) for Meter / Reading / Fault vocabulary.
