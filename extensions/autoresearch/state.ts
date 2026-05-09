import * as fs from "node:fs";
import * as path from "node:path";
import type { ArConfig, ArDecision, ArResult, ArState, NormalizedResult, StartBudgets } from "./types.js";

export function paths(cwd: string) {
  return {
    jsonl: path.join(cwd, "autoresearch.jsonl"),
    context: path.join(cwd, "autoresearch.md"),
    sentinel: path.join(cwd, ".autoresearch-off"),
    dashboard: path.join(cwd, "autoresearch-dashboard.md"),
    worklog: path.join(cwd, "experiments", "worklog.md"),
    ideas: path.join(cwd, "autoresearch.ideas.md"),
    snapshot: path.join(cwd, "AUTORESEARCH_STATE.json"),
  };
}

export function metricName(config: ArConfig): string {
  return config.metric ?? config.metricName ?? "metric";
}

export function metricUnit(config: ArConfig): string {
  return config.unit ?? config.metricUnit ?? "";
}

export function direction(config: ArConfig): "lower" | "higher" {
  return config.direction ?? config.bestDirection ?? "lower";
}

function resultValue(result: ArResult): number | null {
  if (typeof result.median === "number" && Number.isFinite(result.median)) return result.median;
  if (typeof result.value === "number" && Number.isFinite(result.value)) return result.value;
  if (typeof result.metric === "number" && Number.isFinite(result.metric)) return result.metric;
  return null;
}

function normalizeResult(result: ArResult, config: ArConfig | null): NormalizedResult | null {
  const value = resultValue(result);
  if (value === null || !Number.isInteger(result.run) || result.run <= 0) return null;

  return {
    run: result.run,
    metricName: typeof result.metric === "string" && result.metric.trim() ? result.metric : config ? metricName(config) : "metric",
    value,
    status: result.status ?? "measured",
    description: result.description ?? "",
    timestamp: result.timestamp,
    segment: result.segment,
    commit: result.commit,
    metrics: result.metrics,
  };
}

function emptyState(cwd: string): ArState {
  const p = paths(cwd);
  return {
    config: null,
    results: [],
    decisions: [],
    parseErrors: [],
    runCount: 0,
    keptCount: 0,
    discardedCount: 0,
    crashedCount: 0,
    bestMetric: null,
    bestRun: null,
    baselineMetric: null,
    currentSegment: 0,
    isPaused: fs.existsSync(p.sentinel),
    hasIdeas: fs.existsSync(p.ideas),
  };
}

function isNumericArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === "number" && Number.isFinite(item));
}

