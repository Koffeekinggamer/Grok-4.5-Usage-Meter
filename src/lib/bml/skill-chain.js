"use strict";

/**
 * Build-column skill chain for the BML coach.
 *
 * Main Matt flow (idea → ship) plus admin on-ramps so any job can enter:
 * triage / bugs / research / architecture / design / prototype, then
 * grill → to-spec → to-tickets → implement (tdd + code-review inside).
 *
 * Inject prompts load the real installed SKILL.md from the Matt pack
 * (~/.grok/vendor/mattpocock-skills) or bundled Grok skills.
 */

const { loadSkillForCommand } = require("./skills-resolve");

/**
 * @typedef {{
 *   id: string,
 *   command: string,
 *   label: string,
 *   role: string,
 *   required: boolean,
 *   optional: boolean,
 *   phase: 'route'|'on-ramp'|'build'|'close',
 *   skill: string,
 * }} SkillStep
 */

/** @type {readonly SkillStep[]} */
const SKILL_CHAIN = Object.freeze([
  // —— Router ——
  {
    id: "ask-matt",
    command: "/ask-matt",
    skill: "ask-matt",
    label: "Ask Matt",
    role: "Router — which skill/flow fits this admin job or bet",
    required: false,
    optional: true,
    phase: "route",
  },
  // —— On-ramps (any job) ——
  {
    id: "triage",
    command: "/triage",
    skill: "triage",
    label: "Triage",
    role: "Incoming requests / bugs → agent-ready issues",
    required: false,
    optional: true,
    phase: "on-ramp",
  },
  {
    id: "diagnosing-bugs",
    command: "/diagnosing-bugs",
    skill: "diagnosing-bugs",
    label: "Diagnose",
    role: "Hard bugs: tight feedback loop before fix",
    required: false,
    optional: true,
    phase: "on-ramp",
  },
  {
    id: "research",
    command: "/research",
    skill: "research",
    label: "Research",
    role: "Primary-source investigation → cited notes in repo",
    required: false,
    optional: true,
    phase: "on-ramp",
  },
  {
    id: "wayfinder",
    command: "/wayfinder",
    skill: "wayfinder",
    label: "Wayfinder",
    role: "Huge foggy multi-session work → decision map",
    required: false,
    optional: true,
    phase: "on-ramp",
  },
  {
    id: "architecture",
    command: "/improve-codebase-architecture",
    skill: "improve-codebase-architecture",
    label: "Architecture",
    role: "Deepening survey when structure is the risk",
    required: false,
    optional: true,
    phase: "on-ramp",
  },
  {
    id: "prototype",
    command: "/prototype",
    skill: "prototype",
    label: "Prototype",
    role: "Throwaway answer to one design question",
    required: false,
    optional: true,
    phase: "on-ramp",
  },
  {
    id: "design",
    command: "/design",
    skill: "design",
    label: "Design",
    role: "Design-doc write→review loop until consensus",
    required: false,
    optional: true,
    phase: "on-ramp",
  },
  // —— Main Build flow (required unless tiny) ——
  {
    id: "grill",
    command: "/grill-with-docs",
    skill: "grill-with-docs",
    label: "Grill",
    role: "Relentless interview + CONTEXT.md / ADRs",
    required: true,
    optional: false,
    phase: "build",
  },
  {
    id: "to-spec",
    command: "/to-spec",
    skill: "to-spec",
    label: "Spec",
    role: "Synthesize conversation → PRD/spec on tracker",
    required: true,
    optional: false,
    phase: "build",
  },
  {
    id: "to-tickets",
    command: "/to-tickets",
    skill: "to-tickets",
    label: "Tickets",
    role: "Tracer-bullet vertical slices with blockers",
    required: true,
    optional: false,
    phase: "build",
  },
  {
    id: "implement",
    command: "/implement",
    skill: "implement",
    label: "Implement",
    role: "Build with /tdd at seams; /code-review; commit",
    required: true,
    optional: false,
    phase: "build",
  },
  // —— Close ——
  {
    id: "code-review",
    command: "/code-review",
    skill: "code-review",
    label: "Review",
    role: "Standards + Spec review of the diff",
    required: false,
    optional: true,
    phase: "close",
  },
]);

const IMPLEMENT_INDEX = SKILL_CHAIN.findIndex((s) => s.id === "implement");

/**
 * @param {number} index
 * @returns {SkillStep|null}
 */
function stepAt(index) {
  if (!Number.isInteger(index) || index < 0 || index >= SKILL_CHAIN.length) {
    return null;
  }
  return SKILL_CHAIN[index];
}

/**
 * @param {number} index
 * @param {{ tinyBuild?: boolean }} [opts]
 * @returns {number}
 */
function nextStepIndex(index, opts = {}) {
  if (opts.tinyBuild) return IMPLEMENT_INDEX;
  const n = Number(index);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(SKILL_CHAIN.length - 1, Math.floor(n) + 1);
}

function tinyImplementIndex() {
  return IMPLEMENT_INDEX;
}

/**
 * @param {number} index
 * @returns {boolean}
 */
function canSkipStep(index) {
  const step = stepAt(index);
  if (!step) return false;
  return step.optional === true;
}

/**
 * Admin / any-job framing for inject prompts.
 * @param {{
 *   jobBrief?: string|null,
 *   issueUrl?: string|null,
 *   issueTitle?: string|null,
 *   bodyExcerpt?: string|null,
 *   stage?: string|null,
 *   extra?: string|null,
 *   cwd?: string|null,
 *   projectBlock?: string|null,
 * }} ctx
 * @returns {string[]}
 */
