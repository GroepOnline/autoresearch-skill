import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import {
  decideValue,
  decideWithSamples,
  evaluateGuardrails,
  formatDecisionText,
  POLICY_VERSION,
  type DecisionHistory,
  type DecisionResult,
  type GuardrailInput,
} from "./decision.js";
import { delta, direction, fmt, metricName, metricUnit, paths, readState } from "./state.js";
import { dashboardRows } from "./ui.js";

function parseMetricLines(
  text: string
): Array<{ name: string; value: number; attrs: Record<string, string> }> {
  const results: Array<{ name: string; value: number; attrs: Record<string, string> }> = [];
  const re =
    /^METRIC\s+([A-Za-z_][A-Za-z0-9_.:-]*)=([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:\s+(.*))?$/;
  for (const line of text.split("\n")) {
    const match = re.exec(line.trim());
    if (!match) continue;
    const attrs: Record<string, string> = {};
    if (match[3]) {
      for (const item of match[3].trim().split(/\s+/)) {
        const idx = item.indexOf("=");
        if (idx > 0) attrs[item.slice(0, idx)] = item.slice(idx + 1);
      }
    }
    results.push({ name: match[1], value: parseFloat(match[2]), attrs });
  }
  return results;
}

function median(values: number[]): number {
  if (values.length === 0) throw new Error("median requires at least one value");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1));
}

function cv(values: number[]): number {
  if (values.length < 2) return 0;
  const m = Math.abs(values.reduce((a, b) => a + b, 0) / values.length);
  return m === 0 ? 0 : (stdev(values) / m) * 100;
}

function decisionDetails(result: DecisionResult): Record<string, unknown> {
  const details: Record<string, unknown> = {
    action: result.action,
    reason: result.reason,
    improvement_pct: result.improvementPct,
    outcome: result.outcome,
    policy_version: result.policyVersion,
  };
  if (result.evidence) details.evidence = result.evidence;
  if (result.guardrails) details.guardrails = result.guardrails;
  return details;
}

// Zod schemas for tool input validation
const MetricInputSchema = z.object({
  output: z.string().min(1, "output must be a non-empty string"),
  primary_metric: z.string().optional(),
});

const DashboardInputSchema = z.object({
  write_file: z.boolean().optional(),
});

export interface MetricDecisionInput {
  candidate: number;
  best?: number | null;
  direction: "lower" | "higher";
  min_effect_size_pct?: number;
  noise_floor_pct?: number;
  tests_passed?: boolean;
  noisy?: boolean;
}

export interface MetricDecisionResult {
  action: "baseline" | "keep" | "discard" | "stop";
  reason: string;
  improvement_pct?: number;
}

/** Gates that reject a metric before any threshold arithmetic. */
function metricEarlyRejection(
  best: number | null | undefined,
  hasPassedTests: boolean,
  isNoisy: boolean
): MetricDecisionResult | null {
  if (!hasPassedTests) return { action: "discard", reason: "correctness checks failed" };
  if (isNoisy) return { action: "stop", reason: "benchmark noise too high" };
  if (best === undefined || best === null)
    return { action: "baseline", reason: "first measurement becomes baseline", improvement_pct: 0 };
  return null;
}

function metricImprovementPct(direction: "lower" | "higher", candidate: number, best: number): number {
  return direction === "lower"
    ? ((best - candidate) / Math.abs(best)) * 100
    : ((candidate - best) / Math.abs(best)) * 100;
}

function zeroBestMetricDecision(
  direction: "lower" | "higher",
  candidate: number,
  best: number
): MetricDecisionResult {
  const improved = direction === "lower" ? candidate < best : candidate > best;
  return improved
    ? { action: "keep", reason: "zero best value requires strict absolute improvement" }
    : { action: "discard", reason: "zero best value requires strict absolute improvement" };
}

