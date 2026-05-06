import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { delta, direction, fmt, metricName, metricUnit, paths, readState } from "./state.js";
import { dashboardRows } from "./ui.js";

function parseMetricLines(text: string): Array<{ name: string; value: number; attrs: Record<string, string> }> {
  const results: Array<{ name: string; value: number; attrs: Record<string, string> }> = [];
  const re = /^METRIC\s+([A-Za-z_][A-Za-z0-9_.:-]*)=([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:\s+(.*))?$/;
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

export function registerAutoresearchTools(pi: ExtensionAPI): void {
  // ─── autoresearch_state ──────────────────────────────────────────────────────
  pi.registerTool({
    name: "autoresearch_state",
    label: "Autoresearch State",
    description: "Read and validate autoresearch.jsonl. Returns config, run counts, baseline, current best, and parse errors.",
    promptSnippet: "Read and validate the autoresearch JSONL state",
    promptGuidelines: [
      "Use autoresearch_state to inspect the current experiment before starting or resuming a run.",
      "Use autoresearch_state after any hypothesis to verify the JSONL is still valid.",
    ],
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const state = readState(ctx.cwd);

      if (state.parseErrors.length > 0) {
        throw new Error(`autoresearch.jsonl parse errors:\n${state.parseErrors.join("\n")}`);
      }

      const config = state.config;
      const lines: string[] = [];

      if (!config) {
        lines.push("No active autoresearch session. Use /autoresearch new <goal> to start.");
      } else {
        lines.push(`Session: ${config.name}`);
        lines.push(`Metric: ${metricName(config)} (${direction(config)})`);
        lines.push(`Runs: ${state.runCount} | ✅ ${state.keptCount} | ❌ ${state.discardedCount} | 💥 ${state.crashedCount}`);
        if (state.baselineMetric !== null) lines.push(`Baseline: ${fmt(state.baselineMetric, metricUnit(config))}`);
        if (state.bestMetric !== null && state.bestRun !== null) {
          lines.push(`Best: ${fmt(state.bestMetric, metricUnit(config))} run #${state.bestRun} ${delta(state.bestMetric, state.baselineMetric ?? 0)}`);
        }
        const last = state.results.at(-1);
        if (last) lines.push(`Last: run #${last.run} → ${last.status} — ${last.description}`);
        if (state.isPaused) lines.push("Status: PAUSED");
        if (config.max_runs !== undefined) lines.push(`Budget: max ${config.max_runs} runs`);
        if (config.max_minutes !== undefined) lines.push(`Budget: max ${config.max_minutes} min`);
      }

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
    description: "Parse METRIC lines from benchmark output and compute median summary. Input: raw benchmark stdout text.",
    promptSnippet: "Parse METRIC lines from benchmark output and compute medians",
    promptGuidelines: [
      "Use autoresearch_metric to parse benchmark output after running ./autoresearch.sh.",
      "Pass the full stdout; autoresearch_metric extracts METRIC name=value lines and computes the median.",
    ],
    parameters: {
      type: "object",
      properties: {
        output: { type: "string", description: "Raw benchmark stdout to parse for METRIC lines." },
        primary_metric: { type: "string", description: "Name of primary metric to summarize. Defaults to first found." },
      },
      required: ["output"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const metrics = parseMetricLines(params.output);
      if (metrics.length === 0) {
        throw new Error("No METRIC lines found in output. Benchmark must print at least one: METRIC name=value direction=lower|higher");
      }

      const primaryName = params.primary_metric ?? metrics[0].name;
      const primaryValues = metrics.filter(m => m.name === primaryName).map(m => m.value);
      if (primaryValues.length === 0) throw new Error(`Primary metric '${primaryName}' not found in output.`);

      const primaryMedian = median(primaryValues);
      const primaryDirection = metrics.find(m => m.name === primaryName)?.attrs?.direction ?? "lower";

      const allNames = [...new Set(metrics.map(m => m.name))];
      const summaryLines: string[] = [
        `Primary: ${primaryName}=${primaryMedian} (direction=${primaryDirection}, samples=${primaryValues.length})`,
      ];
      for (const name of allNames.filter(n => n !== primaryName)) {
        const vals = metrics.filter(m => m.name === name).map(m => m.value);
        summaryLines.push(`  ${name}=${median(vals)} (samples=${vals.length})`);
      }

      return {
        content: [{ type: "text", text: summaryLines.join("\n") }],
        details: {
          primaryMetric: primaryName,
          primaryMedian,
          primaryDirection,
          primarySamples: primaryValues,
          allMetrics: Object.fromEntries(allNames.map(n => [n, metrics.filter(m => m.name === n).map(m => m.value)])),
        },
      };
    },
  });

  // ─── autoresearch_decide ─────────────────────────────────────────────────────
  pi.registerTool({
    name: "autoresearch_decide",
    label: "Autoresearch Decide",
    description: "Decide baseline/keep/discard/stop for a candidate metric value against the current best. Returns action and reason.",
    promptSnippet: "Decide keep/discard/stop for a candidate metric against current best",
    promptGuidelines: [
      "Use autoresearch_decide after measuring a candidate to get a keep/discard/stop decision.",
      "Always call autoresearch_decide before writing a decision event to autoresearch.jsonl.",
    ],
    parameters: {
      type: "object",
      properties: {
        candidate: { type: "number", description: "The candidate metric value (median from current run)." },
        best: { type: "number", description: "Current best metric value. Omit for baseline runs." },
        direction: { type: "string", enum: ["lower", "higher"], description: "lower or higher is better." },
        min_effect_size_pct: { type: "number", description: "Minimum improvement % to keep. Default: 3." },
        noise_floor_pct: { type: "number", description: "Noise floor %. Default: 0." },
        tests_passed: { type: "boolean", description: "Whether correctness checks passed. Default: true." },
        noisy: { type: "boolean", description: "Whether benchmark was too noisy for a reliable result. Default: false." },
      },
      required: ["candidate", "direction"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { candidate, best, direction, min_effect_size_pct = 3.0, noise_floor_pct = 0.0, tests_passed = true, noisy = false } = params;

      if (!Number.isFinite(candidate)) throw new Error("candidate must be a finite number");
      if (!["lower", "higher"].includes(direction)) throw new Error("direction must be lower or higher");

      if (!tests_passed) {
        return { content: [{ type: "text", text: "DISCARD — correctness checks failed" }], details: { action: "discard", reason: "correctness checks failed" } };
      }
      if (noisy) {
        return { content: [{ type: "text", text: "STOP — benchmark too noisy for a reliable decision" }], details: { action: "stop", reason: "benchmark noise too high" } };
      }
      if (best === undefined || best === null) {
        return { content: [{ type: "text", text: "BASELINE — first valid measurement" }], details: { action: "baseline", reason: "first measurement becomes baseline", improvement_pct: 0 } };
      }
      if (!Number.isFinite(best)) throw new Error("best must be a finite number when provided");

      const threshold = Math.max(min_effect_size_pct, noise_floor_pct);

      // Follow benchmark-policy.md: keep if candidate beats the relative threshold
      let improved: boolean;
      let improvementPct: number;

      if (best === 0) {
        // Can't compute relative improvement against zero — use absolute direction check
        improved = direction === "lower" ? candidate < 0 : candidate > 0;
        improvementPct = improved ? Infinity : -Infinity;
      } else {
        const factor = 1 - threshold / 100;
        const thresholdValue = direction === "lower"
          ? best * factor
          : best * (1 + threshold / 100);
        improved = direction === "lower" ? candidate < thresholdValue : candidate > thresholdValue;
        improvementPct = direction === "lower"
          ? ((best - candidate) / Math.abs(best)) * 100
          : ((candidate - best) / Math.abs(best)) * 100;
      }

      if (improved) {
        const pctStr = Number.isFinite(improvementPct) ? improvementPct.toFixed(2) : "∞";
        const text = `KEEP — improved ${pctStr}% over current best (threshold ${threshold.toFixed(2)}%)`;
        return { content: [{ type: "text", text }], details: { action: "keep", reason: text, improvement_pct: improvementPct } };
      }

      const pctStr = Number.isFinite(improvementPct) ? improvementPct.toFixed(2) : "-∞";
      const text = `DISCARD — improvement ${pctStr}% is below threshold ${threshold.toFixed(2)}% or worse than best`;
      return { content: [{ type: "text", text }], details: { action: "discard", reason: text, improvement_pct: improvementPct } };
    },
  });

  // ─── autoresearch_dashboard ──────────────────────────────────────────────────
  pi.registerTool({
    name: "autoresearch_dashboard",
    label: "Autoresearch Dashboard",
    description: "Generate a markdown dashboard summary from autoresearch.jsonl. Includes config, run history, and best result.",
    promptSnippet: "Generate a markdown dashboard from autoresearch JSONL state",
    promptGuidelines: [
      "Use autoresearch_dashboard to summarize the experiment progress and best results.",
      "Use it when reporting the end of a loop, after a session, or when asked for a summary.",
    ],
    parameters: {
      type: "object",
      properties: {
        write_file: { type: "boolean", description: "If true, write dashboard to autoresearch-dashboard.md. Default: false." },
      },
      additionalProperties: false,
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = readState(ctx.cwd);

      if (state.parseErrors.length > 0) {
        throw new Error(`Cannot render dashboard — JSONL errors:\n${state.parseErrors.join("\n")}`);
      }
      if (!state.config) throw new Error("No active autoresearch session.");

      const rows = dashboardRows(state);
      const markdown = rows.join("\n");

      if (params.write_file) {
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
          wrote: params.write_file ?? false,
        },
      };
    },
  });
}
