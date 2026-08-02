"use strict";

/**
 * Main-process BML coach: state persistence + github + inject orchestration.
 */

const {
  emptyBmlState,
  defaultStatePath,
  loadBmlState,
  saveBmlState,
  reduceBmlState,
} = require("./state");
const {
  SKILL_CHAIN,
  stepAt,
  nextStepIndex,
  canSkipStep,
  tinyImplementIndex,
  buildSkillPrompt,
  isMeasureAllowedCommand,
  buildMeasureInstrumentPrompt,
  resolveChainForView,
} = require("./skill-chain");
const { canAdvanceStage, nextStage, WIP_LIMIT } = require("./gates");
const { formatTicketBody, EMPTY_FIELDS, validateBacklogReady } = require("./template");
const { injectIntoGrok } = require("./inject");
const { createGithubClient } = require("./github");
const {
  loadActiveProjectContext,
  formatProjectContextForPrompt,
  synthesizeTicketFromProject,
} = require("./project-context");

/**
 * @param {{
 *   statePath?: string,
 *   appData?: string,
 *   github?: ReturnType<typeof createGithubClient>,
 *   inject?: typeof injectIntoGrok,
 * }} [opts]
 */
function createBmlCoach(opts = {}) {
  const statePath =
    opts.statePath ||
    defaultStatePath({
      appData: opts.appData,
      env: process.env,
    });
  let state = loadBmlState(statePath);
  const github = opts.github || createGithubClient();
  const inject = opts.inject || injectIntoGrok;

  function persist() {
    try {
      saveBmlState(statePath, state);
    } catch {
      // best effort
    }
  }

  function dispatch(action) {
    state = reduceBmlState(state, action);
    persist();
    return getView();
  }

  function gateContext() {
    return {
      stage: state.stage,
      fields: state.fields,
      hasExperimentLabel: true,
      wipActive: state.wipActive ?? 0,
      smallestTestShipped: state.build.smallestTestShipped,
      measurePathNamed: state.build.measurePathNamed,
      weeklyNumbersPosted: state.measure.weekNotes.length > 0,
      durationElapsed: state.measure.durationElapsed,
      killHit: state.measure.killHit,
      decisionLabel: state.learn.decisionLabel,
      evidenceWritten: state.learn.evidenceWritten,
    };
  }

  function activeProject() {
    return loadActiveProjectContext({
      preferCwd: process.env.GUM_BML_CWD || null,
    });
  }

  /**
   * The active chat project IS the experiment. Bind issue + synthesize
   * Build/Measure from that repo whenever the chat project changes.
   * Mutates `state` via reduce (no dispatch) to avoid getView recursion.
   */
  function ensureExperimentFromChatProject() {
    let project;
    try {
      project = activeProject();
    } catch {
      return null;
    }
    if (!project?.cwd) return project;

    const title = `BML: ${project.name || project.cwd}`;
    const cwdKey = project.cwd;
    const sameProject =
      state.activeIssue &&
      (state.activeIssue.title === title ||
        state.activeIssue.repo === cwdKey ||
        (state.fields?.technicalContext || "").includes(cwdKey));

    if (!sameProject || !state.activeIssue) {
      const fields = synthesizeTicketFromProject(project);
      state = reduceBmlState(state, {
        type: "experiment/set",
        issue: {
          number: 0,
          url: "",
          title,
          repo: cwdKey,
          itemId: null,
        },
        stage: state.stage === "Done" ? "Backlog" : state.stage,
        fields,
      });
      state = reduceBmlState(state, {
        type: "build/flags",
        measurePathNamed: true,
      });
      persist();
    } else if (!state.fields || !String(state.fields.hypothesis || "").trim()) {
      state = reduceBmlState(state, {
        type: "fields/set",
        fields: synthesizeTicketFromProject(project),
      });
      persist();
    }

    return project;
  }

  function getView() {
    const project = ensureExperimentFromChatProject();
    const step = stepAt(state.buildStepIndex);
    const nxt = nextStage(state.stage);
    const advanceCheck = nxt
      ? canAdvanceStage(state.stage, nxt, gateContext())
      : { ok: false, errors: ["Already Done."] };

    const chain = resolveChainForView();

    return {
      ...state,
      skillChain: chain.map((s, i) => ({
        ...s,
        // buildStepIndex points at current step while running; after a step
        // finishes the coach advances index so completed rows get done=true
        active:
          i === state.buildStepIndex &&
          state.buildStepIndex < SKILL_CHAIN.length,
        done: i < state.buildStepIndex,
      })),
      currentStep: step
        ? {
            ...step,
            ...(chain.find((c) => c.id === step.id) || {}),
          }
        : null,
      canSkipCurrent: canSkipStep(state.buildStepIndex),
      nextStage: nxt,
      canAdvance: advanceCheck.ok,
      advanceErrors: advanceCheck.ok ? [] : advanceCheck.errors,
      wipLimit: WIP_LIMIT,
      emptyFields: { ...EMPTY_FIELDS },
      jobBrief:
        state.fields?.hypothesis ||
        state.activeIssue?.title ||
        project?.name ||
        null,
      project: project
        ? {
            cwd: project.cwd,
            name: project.name,
            sessionId: project.sessionId,
            sessionLive: project.sessionLive,
            sessionSource: project.sessionSource,
            boundToChat: project.boundToChat,
            buildNatures: project.buildNatures,
            measureNatures: project.measureNatures,
            technicalHints: project.technicalHints,
            hasContextMd: Boolean(project.contextExcerpt),
            scripts: project.scripts,
          }
        : null,
    };
  }

  function projectPromptBlock() {
    try {
      return formatProjectContextForPrompt(activeProject());
    } catch {
      return "";
    }
  }

  return {
    getView,
    getState: () => state,

    setPanelOpen(open) {
      return dispatch({ type: open ? "panel/open" : "panel/close" });
    },

    togglePanel() {
      return dispatch({ type: "panel/toggle" });
    },

    setFields(fields) {
      return dispatch({ type: "fields/set", fields });
    },

    setBuildFlags(flags) {
      return dispatch({ type: "build/flags", ...flags });
    },

    setMeasureFlags(flags) {
      return dispatch({ type: "measure/flags", ...flags });
    },

    setTinyBuild() {
      return dispatch({ type: "build/tiny" });
    },

    setStep(index) {
      return dispatch({ type: "build/step", index });
    },

    nextSkillStep() {
      const idx = nextStepIndex(state.buildStepIndex, {
        tinyBuild: state.tinyBuild,
      });
      return dispatch({ type: "build/step", index: idx });
    },

    skipOptionalStep() {
      if (!canSkipStep(state.buildStepIndex)) {
        return dispatch({
          type: "error",
          message: "This step is required unless you enable Tiny build.",
        });
      }
      return this.nextSkillStep();
    },

    async refreshBoard() {
      try {
        const listed = await github.listProjectItems();
        if (!listed.ok) {
          return dispatch({
            type: "error",
            message: listed.error || "Could not list project items.",
          });
        }
        const wip = github.countWip(listed.items);
        dispatch({ type: "wip/set", wipActive: wip });
        dispatch({ type: "error", message: null });
        return getView();
      } catch (err) {
        return dispatch({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async createExperiment(fields) {
      try {
        const ready = validateBacklogReady(fields);
        if (!ready.ok) {
          return dispatch({
            type: "error",
            message: ready.errors.join(" "),
          });
        }
        const issue = await github.createExperiment(fields);
        dispatch({
          type: "experiment/set",
          issue: {
            number: issue.number,
            url: issue.url,
            title: issue.title,
            repo: issue.repo,
            itemId: issue.itemId,
          },
          stage: "Backlog",
          fields,
        });
        if (issue.projectError) {
          dispatch({
            type: "error",
            message: `Issue created, but project add failed: ${issue.projectError}`,
          });
        } else {
          dispatch({ type: "error", message: null });
        }
        return getView();
      } catch (err) {
        return dispatch({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async selectExperiment(issueRef) {
      try {
        const data = await github.fetchIssueFields(issueRef);
        dispatch({
          type: "experiment/set",
          issue: {
            number: data.number,
            url: data.url,
            title: data.title,
            repo: data.repo,
          },
          stage: state.stage,
          fields: data.fields,
        });
        dispatch({ type: "error", message: null });
        return getView();
      } catch (err) {
        return dispatch({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },

    /**
     * Advance the BML stage — primary way to put AI-generated Build/Measure
     * into practice (no separate GitHub create).
     *
     * Backlog → Build: validates ticket fields, commits them as the local
     * experiment, moves to Build, then auto-runs the Matt skill chain.
     *
     * @param {{
     *   fields?: import('./template').TicketFields|null,
     *   onProgress?: (view: object) => void,
     *   skipChain?: boolean,
     * }} [opts]
     */
    async advanceStage(opts = {}) {
      if (opts.fields) {
        dispatch({ type: "fields/set", fields: opts.fields });
      }

      const nxt = nextStage(state.stage);
      if (!nxt) {
        return dispatch({ type: "error", message: "Already Done." });
      }

      // Active chat project = experiment. Synthesize ticket if needed, then Build.
      if (state.stage === "Backlog" && nxt === "Build") {
        ensureExperimentFromChatProject();
        let fields = opts.fields || state.fields;
        if (!fields || !validateBacklogReady(fields).ok) {
          const project = activeProject();
          fields = synthesizeTicketFromProject(project);
          dispatch({ type: "fields/set", fields });
        }
        const ready = validateBacklogReady(fields || {});
        if (!ready.ok) {
          return dispatch({
            type: "error",
            message: ready.errors.join(" "),
          });
        }

        const project = activeProject();
        const title = `BML: ${project.name || project.cwd}`;
        dispatch({
          type: "experiment/set",
          issue: {
            number: 0,
            url: "",
            title,
            repo: project.cwd || "",
            itemId: null,
          },
          stage: "Backlog",
          fields,
        });

        const check = canAdvanceStage("Backlog", "Build", {
          ...gateContext(),
          fields,
          hasExperimentLabel: true,
        });
        if (!check.ok) {
          return dispatch({
            type: "error",
            message: check.errors.join(" "),
          });
        }

        dispatch({ type: "stage/set", stage: "Build" });
        dispatch({ type: "build/step", index: 0 });
        dispatch({
          type: "build/flags",
          measurePathNamed: true,
        });
        dispatch({ type: "error", message: null });

        if (!opts.skipChain) {
          return this.runAllSkillSteps({
            onProgress: opts.onProgress,
          });
        }
        return getView();
      }

      const check = canAdvanceStage(state.stage, nxt, gateContext());
      if (!check.ok) {
        return dispatch({
          type: "error",
          message: check.errors.join(" "),
        });
      }
      dispatch({ type: "stage/set", stage: nxt });
      dispatch({ type: "error", message: null });
      return getView();
    },

    /**
     * Run a single skill at `index` (defaults to current buildStepIndex).
     * @param {number} [index]
     */
    async runSkillStep(index) {
      const i =
        Number.isInteger(index) && index >= 0
          ? index
          : state.buildStepIndex;
      dispatch({ type: "build/step", index: i });

      const project = activeProject();
      const preferCwd = process.env.GUM_BML_CWD || project.cwd || process.cwd();
      const projectBlock = formatProjectContextForPrompt(project);
      const body = state.fields ? formatTicketBody(state.fields) : null;
      const jobBrief = [
        state.activeIssue?.title,
        state.fields?.hypothesis,
        state.fields?.build,
      ]
        .filter(Boolean)
        .join(" — ");

      const step = stepAt(i) || stepAt(0);
      const chainPos = `Chain step ${i + 1}/${SKILL_CHAIN.length}: ${step?.command || "?"}`;

      if (state.stage === "Measure") {
        const cmd = step?.command || "/implement";
        if (!isMeasureAllowedCommand(cmd) && !state.tinyBuild) {
          const built = buildMeasureInstrumentPrompt({
            issueUrl: state.activeIssue?.url,
            metricLine: state.fields?.measure,
            jobBrief,
          });
          const prompt = [
            built.prompt,
            "",
            projectBlock,
            "",
            "MEASURE: only collect pre-registered metrics for THIS project.",
            chainPos,
          ].join("\n");
          return this._inject(prompt, {
            skillPath: built.skillPath,
            skillOk: built.skillOk,
            preferCwd,
            chainPos,
          });
        }
      }

      const built = buildSkillPrompt(step, {
        issueUrl: state.activeIssue?.url,
        issueTitle: state.activeIssue?.title,
        bodyExcerpt: body,
        stage: state.stage,
        jobBrief,
        cwd: preferCwd,
        projectBlock,
        extra: [
          chainPos,
          "You are one step in an auto-run BML skill chain. Complete THIS skill fully before stopping.",
          "Do not skip ahead to later chain steps — the coach will invoke those next.",
        ].join("\n"),
      });
      if (!built.skillOk) {
        dispatch({
          type: "error",
          message:
            built.skillError ||
            "Matt skill SKILL.md not found — inject will still try slash command.",
        });
      }
      return this._inject(built.prompt, {
        skillPath: built.skillPath,
        skillOk: built.skillOk,
        preferCwd,
        chainPos,
      });
    },

    /**
     * Bind active chat project as experiment, then auto-run every Matt skill
     * in order (1…N). Publishes progress via onProgress after each step.
     * @param {{ onProgress?: (view: object) => void }} [opts]
     */
    async runAllSkillSteps(opts = {}) {
      const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;

      // Active chat project = experiment; synthesize Build/Measure from that repo
      ensureExperimentFromChatProject();
      const project = activeProject();
      const fields =
        state.fields && validateBacklogReady(state.fields).ok
          ? state.fields
          : synthesizeTicketFromProject(project);
      dispatch({ type: "fields/set", fields });
      dispatch({
        type: "experiment/set",
        issue: {
          number: 0,
          url: "",
          title: `BML: ${project.name || project.cwd}`,
          repo: project.cwd || "",
          itemId: null,
        },
        stage: "Build",
        fields,
      });
      dispatch({ type: "stage/set", stage: "Build" });
      dispatch({ type: "build/flags", measurePathNamed: true });
      // Always full chain (no tiny-build shortcut)
      state = reduceBmlState(state, {
        type: "build/step",
        index: 0,
      });
      // Clear tiny flag if set
      if (state.tinyBuild) {
        state = { ...state, tinyBuild: false };
        persist();
      }

      const start = 0;
      const last = SKILL_CHAIN.length - 1;

      // Clear prior strikethrough so progress starts fresh
      dispatch({ type: "build/step", index: 0 });
      dispatch({ type: "error", message: null });
      dispatch({
        type: "inject/result",
        ok: true,
        method: "chain",
        detail: `Auto-running all ${SKILL_CHAIN.length} Matt skills on ${project.name || project.cwd}…`,
      });
      if (onProgress) onProgress(getView());

      /** @type {{ index: number, command: string, ok: boolean }[]} */
      const results = [];

      for (let i = start; i <= last; i++) {
        // Active = current skill (not yet struck)
        dispatch({ type: "build/step", index: i });
        if (onProgress) onProgress(getView());

        try {
          await this.runSkillStep(i);
        } catch (err) {
          dispatch({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }

        const step = stepAt(i);
        results.push({
          index: i,
          command: step?.command || `step-${i}`,
          ok: Boolean(state.lastInject?.ok),
        });

        // Mark this skill completed → strikethrough (done: i < index)
        dispatch({ type: "build/step", index: i + 1 });
        if (onProgress) onProgress(getView());
      }

      // All 1–13 struck through briefly, then reset to normal text
      dispatch({ type: "build/step", index: SKILL_CHAIN.length });
      if (onProgress) onProgress(getView());

      const okCount = results.filter((r) => r.ok).length;
      const summary = results
        .map((r) => `${r.command}:${r.ok ? "ok" : "fail"}`)
        .join(" · ");
      dispatch({
        type: "inject/result",
        ok: okCount === results.length,
        method: "chain",
        detail: `Chain done ${okCount}/${results.length}. ${summary}`,
      });
      if (okCount < results.length) {
        dispatch({
          type: "error",
          message: `Some skills failed inject (${okCount}/${results.length}).`,
        });
      } else {
        dispatch({ type: "error", message: null });
      }

      // Auto-reset strikethrough to normal text after full run
      await new Promise((r) => setTimeout(r, 600));
      dispatch({ type: "build/step", index: 0 });
      if (onProgress) onProgress(getView());

      return getView();
    },

    /**
     * Prefill ticket fields from active project using synthesized Build/Measure
     * natures (CONTEXT.md + package + tree). Overwrites when `force`.
     * @param {{ force?: boolean }} [opts]
     */
    applyProjectToFields(opts = {}) {
      const project = activeProject();
      const force = Boolean(opts.force);
      const synthesized = synthesizeTicketFromProject(project);
      const prev = state.fields || { ...EMPTY_FIELDS };
      /** @type {import('./template').TicketFields} */
      const next = { ...prev };

      for (const key of Object.keys(synthesized)) {
        const k = /** @type {keyof typeof synthesized} */ (key);
        if (force || !String(next[k] || "").trim()) {
          next[k] = synthesized[k];
        }
      }

      dispatch({ type: "fields/set", fields: next });
      dispatch({ type: "error", message: null });
      // Reset chain to grill after fill so admin can run main flow
      if (force) {
        dispatch({ type: "build/step", index: 0 });
        dispatch({ type: "stage/set", stage: "Backlog" });
      }
      return getView();
    },

    /**
     * @param {string} prompt
     * @param {{ skillPath?: string|null, skillOk?: boolean, preferCwd?: string, chainPos?: string }} [meta]
     */
    async _inject(prompt, meta = {}) {
      try {
        const preferCwd =
          meta.preferCwd ||
          process.env.GUM_BML_CWD ||
          activeProject().cwd ||
          process.cwd();
        const result = await inject(prompt, { preferCwd });
        const skillNote = meta.skillPath
          ? ` skill=${meta.skillPath}`
          : meta.skillOk === false
            ? " skill=MISSING"
            : "";
        const projNote = ` project=${preferCwd}`;
        const chainNote = meta.chainPos ? ` ${meta.chainPos}` : "";
        dispatch({
          type: "inject/result",
          ok: result.ok,
          method: result.method,
          detail: `${result.detail || ""}${skillNote}${projNote}${chainNote}`.trim(),
        });
        return getView();
      } catch (err) {
        return dispatch({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async postMeasure(note) {
      if (!state.activeIssue) {
        return dispatch({
          type: "error",
          message: "Select or create an experiment issue first.",
        });
      }
      try {
        await github.postMeasureComment(state.activeIssue, note);
        dispatch({
          type: "measure/note",
          text: note.text,
          value: note.value,
        });
        dispatch({ type: "error", message: null });
        return getView();
      } catch (err) {
        return dispatch({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async recordLearn(decision, evidence) {
      if (!state.activeIssue) {
        return dispatch({
          type: "error",
          message: "Select or create an experiment issue first.",
        });
      }
      try {
        await github.recordLearnDecision(
          state.activeIssue,
          decision,
          evidence
        );
        dispatch({
          type: "learn/decision",
          decisionLabel: decision,
          evidenceWritten: Boolean(evidence && String(evidence).trim()),
        });
        dispatch({ type: "error", message: null });
        return getView();
      } catch (err) {
        return dispatch({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

module.exports = {
  createBmlCoach,
};
