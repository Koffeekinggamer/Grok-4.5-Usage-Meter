# Grok Usage Meter

Always-on-top analog needle overlay for **Terminal Grok 4.5** plan + context usage.

**Repo:** https://github.com/Koffeekinggamer/Grok-4.5-Usage-Meter

Forked shape of [Token Usage Meter](https://github.com/Koffeekinggamer/Token-Usage-Meter) (Cursor), rewired for Grok.

- Reads the signed-in account from `~/.grok/auth.json` (no manual token paste)
- Polls `https://cli-chat-proxy.grok.com/v1/billing`
- Reads active session context from `~/.grok/sessions/**/signals.json`
- Dual needles: **blue = monthly plan**, **dark = context window** (or on-demand when capped)
- Frameless, always-on-top gauge you can drag; double-click to refresh
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

## Controls

- Drag the dial to reposition
- Double-click to force a refresh
- Poll interval: `GUM_POLL_MS` (default `60000`)

## Reliability

- **Reading** — `src/lib/reading.js` (signed-in account → plan + context)
- **Meter state** — `src/lib/meter-state.js` (last-good reading + fault)
- **Face DTO / copy** — `src/lib/face.js` + `src/lib/face-copy.js`
- **Paint** — `src/renderer/paint.js`
- **Watcher** — `src/lib/watcher.js` + `scripts/watch-grok.js`

## Domain glossary

See [`CONTEXT.md`](./CONTEXT.md) for Meter / Reading / Fault vocabulary.