export function decideMetric(input: MetricDecisionInput): MetricDecisionResult {
  const {
    candidate,
    best,
    direction,
    min_effect_size_pct = 3.0,
    noise_floor_pct = 0.0,
    tests_passed: hasPassedTests = true,
    noisy: isNoisy = false,
  } = input;

  if (!Number.isFinite(candidate)) throw new Error("candidate must be a finite number");
  if (!["lower", "higher"].includes(direction))
    throw new Error("direction must be lower or higher");

  const rejected = metricEarlyRejection(best, hasPassedTests, isNoisy);
  if (rejected) return rejected;
  if (typeof best !== "number" || !Number.isFinite(best))
    throw new Error("best must be a finite number when provided");

  const threshold = Math.max(min_effect_size_pct, noise_floor_pct);
  if (best === 0) return zeroBestMetricDecision(direction, candidate, best);

  const improvementPct = metricImprovementPct(direction, candidate, best);

  if (improvementPct >= threshold) {
    return {
      action: "keep",
      reason: `improved ${improvementPct.toFixed(2)}% over current best (threshold ${threshold.toFixed(2)}%)`,
      improvement_pct: improvementPct,
    };
  }

  return {
    action: "discard",
    reason: `improvement ${improvementPct.toFixed(2)}% is below threshold ${threshold.toFixed(2)}% or worse than best`,
    improvement_pct: improvementPct,
  };
}

function captureCommit(cwd: string): string | null {
  try {
    const result = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.status === 0 ? result.stdout.trim() || null : null;
  } catch {
    return null;
  }
}

/** Human-readable summary lines for the autoresearch_state tool. */
function stateSummaryLines(state: ReturnType<typeof readState>): string[] {
  const config = state.config;
  if (!config) return ["No active autoresearch session. Use /autoresearch new <goal> to start."];

  const lines = [
    `Session: ${config.name}`,
    `Metric: ${metricName(config)} (${direction(config)})`,
    `Runs: ${state.runCount} | ✅ ${state.keptCount} | ❌ ${state.discardedCount} | 💥 ${state.crashedCount}`,
  ];
  if (state.baselineMetric !== null)
    lines.push(`Baseline: ${fmt(state.baselineMetric, metricUnit(config))}`);
  if (state.bestMetric !== null && state.bestRun !== null) {
    lines.push(
      `Best: ${fmt(state.bestMetric, metricUnit(config))} run #${state.bestRun} ${delta(state.bestMetric, state.baselineMetric ?? 0)}`
    );
  }
  const last = state.results.at(-1);
  if (last) lines.push(`Last: run #${last.run} → ${last.status} — ${last.description}`);
  if (state.isPaused) lines.push("Status: PAUSED");
  if (config.max_runs !== undefined) lines.push(`Budget: max ${config.max_runs} runs`);
  if (config.max_minutes !== undefined) lines.push(`Budget: max ${config.max_minutes} min`);
  return lines;
}

