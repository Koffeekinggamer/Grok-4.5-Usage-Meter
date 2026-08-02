# Grok Usage Meter

An always-on-top overlay that shows Terminal Grok 4.5 plan usage, active-session context, and efficiency scores for the open building project.

## Language

**Meter**:
The always-on-top overlay window that displays plan/context usage as two analog needles and project efficiency as three score bars.
_Avoid_: Widget, HUD, dashboard, gauge app

**Plan usage**:
The share of the signed-in account's included Grok monthly allowance already consumed in the current billing cycle (`used` / `monthlyLimit` from the CLI billing API), shown on the blue needle.
_Avoid_: API key spend, token count alone, TPM rate limit

**Context usage**:
The share of the active Terminal Grok session's context window already filled (`contextWindowUsage` from `signals.json`), shown on the dark needle.
_Avoid_: Total plan usage, historical average

**On-demand usage**:
Optional overage beyond the included monthly allowance when `onDemandCap` is enabled; preferred for the dark needle when cap > 0.
_Avoid_: Plan pool

**Open project**:
The filesystem root of the project Terminal Grok is currently working in — usually the live session `cwd` from `~/.grok/active_sessions.json`, or `GUM_PROJECT`.
_Avoid_: Bare home directory, random folder without focus

**Architecture score**:
How well the open project is structured for maintainability: modules, tests, docs, lint/types, separation of concerns (indigo bar).
_Avoid_: Subjective beauty, runtime performance

**Code efficiency score**:
How lean and navigable the codebase is: file sizes, god-file pressure, dependency bulk, depth, lockfiles (teal bar).
_Avoid_: Micro-benchmarks, CPU profiling

**UI perfection score**:
How polished the user-facing surface is: components, styles, accessibility, responsive patterns (amber bar). Backend-only projects score lower with a “no UI” note.
_Avoid_: Pixel-perfect design critique without source signals

**Reading**:
A single successful snapshot of plan usage (and context/on-demand) for the signed-in Grok account.
_Avoid_: Sample, poll result, metric

**Efficiency reading**:
A single successful snapshot of the three project scores for the open project.
_Avoid_: Lint report, CI summary

**Signed-in account**:
The Grok identity currently authenticated in the local Terminal Grok CLI, discovered only via `~/.grok/auth.json`.
_Avoid_: Manual API key paste, browser cookie, login form inside the Meter

**Last-good reading**:
The most recent successful **usage** reading still shown when a later plan/context refresh fails. For efficiency, last-good is held only for transient scan faults on the same open project — switching projects or leaving all projects clears the previous project's bars.
_Avoid_: Cache, stale data (as a product feature name)

**Live project tracking**:
Efficiency always re-resolves the open project from Terminal Grok sessions so scores follow whichever project is currently open; plan usage keeps counting regardless.
_Avoid_: Locked env project path as the default

**Fault state**:
A visible indication that the Meter cannot produce a fresh reading (missing sign-in, API failure, no project, missing auth file).
_Avoid_: Crash, error toast, dialog

**Watcher**:
The background process that starts the Meter when Terminal Grok opens and stops the Meter when Grok closes.
_Avoid_: Autostart service, daemon, LaunchAgent (implementation detail)