function writeSnapshotAtomic(snapshotPath: string, data: unknown): void {
  const tempPath = `${snapshotPath}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(tempPath, payload, "utf-8");
  fs.renameSync(tempPath, snapshotPath);
}

function buildSnapshot(cwd: string, state: ArState): Record<string, unknown> | null {
  const config = state.config;
  if (!config) return null;

  const baselineDecision = state.decisions.find(d => d.action === "baseline");
  const baselineResult = baselineDecision ? state.results.find(result => result.run === baselineDecision.run) : state.results[0] ?? null;

  return {
    session: config.name,
    timestamp: new Date().toISOString(),
    config: {
      name: config.name,
      metric: metricName(config),
      direction: direction(config),
      unit: metricUnit(config),
      max_runs: config.max_runs,
      max_minutes: config.max_minutes,
      min_effect_size_pct: config.min_effect_size_pct,
      noise_floor_pct: config.noise_floor_pct,
      max_consecutive_discards: config.max_consecutive_discards,
      max_runs_without_improvement: config.max_runs_without_improvement,
      max_diff_lines_assisted: config.max_diff_lines_assisted,
      max_diff_lines_ralph: config.max_diff_lines_ralph,
    },
    baseline: baselineResult
      ? {
          run: baselineResult.run,
          value: baselineResult.value,
        }
      : null,
    best: state.bestRun !== null && state.bestMetric !== null
      ? {
          run: state.bestRun,
          value: state.bestMetric,
        }
      : null,
    counts: {
      runs: state.runCount,
      kept: state.keptCount,
      discarded: state.discardedCount,
      crashed: state.crashedCount,
    },
    latestErrors: state.parseErrors.slice(-5),
    resumeInstruction: `Review autoresearch.jsonl and continue from run ${state.runCount + 1}`,
    lastDecisions: state.decisions.slice(-5).map(d => ({
      run: d.run,
      action: d.action,
      reason: d.reason,
    })),
  };
}

export function readState(cwd: string): ArState {
  const p = paths(cwd);
  const state = emptyState(cwd);
  if (!fs.existsSync(p.jsonl)) return state;

  const resultByRun = new Map<number, NormalizedResult>();
  const seenActions = new Map<number, ArDecision["action"]>();
  const seenResultRuns = new Set<number>();
  let sawNonEmptyLine = false;
  let sawConfig = false;

  fs.readFileSync(p.jsonl, "utf-8").split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    sawNonEmptyLine = true;

    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch (error) {
      state.parseErrors.push(`line ${index + 1}: invalid JSON (${String(error)})`);
      return;
    }

    if (!event || typeof event !== "object") {
      state.parseErrors.push(`line ${index + 1}: event must be an object`);
      return;
    }

    const typed = event as { type?: string };

    if (typed.type === "config") {
      sawConfig = true;
      const config = event as ArConfig;
      if (config.schema_version !== 1) state.parseErrors.push(`line ${index + 1}: config.schema_version must be 1`);
      if (typeof config.name !== "string" || config.name.trim() === "") state.parseErrors.push(`line ${index + 1}: config.name is required`);
      if (typeof config.metric !== "string" || config.metric.trim() === "") state.parseErrors.push(`line ${index + 1}: config.metric is required`);
      if (!Number.isFinite(config.created_at ? Date.parse(config.created_at) : Number.NaN)) state.parseErrors.push(`line ${index + 1}: config.created_at is required`);
      if (config.direction !== "lower" && config.direction !== "higher") state.parseErrors.push(`line ${index + 1}: config.direction must be lower or higher`);
      state.config = config;
      state.currentSegment = config.segment ?? state.currentSegment;
      return;
    }

    if (!sawConfig) {
      state.parseErrors.push(`line ${index + 1}: non-config event before config`);
    }

    if (typed.type === "decision") {
      const decision = event as ArDecision;
      if (!Number.isInteger(decision.run) || decision.run <= 0) state.parseErrors.push(`line ${index + 1}: decision.run must be a positive integer`);
      if (!decision.reason || typeof decision.reason !== "string") state.parseErrors.push(`line ${index + 1}: decision.reason is required`);
      if (typeof decision.timestamp !== "string" || decision.timestamp.trim() === "") state.parseErrors.push(`line ${index + 1}: decision.timestamp is required`);
      if (!seenResultRuns.has(decision.run)) state.parseErrors.push(`line ${index + 1}: decision.run ${decision.run} has no preceding result`);
      if (!["keep", "discard", "baseline", "stop"].includes(decision.action)) state.parseErrors.push(`line ${index + 1}: invalid decision.action`);
      state.decisions.push(decision);
      seenActions.set(decision.run, decision.action);
      return;
    }

    if (typed.type === "result" || (event as ArResult).run !== undefined) {
      const result = event as ArResult;
      const run = result.run;
      if (!Number.isInteger(run) || run <= 0) {
        state.parseErrors.push(`line ${index + 1}: result.run must be a positive integer`);
        return;
      }
      if (seenResultRuns.has(run)) {
        state.parseErrors.push(`line ${index + 1}: duplicate result.run ${run}`);
        return;
      }
      if (typeof result.metric !== "string" || result.metric.trim() === "") {
        state.parseErrors.push(`line ${index + 1}: result.metric is required`);
        return;
      }
      const value = resultValue(result);
      if (value === null) {
        state.parseErrors.push(`line ${index + 1}: result.value or result.median must be a finite number`);
        return;
      }
      if (typeof result.timestamp !== "string" || result.timestamp.trim() === "") {
        state.parseErrors.push(`line ${index + 1}: result.timestamp is required`);
        return;
      }
      if (result.samples !== undefined && !isNumericArray(result.samples)) {
        state.parseErrors.push(`line ${index + 1}: result.samples must be a non-empty numeric list`);
        return;
      }
      if (result.status !== undefined && !["measured", "keep", "discard", "crash"].includes(result.status)) {
        state.parseErrors.push(`line ${index + 1}: invalid result.status`);
        return;
      }

      const normalized = normalizeResult(result, state.config);
      if (!normalized) {
        state.parseErrors.push(`line ${index + 1}: invalid result event`);
        return;
      }

      state.results.push(normalized);
      resultByRun.set(normalized.run, normalized);
      seenResultRuns.add(normalized.run);
      if (["keep", "discard"].includes(normalized.status)) {
        seenActions.set(normalized.run, normalized.status as "keep" | "discard");
      }
      return;
    }

    state.parseErrors.push(`line ${index + 1}: unknown event type`);
  });

  if (sawNonEmptyLine && !state.config) {
    state.parseErrors.push("first non-empty event must be a config event");
  }

  const baselineDecision = state.decisions.find(d => d.action === "baseline");
  const baselineResult = baselineDecision ? resultByRun.get(baselineDecision.run) : state.results[0];
  state.baselineMetric = baselineResult?.value ?? null;

  const dir = state.config ? direction(state.config) : "lower";
  for (const result of state.results) {
    const action = seenActions.get(result.run);
    const isBestCandidate = action === "baseline" || action === "keep" || (!action && result.run === baselineResult?.run);
    if (!isBestCandidate) continue;

    if (
      state.bestMetric === null ||
      (dir === "lower" ? result.value < state.bestMetric : result.value > state.bestMetric)
    ) {
      state.bestMetric = result.value;
      state.bestRun = result.run;
    }
  }

  state.runCount = state.results.length;
  state.keptCount = [...seenActions.values()].filter(action => action === "keep" || action === "baseline").length;
  state.discardedCount = [...seenActions.values()].filter(action => action === "discard").length;
  state.crashedCount = state.results.filter(result => result.status === "crash").length;

  return state;
}

export function fmt(value: number, unit: string): string {
  return unit ? `${value}${unit}` : String(value);
}

export function delta(current: number, baseline: number): string {
  if (!baseline) return "";
  const d = ((current - baseline) / baseline) * 100;
  return d >= 0 ? `(+${d.toFixed(1)}%)` : `(${d.toFixed(1)}%)`;
}

export function buildContextInjection(cwd: string, state: ArState, lastRunDurationMs?: number): string | null {
  const p = paths(cwd);
  if (!fs.existsSync(p.context) || fs.existsSync(p.sentinel)) return null;
  if (state.parseErrors.length > 0) {
    return [
      "## Autoresearch blocked",
      "autoresearch.jsonl has parse or schema errors. Fix these before continuing:",
      ...state.parseErrors.map(error => `- ${error}`),
    ].join("\n");
  }

  let md = fs.readFileSync(p.context, "utf-8");

  if (state.config) {
    const snapshot = buildSnapshot(cwd, state);
    if (snapshot) {
      try {
        writeSnapshotAtomic(p.snapshot, snapshot);
      } catch (error) {
        console.error(`[autoresearch] Failed to write snapshot to ${p.snapshot}:`, error);
      }
    }
  }

  if (!state.config || state.runCount === 0) return md;

  const config = state.config;

  // ── Explicit loop header ─────────────────────────────────────────────────
  md += `\n\n---\n## 🔬 Autoresearch Loop — Run ${state.runCount + 1}\n`;
  md += `**Je bent in een bounded autoresearch loop.** Test één hypothese per run,\n`;
  md += `vergelijk met de huidige best, en gebruik autoresearch_decide voor keep/discard.\n\n`;

  // ── Live stats ────────────────────────────────────────────────────────────
  md += `### Status\n`;
  md += `| Metric | Waarde |\n`;
  md += `|--------|--------|\n`;
  md += `| Runs | ${state.runCount} (✅ ${state.keptCount} keep / ❌ ${state.discardedCount} discard / 💥 ${state.crashedCount} crash) |\n`;
  if (state.baselineMetric !== null) md += `| Baseline ${metricName(config)} | ${fmt(state.baselineMetric, metricUnit(config))} |\n`;
  if (state.bestMetric !== null && state.bestRun !== null) {
    md += `| Best ${metricName(config)} | ${fmt(state.bestMetric, metricUnit(config))} (#${state.bestRun}) ${delta(state.bestMetric, state.baselineMetric ?? 0)} |\n`;
  }
  const dir = direction(config);
  md += `| Doel | ${dir === "lower" ? "↓ lager" : "↑ hoger"} is beter |\n`;
  if (lastRunDurationMs !== undefined && lastRunDurationMs > 0) {
    md += `| Laatste run | ${(lastRunDurationMs / 1000).toFixed(1)}s |\n`;
  }

  // ── Recently tried (auto-generated from JSONL, no manual worklog needed) ─
  const recent = state.results.slice(-10).reverse();
  if (recent.length > 0) {
    md += `\n### Recently Tried (auto-generated)\n`;
    md += `| Run | Result | Status | Commit | Description |\n`;
    md += `|-----|--------|--------|--------|-------------|\n`;
    for (const r of recent) {
      const action = state.decisions.find(d => d.run === r.run)?.action ?? r.status;
      const icon = action === "keep" || action === "baseline" ? "✅" : action === "discard" ? "❌" : r.status === "crash" ? "💥" : "·";
      const d = state.baselineMetric !== null ? delta(r.value, state.baselineMetric) : "";
      const commitShort = r.commit ? r.commit.slice(0, 7) : "-";
      md += `| ${r.run} | ${fmt(r.value, metricUnit(config))} ${d} | ${icon} ${action} | \`${commitShort}\` | ${r.description.slice(0, 60)} |\n`;
      // Show secondary metrics if present
      if (r.metrics && Object.keys(r.metrics).length > 0) {
        const secondary = Object.entries(r.metrics)
          .filter(([k]) => k !== metricName(config))
          .map(([k, v]) => `${k}=${fmt(v, metricUnit(config))}`)
          .join(", ");
        if (secondary) md += `| | | | | ↳ ${secondary} |\n`;
      }
    }
    md += `\n⚠️ **Baseer je volgende hypothese op wat al geprobeerd is — geen herhaling!**\n`;
  }

  md += `\n### Regels\n`;
  md += `- ÉÉN hypothese per run\n`;
  md += `- Run \`./autoresearch.sh\` als benchmark\n`;
  md += `- Gebruik \`autoresearch_decide\` voor keep/discard/stop\n`;
  md += `- Stop bij: budget op, safety issues, corrupte state, noise, of test failures\n`;

  return md;
}

export function parseStartBudgets(rest: string[]): StartBudgets {
  const maxRuns = Number.parseInt(rest[0] ?? "5", 10);
  const maxMinutes = Number.parseInt(rest[1] ?? "30", 10);
  return {
    maxRuns: Number.isFinite(maxRuns) && maxRuns > 0 ? maxRuns : 5,
    maxMinutes: Number.isFinite(maxMinutes) && maxMinutes > 0 ? maxMinutes : 30,
  };
}