export function registerAutoresearchTools(pi: ExtensionAPI): void {
  // ─── autoresearch_state ──────────────────────────────────────────────────────
  pi.registerTool({
    name: "autoresearch_state",
    label: "Autoresearch State",
    description:
      "Read and validate .autoresearch/autoresearch.jsonl. Returns config, run counts, baseline, current best, and parse errors.",
    promptSnippet: "Read and validate the autoresearch JSONL state",
    promptGuidelines: [
      "Use autoresearch_state to inspect the current experiment before starting or resuming a run.",
      "Use autoresearch_state after any hypothesis to verify the JSONL is still valid.",
    ],
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const state = readState(ctx.cwd);

      if (state.parseErrors.length > 0) {
        throw new Error(
          `.autoresearch/autoresearch.jsonl parse errors:\n${state.parseErrors.join("\n")}`
        );
      }

      const lines: string[] = stateSummaryLines(state);

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          config: state.config,
          runCount: state.runCount,
          keptCount: state.keptCount,
          discardedCount: state.discardedCount,
          crashedCount: state.crashedCount,
          bestMetric: state.bestMetric,
          bestRun: state.bestRun,
          baselineMetric: state.baselineMetric,
          isPaused: state.isPaused,
        },
      };
    },
  });

  // ─── autoresearch_metric ─────────────────────────────────────────────────────
  pi.registerTool({
    name: "autoresearch_metric",
    label: "Autoresearch Metric",
    description:
      "Parse METRIC lines from benchmark output and compute median summary. Input: raw benchmark stdout text.",
    promptSnippet: "Parse METRIC lines from benchmark output and compute medians",
    promptGuidelines: [
      "Use autoresearch_metric to parse benchmark output after running ./.autoresearch/autoresearch.sh.",
      "Pass the full stdout; autoresearch_metric extracts METRIC name=value lines and computes the median.",
    ],
    parameters: {
      type: "object",
      properties: {
        output: { type: "string", description: "Raw benchmark stdout to parse for METRIC lines." },
        primary_metric: {
          type: "string",
          description: "Name of primary metric to summarize. Defaults to first found.",
        },
      },
      required: ["output"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const validated = MetricInputSchema.parse(params);
      const metrics = parseMetricLines(validated.output);
      if (metrics.length === 0) {
        throw new Error(
          "No METRIC lines found in output. Benchmark must print at least one: METRIC name=value direction=lower|higher"
        );
      }

      const primaryName = validated.primary_metric ?? metrics[0].name;
      const primaryValues = metrics.filter((m) => m.name === primaryName).map((m) => m.value);
      if (primaryValues.length === 0)
        throw new Error(`Primary metric '${primaryName}' not found in output.`);

      const primaryMedian = median(primaryValues);
      const primaryDirection =
        metrics.find((m) => m.name === primaryName)?.attrs?.direction ?? "lower";
      const primaryCV = cv(primaryValues);
      const commit = captureCommit(ctx.cwd);

      const allNames = [...new Set(metrics.map((m) => m.name))];
      const summaryLines: string[] = [
        `Primary: ${primaryName}=${primaryMedian} (direction=${primaryDirection}, samples=${primaryValues.length})`,
      ];

      // ── Noise-adaptive sampling ──────────────────────────────────────────
      const state = readState(ctx.cwd);
      const noiseThreshold = state.config?.noise_floor_pct ?? 5; // CV > threshold% triggers noise warning
      if (primaryValues.length >= 3 && primaryCV > noiseThreshold) {
        summaryLines.push(
          `⚠️ High noise: CV ${primaryCV.toFixed(1)}% (threshold ${noiseThreshold}%). Consider running more samples.`
        );
      }

      for (const name of allNames.filter((n) => n !== primaryName)) {
        const vals = metrics.filter((m) => m.name === name).map((m) => m.value);
        summaryLines.push(`  ${name}=${median(vals)} (samples=${vals.length})`);
      }

      if (commit) summaryLines.push(`Commit: ${commit.slice(0, 7)}`);

      // ── Build secondary metrics map ───────────────────────────────────────
      const secondaryMetrics: Record<string, number> = {};
      for (const name of allNames.filter((n) => n !== primaryName)) {
        secondaryMetrics[name] = median(metrics.filter((m) => m.name === name).map((m) => m.value));
      }

      return {
        content: [{ type: "text", text: summaryLines.join("\n") }],
        details: {
          primaryMetric: primaryName,
          primaryMedian,
          primaryDirection,
          primarySamples: primaryValues,
          primaryCV,
          noisy: primaryCV > noiseThreshold,
          noiseThreshold,
          allMetrics: Object.fromEntries(
            allNames.map((n) => [n, metrics.filter((m) => m.name === n).map((m) => m.value)])
          ),
          secondaryMetrics: Object.keys(secondaryMetrics).length > 0 ? secondaryMetrics : undefined,
          commit,
        },
      };
    },
  });

  // ─── autoresearch_decide ─────────────────────────────────────────────────────
  pi.registerTool({
    name: "autoresearch_decide",
    label: "Autoresearch Decide",
    description: "Decide baseline/keep/discard/stop for a candidate metric. Pass repeated samples for a permutation significance test, guardrails, and stop-policy aware decisions. Returns action, outcome, and the evidence used.",
    promptSnippet: "Decide keep/discard/stop for a candidate metric against current best",
    promptGuidelines: [
      "Use autoresearch_decide after measuring a candidate to get a keep/discard/stop decision.",
      "Pass samples (and best_samples) whenever the benchmark produced repeated measurements; the decision then requires a statistically significant improvement above the minimum effect size.",
      "Always call autoresearch_decide before writing a decision event to autoresearch.jsonl and store its evidence fields in the event.",
    ],
    parameters: {
      type: "object",
      properties: {
        candidate: { type: "number", description: "Single candidate value (legacy threshold-only path). Omit when samples are provided." },
        best: { type: "number", description: "Current best metric value. Omit for baseline runs." },
        samples: { type: "array", items: { type: "number" }, description: "Repeated candidate samples from the benchmark (recommended: 7 measured samples)." },
        best_samples: { type: "array", items: { type: "number" }, description: "Repeated samples of the current best run for the significance test." },
        direction: { type: "string", enum: ["lower", "higher"], description: "lower or higher is better." },
        min_effect_size_pct: { type: "number", description: "Minimum improvement % to keep. Default: 3." },
        noise_floor_pct: { type: "number", description: "Noise floor (CV %). When exceeded the decision stops instead of scoring. Default: 0." },
        alpha: { type: "number", description: "Significance level for the permutation test. Default: 0.05." },
        min_samples: { type: "integer", description: "Minimum samples per side required to score. Default: 3." },
        require_significance: { type: "boolean", description: "Require a statistically significant improvement before keeping. Default: true." },
        tests_passed: { type: "boolean", description: "Whether correctness checks passed. Default: true." },
        noisy: { type: "boolean", description: "Explicit signal that the benchmark was too noisy for a reliable result. Default: false." },
        guardrails: {
          type: "array",
          description: "Secondary metrics that must not regress beyond their tolerance. Any failure discards the candidate.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              direction: { type: "string", enum: ["lower", "higher"] },
              tolerance_pct: { type: "number" },
              candidate: { type: "number" },
              best: { type: "number" },
            },
            required: ["name", "candidate", "best"],
            additionalProperties: false,
          },
        },
        history: {
          type: "object",
          description: "Loop history for stop-policy checks (consecutive discards, plateau, remaining budgets).",
          properties: {
            consecutive_discards: { type: "integer" },
            runs_since_improvement: { type: "integer" },
            max_consecutive_discards: { type: "integer" },
            max_runs_without_improvement: { type: "integer" },
            remaining_runs: { type: "number" },
            remaining_minutes: { type: "number" },
          },
          additionalProperties: false,
        },
        simplification: {
          type: "object",
          description: "Justification for keeping a statistically tied result that removes complexity without changing behavior.",
          properties: {
            removes_complexity: { type: "boolean" },
            behavior_unchanged: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
      required: ["direction"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      // Input validation
      if (!params || typeof params !== "object") {
        throw new Error("autoresearch_decide: params must be an object");
      }
      if (params.direction !== "lower" && params.direction !== "higher") {
        throw new Error("autoresearch_decide: direction must be 'lower' or 'higher'");
      }
      const hasSamples = Array.isArray(params.samples) && params.samples.length > 0;
      if (!hasSamples && (typeof params.candidate !== "number" || !Number.isFinite(params.candidate))) {
        throw new Error("autoresearch_decide: candidate must be a finite number when samples are not provided");
      }
      if (params.candidate !== undefined && params.candidate !== null && (typeof params.candidate !== "number" || !Number.isFinite(params.candidate))) {
        throw new Error("autoresearch_decide: candidate must be a finite number if provided");
      }
      if (params.best !== undefined && params.best !== null && (typeof params.best !== "number" || !Number.isFinite(params.best))) {
        throw new Error("autoresearch_decide: best must be a finite number if provided");
      }
      if (params.samples !== undefined) {
        if (!Array.isArray(params.samples) || params.samples.length === 0 || params.samples.some((value: unknown) => typeof value !== "number" || !Number.isFinite(value))) {
          throw new Error("autoresearch_decide: samples must be a non-empty array of finite numbers");
        }
      }
      if (params.best_samples !== undefined) {
        if (!Array.isArray(params.best_samples) || params.best_samples.length === 0 || params.best_samples.some((value: unknown) => typeof value !== "number" || !Number.isFinite(value))) {
          throw new Error("autoresearch_decide: best_samples must be a non-empty array of finite numbers");
        }
      }
      if (params.min_effect_size_pct !== undefined && (typeof params.min_effect_size_pct !== "number" || !Number.isFinite(params.min_effect_size_pct) || params.min_effect_size_pct < 0 || params.min_effect_size_pct > 100)) {
        throw new Error("autoresearch_decide: min_effect_size_pct must be in [0, 100] if provided");
      }
      if (params.noise_floor_pct !== undefined && (typeof params.noise_floor_pct !== "number" || !Number.isFinite(params.noise_floor_pct) || params.noise_floor_pct < 0 || params.noise_floor_pct > 100)) {
        throw new Error("autoresearch_decide: noise_floor_pct must be in [0, 100] if provided");
      }
      if (params.alpha !== undefined && (typeof params.alpha !== "number" || !Number.isFinite(params.alpha) || params.alpha <= 0 || params.alpha > 1)) {
        throw new Error("autoresearch_decide: alpha must be in (0, 1] if provided");
      }
      if (params.min_samples !== undefined && (!Number.isInteger(params.min_samples) || params.min_samples < 2)) {
        throw new Error("autoresearch_decide: min_samples must be an integer >= 2 if provided");
      }
      if (params.require_significance !== undefined && typeof params.require_significance !== "boolean") {
        throw new Error("autoresearch_decide: require_significance must be a boolean if provided");
      }
      if (params.guardrails !== undefined && !Array.isArray(params.guardrails)) {
        throw new Error("autoresearch_decide: guardrails must be an array if provided");
      }
      if (params.history !== undefined && (typeof params.history !== "object" || params.history === null)) {
        throw new Error("autoresearch_decide: history must be an object if provided");
      }
      if (params.simplification !== undefined && (typeof params.simplification !== "object" || params.simplification === null)) {
        throw new Error("autoresearch_decide: simplification must be an object if provided");
      }

      const guardrails: GuardrailInput[] = (params.guardrails ?? []).map((raw: Record<string, unknown>) => {
        if (!raw || typeof raw !== "object") throw new Error("autoresearch_decide: each guardrail must be an object");
        if (typeof raw.name !== "string" || raw.name.trim() === "") throw new Error("autoresearch_decide: guardrail.name is required");
        if (raw.direction !== undefined && raw.direction !== "lower" && raw.direction !== "higher") {
          throw new Error("autoresearch_decide: guardrail.direction must be 'lower' or 'higher'");
        }
        if (typeof raw.candidate !== "number" || !Number.isFinite(raw.candidate)) throw new Error("autoresearch_decide: guardrail.candidate must be a finite number");
        if (typeof raw.best !== "number" || !Number.isFinite(raw.best)) throw new Error("autoresearch_decide: guardrail.best must be a finite number");
        if (raw.tolerance_pct !== undefined && (typeof raw.tolerance_pct !== "number" || !Number.isFinite(raw.tolerance_pct))) {
          throw new Error("autoresearch_decide: guardrail.tolerance_pct must be a finite number");
        }
        return {
          name: raw.name,
          direction: raw.direction === "higher" ? "higher" : "lower",
          tolerance_pct: typeof raw.tolerance_pct === "number" ? raw.tolerance_pct : 2.0,
          candidate: raw.candidate,
          best: raw.best,
        };
      });

      if (!hasSamples) {
        // Guardrails are evaluated *after* the primary decision so a stop or
        // invalid signal (noisy benchmark, failing tests) keeps its own outcome
        // instead of being masked by `guardrail_failed`. This matches the
        // sample path and `scripts/autoresearch.py::decide`.
        const result = decideValue({
          candidate: params.candidate,
          best: params.best,
          direction: params.direction,
          minEffectSizePct: params.min_effect_size_pct,
          noiseFloorPct: params.noise_floor_pct,
          hasPassedTests: params.tests_passed ?? true,
          isNoisy: params.noisy ?? false,
        });
        const { results: guardrailResults, failures: guardrailFailures } = evaluateGuardrails(guardrails);
        if (guardrailResults.length > 0) result.guardrails = guardrailResults;
        if (guardrailFailures.length > 0 && result.action !== "stop" && result.outcome !== "invalid") {
          const guarded: DecisionResult = {
            action: "discard",
            reason: `guardrail regression: ${guardrailFailures.join("; ")}`,
            improvementPct: null,
            policyVersion: POLICY_VERSION,
            outcome: "guardrail_failed",
            guardrails: guardrailResults,
          };
          return { content: [{ type: "text", text: formatDecisionText(guarded) }], details: decisionDetails(guarded) };
        }
        return { content: [{ type: "text", text: formatDecisionText(result) }], details: decisionDetails(result) };
      }

      if (params.noisy === true) {
        const result: DecisionResult = {
          action: "stop",
          reason: "benchmark noise too high",
          improvementPct: null,
          policyVersion: POLICY_VERSION,
          outcome: "noisy",
        };
        return { content: [{ type: "text", text: formatDecisionText(result) }], details: decisionDetails(result) };
      }

      const hasBestSamples = Array.isArray(params.best_samples) && params.best_samples.length > 0;
      if (!hasBestSamples && params.best !== undefined && params.best !== null) {
        // A scalar `best` wrapped in a one-element array can never satisfy
        // min_samples and would silently discard every candidate. Require the
        // caller to pass real repeated best samples, or use the scalar
        // candidate/best path for a threshold-only decision.
        throw new Error(
          "autoresearch_decide: best_samples must be provided when samples are given; a scalar best cannot back a significance test"
        );
      }

      const result = decideWithSamples({
        candidateSamples: params.samples,
        bestSamples: hasBestSamples ? params.best_samples : null,
        direction: params.direction,
        policy: {
          min_effect_size_pct: params.min_effect_size_pct,
          noise_floor_pct: params.noise_floor_pct,
          alpha: params.alpha,
          min_samples: params.min_samples,
          require_significance: params.require_significance,
        },
        hasPassedTests: params.tests_passed ?? true,
        guardrails,
        history: params.history as DecisionHistory | undefined,
        simplification: params.simplification,
      });
      return { content: [{ type: "text", text: formatDecisionText(result) }], details: decisionDetails(result) };
    },
  });

  // ─── autoresearch_dashboard ──────────────────────────────────────────────────
  pi.registerTool({
    name: "autoresearch_dashboard",
    label: "Autoresearch Dashboard",
    description:
      "Generate a markdown dashboard summary from .autoresearch/autoresearch.jsonl. Includes config, run history, and best result.",
    promptSnippet: "Generate a markdown dashboard from autoresearch JSONL state",
    promptGuidelines: [
      "Use autoresearch_dashboard to summarize the experiment progress and best results.",
      "Use it when reporting the end of a loop, after a session, or when asked for a summary.",
    ],
    parameters: {
      type: "object",
      properties: {
        write_file: {
          type: "boolean",
          description:
            "If true, write dashboard to .autoresearch/autoresearch-dashboard.md. Default: false.",
        },
      },
      additionalProperties: false,
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const validated = DashboardInputSchema.parse(params);
      const state = readState(ctx.cwd);

      if (state.parseErrors.length > 0) {
        throw new Error(`Cannot render dashboard — JSONL errors:\n${state.parseErrors.join("\n")}`);
      }
      if (!state.config) throw new Error("No active autoresearch session.");

      const rows = dashboardRows(state);
      const markdown = rows.join("\n");

      if (validated.write_file) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(paths(ctx.cwd).dashboard, markdown + "\n", "utf-8");
      }

      return {
        content: [{ type: "text", text: markdown }],
        details: {
          runCount: state.runCount,
          bestMetric: state.bestMetric,
          bestRun: state.bestRun,
          baselineMetric: state.baselineMetric,
          wrote: validated.write_file ?? false,
        },
      };
    },
  });
}
