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
  stepAt,
  nextStepIndex,
  canSkipStep,
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
  suggestTechnicalContext,
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

  function getView() {
    const step = stepAt(state.buildStepIndex);
    const nxt = nextStage(state.stage);
    const advanceCheck = nxt
      ? canAdvanceStage(state.stage, nxt, gateContext())
      : { ok: false, errors: ["Already Done."] };

    const chain = resolveChainForView();
    let project = null;
    try {
      project = loadActiveProjectContext({
        preferCwd: process.env.GUM_BML_CWD || null,
      });
    } catch {
      project = null;
    }

    return {
      ...state,
      skillChain: chain.map((s, i) => ({
        ...s,
        active: i === state.buildStepIndex,
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
        null,
      project: project
        ? {
            cwd: project.cwd,
            name: project.name,
            sessionId: project.sessionId,
            buildNatures: project.buildNatures,
            measureNatures: project.measureNatures,
            technicalHints: project.technicalHints,
            hasContextMd: Boolean(project.contextExcerpt),
            scripts: project.scripts,
          }
        : null,
    };
  }

  function activeProject() {
    return loadActiveProjectContext({
      preferCwd: process.env.GUM_BML_CWD || null,
    });
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

    async advanceStage() {
      const nxt = nextStage(state.stage);
      if (!nxt) {
        return dispatch({ type: "error", message: "Already Done." });
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

    async runSkillStep() {
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

      if (state.stage === "Measure") {
        const step = stepAt(state.buildStepIndex);
        const cmd = step?.command || "/implement";
        if (!isMeasureAllowedCommand(cmd) && !state.tinyBuild) {
          const built = buildMeasureInstrumentPrompt({
            issueUrl: state.activeIssue?.url,
            metricLine: state.fields?.measure,
            jobBrief,
          });
          // Prepend project measure natures even on instrument path
          const prompt = [
            built.prompt,
            "",
            projectBlock,
            "",
            "MEASURE: only collect pre-registered metrics for THIS project.",
          ].join("\n");
          return this._inject(prompt, {
            skillPath: built.skillPath,
            skillOk: built.skillOk,
            preferCwd,
          });
        }
      }

      const step = stepAt(state.buildStepIndex) || stepAt(0);
      const built = buildSkillPrompt(step, {
        issueUrl: state.activeIssue?.url,
        issueTitle: state.activeIssue?.title,
        bodyExcerpt: body,
        stage: state.stage,
        jobBrief,
        cwd: preferCwd,
        projectBlock,
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
      });
    },

    /**
     * Prefill ticket fields from active project (Build/Measure natures + @hints).
     * Does not overwrite non-empty user fields unless `force`.
     * @param {{ force?: boolean }} [opts]
     */
    applyProjectToFields(opts = {}) {
      const project = activeProject();
      const force = Boolean(opts.force);
      const prev = state.fields || { ...EMPTY_FIELDS };
      const next = { ...prev };

      if (force || !String(next.build || "").trim()) {
        next.build = [
          `In ${project.name || project.cwd}:`,
          ...project.buildNatures.slice(0, 4).map((n) => `- ${n}`),
        ].join("\n");
      }
      if (force || !String(next.measure || "").trim()) {
        next.measure = [
          ...project.measureNatures.slice(0, 3).map((n) => `- ${n}`),
          "Pass: [set numeric] · kill: [set numeric] · duration: [e.g. 2 weeks]",
        ].join("\n");
      }
      if (force || !String(next.technicalContext || "").trim()) {
        next.technicalContext = suggestTechnicalContext(project);
      }
      if (force || !String(next.hypothesis || "").trim()) {
        next.hypothesis = project.description
          ? `For ${project.name}: ${project.description} — the riskiest assumption we must validate is…`
          : `For project ${project.name || project.cwd}, the riskiest assumption is…`;
      }

      return dispatch({ type: "fields/set", fields: next });
    },

    /**
     * @param {string} prompt
     * @param {{ skillPath?: string|null, skillOk?: boolean, preferCwd?: string }} [meta]
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
        dispatch({
          type: "inject/result",
          ok: result.ok,
          method: result.method,
          detail: `${result.detail || ""}${skillNote}${projNote}`.trim(),
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
