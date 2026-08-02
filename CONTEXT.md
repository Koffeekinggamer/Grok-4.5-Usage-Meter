# Grok Usage Meter

An always-on-top overlay that shows Terminal Grok 4.5 plan usage and active-session context as a dual-needle analog dial.

## Language

**Meter**:
The always-on-top overlay window that displays plan and context usage as two analog needles.
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

**Reading**:
A single successful snapshot of plan usage (and context/on-demand) for the signed-in Grok account.
_Avoid_: Sample, poll result, metric

**Signed-in account**:
The Grok identity currently authenticated in the local Terminal Grok CLI, discovered only via `~/.grok/auth.json`.
_Avoid_: Manual API key paste, browser cookie, login form inside the Meter

**Last-good reading**:
The most recent successful reading still shown on the Meter when a later refresh fails.
_Avoid_: Cache, stale data (as a product feature name)

**Fault state**:
A visible indication that the Meter cannot produce a fresh reading (missing sign-in, API failure, missing auth file).
_Avoid_: Crash, error toast, dialog

**Watcher**:
The background process that starts the Meter when Terminal Grok opens and stops the Meter when Grok closes.
_Avoid_: Autostart service, daemon, LaunchAgent (implementation detail)