function contextLines(ctx) {
  /** @type {string[]} */
  const lines = [];
  if (ctx.jobBrief) {
    lines.push("## Admin job / bet", String(ctx.jobBrief).trim(), "");
  }
  if (ctx.issueUrl) lines.push(`Issue: ${ctx.issueUrl}`);
  if (ctx.issueTitle) lines.push(`Title: ${ctx.issueTitle}`);
  if (ctx.stage) lines.push(`BML Stage: ${ctx.stage}`);
  if (ctx.cwd) lines.push(`Working directory: ${ctx.cwd}`);
  if (ctx.projectBlock) {
    lines.push("", String(ctx.projectBlock).trim(), "");
  }
  if (ctx.bodyExcerpt) {
    lines.push("", "--- Ticket / job body ---", String(ctx.bodyExcerpt).slice(0, 4000));
  }
  if (ctx.extra) {
    lines.push("", String(ctx.extra));
  }
  return lines;
}

/**
 * Build inject prompt that embeds the real installed Matt/Grok SKILL.md.
 * @param {SkillStep|string} stepOrCommand
 * @param {{
 *   jobBrief?: string|null,
 *   issueUrl?: string|null,
 *   issueTitle?: string|null,
 *   bodyExcerpt?: string|null,
 *   stage?: string|null,
 *   extra?: string|null,
 *   cwd?: string|null,
 *   projectBlock?: string|null,
 *   loadSkill?: typeof loadSkillForCommand,
 * }} [ctx]
 * @returns {{ prompt: string, skillPath: string|null, skillOk: boolean, skillError?: string }}
 */
function buildSkillPrompt(stepOrCommand, ctx = {}) {
  const step =
    typeof stepOrCommand === "string"
      ? {
          command: stepOrCommand,
          skill: stepOrCommand.replace(/^\//, ""),
          label: stepOrCommand,
          role: "",
        }
      : stepOrCommand || { command: "/implement", skill: "implement" };

  const command = step.command || "/implement";
  const load = ctx.loadSkill || loadSkillForCommand;
  const skillKey = step.skill || command;
  const loaded = load(skillKey);

  const header = [
    command,
    "",
    "You are executing a **Build-Measure-Learn** step from the Grok Usage Meter BML coach.",
    "This instance is for **admin / ops credibility work**: any job that must get done through disciplined Build → Measure → Learn.",
    "Follow the installed Matt/Grok skill definition below **exactly** — do not invent a lighter substitute.",
    "Stay inside the smallest Build that tests the hypothesis; no scope creep.",
    "**Build and Measure natures MUST come from the Active project block** (repo tree, CONTEXT.md, scripts) — not generic templates.",
    "If this skill is user-invoked only, treat this message as an explicit user invocation of " +
      command +
      ".",
    "",
  ];

  /** @type {string[]} */
  const skillBlock = [];
  if (loaded.ok) {
    skillBlock.push(
      `## Installed skill: ${loaded.name || skillKey}`,
      loaded.description ? `Description: ${loaded.description}` : null,
      loaded.path ? `Source: ${loaded.path}` : null,
      "",
      "### SKILL.md body",
      loaded.body,
      ""
    );
  } else {
    skillBlock.push(
      `## Skill load warning`,
      loaded.error || "Skill file missing.",
      `Still run ${command} using your built-in skill registry if available.`,
      ""
    );
  }

  const prompt = [
    ...header,
    ...skillBlock.filter((l) => l != null),
    ...contextLines(ctx),
  ].join("\n");

  return {
    prompt,
    skillPath: loaded.path,
    skillOk: loaded.ok,
    skillError: loaded.error,
  };
}

/**
 * @param {string} command
 * @returns {boolean}
 */
function isMeasureAllowedCommand(command) {
  const c = String(command || "").trim();
  return (
    c === "/implement" ||
    c.startsWith("/implement ") ||
    c === "/research" ||
    c.startsWith("/research ") ||
    c === "/code-review" ||
    c.startsWith("/code-review ")
  );
}

/**
 * @param {{ issueUrl?: string|null, metricLine?: string|null, jobBrief?: string|null }} [ctx]
 */
function buildMeasureInstrumentPrompt(ctx = {}) {
  return buildSkillPrompt("/implement", {
    issueUrl: ctx.issueUrl,
    jobBrief: ctx.jobBrief,
    stage: "Measure",
    extra: [
      "MEASURE PHASE: do not add product scope.",
      "Only fix broken instrumentation or the manual log path so we can collect pre-registered metrics.",
      "Prefer the /implement skill body for the patch; keep the change the smallest path to measurable data.",
      ctx.metricLine ? `Metrics focus: ${ctx.metricLine}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

/**
 * Enrich chain for UI: attach resolved skill path if present.
 * @param {{ loadSkill?: typeof loadSkillForCommand }} [opts]
 */
function resolveChainForView(opts = {}) {
  const load = opts.loadSkill || loadSkillForCommand;
  return SKILL_CHAIN.map((s) => {
    const loaded = load(s.skill || s.id);
    return {
      ...s,
      skillPath: loaded.path,
      skillOk: loaded.ok,
      skillName: loaded.name,
    };
  });
}

module.exports = {
  SKILL_CHAIN,
  stepAt,
  nextStepIndex,
  tinyImplementIndex,
  canSkipStep,
  buildSkillPrompt,
  isMeasureAllowedCommand,
  buildMeasureInstrumentPrompt,
  resolveChainForView,
  contextLines,
};
