# Grok Usage Meter

Always-on-top analog needle overlay for **Terminal Grok 4.5** plan + context usage.

**Repo:** https://github.com/Koffeekinggamer/Grok-4.5-Usage-Meter

Forked shape of [Token Usage Meter](https://github.com/Koffeekinggamer/Token-Usage-Meter) (Cursor), rewired for Grok.

- Reads the signed-in account from `~/.grok/auth.json` (no manual token paste)
- Polls `https://cli-chat-proxy.grok.com/v1/billing`
- Reads active session context from `~/.grok/sessions/**/signals.json`
- Dual needles: **blue = monthly plan**, **dark = context window** (or on-demand when capped)
- Frameless, always-on-top gauge you can drag; double-click to refresh
- **Single instance** — only one Meter overlay; a second launch focuses the first and exits (orphans are killed on start)
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
- **BML** button — open the Build-Measure-Learn coach (Build → Measure focus)
- Poll interval: `GUM_POLL_MS` (default `60000`)

## BML coach

Follows [Practical AI Build-Measure-Learn onboarding](https://practical-office.github.io/bml-onboarding/): six-section tickets (admin jobs or product bets), column gates, WIP limit 3, and the Matt skill chain.

**Skill chain (Run step → Grok embeds real `SKILL.md` from the downloaded Matt pack):**

| Phase | Commands |
|--------|----------|
| Route | `/ask-matt` |
| On-ramps (any admin job) | `/triage` · `/diagnosing-bugs` · `/research` · `/wayfinder` · `/improve-codebase-architecture` · `/prototype` · `/design` |
| Build (required) | `/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement` |
| Close | `/code-review` |

Skills resolve from (first hit wins):

1. `GUM_SKILLS_ROOT`
2. `./.grok/skills` / `./skills`
3. `~/.grok/skills`
4. `~/.grok/vendor/mattpocock-skills/skills/engineering` (**Matt pack**)
5. `~/.grok/bundled/skills` (e.g. `/design`)

- Optional on-ramps can be **Skip**’d; **Tiny build** jumps to `/implement`
- **Run step → Grok** injects slash command **plus full SKILL.md body** so Grok follows the installed skill, not a paraphrase
- **Active project** (Grok session `cwd`, override `GUM_BML_CWD`): every inject includes Build/Measure natures derived from that repo (`CONTEXT.md`, scripts, tree). **Fill Build/Measure from project** prefills the ticket from those facts.
- Inject cascade: resume active session → headless `grok -p` → clipboard fallback
- GitHub: create `experiment` issues, post Measure comments, Learn labels via `gh`

### GitHub setup

```bash
gh auth refresh -s project,read:project,repo
```

| Env | Default | Purpose |
|-----|---------|---------|
| `GUM_BML_OWNER` | `Book-IQ` | Project owner |
| `GUM_BML_PROJECT` | `1` | BML project number |
| `GUM_BML_REPO` | `Book-IQ/bookiqv1-rc` | Issues repo |
| `GUM_BML_CWD` | (process cwd) | Preferred Grok inject cwd |
| `GUM_BML_YOLO` | unset | Set `1` to pass `--always-approve` on inject |

## Reliability

- **Reading** — `src/lib/reading.js` (signed-in account → plan + context)
- **Meter state** — `src/lib/meter-state.js` (last-good reading + fault)
- **Face DTO / copy** — `src/lib/face.js` + `src/lib/face-copy.js`
- **Paint** — `src/renderer/paint.js`
- **Watcher** — `src/lib/watcher.js` + `scripts/watch-grok.js`
- **BML coach** — `src/lib/bml/*` (template, gates, skill chain, inject, github)

## Domain glossary

See [`CONTEXT.md`](./CONTEXT.md) for Meter / Reading / Fault vocabulary.
