/**
 * Autoresearch Pi Extension
 *
 * Native Pi TUI integration for bounded autoresearch sessions:
 *  - /autoresearch [status|pause|resume|dashboard|new|start]
 *  - Footer status from autoresearch.jsonl
 *  - before_agent_start: injects bounded loop context when autoresearch.md exists
 *  - session_before_compact: preserves valid loop state in compaction summaries
 *  - session_start: restores footer/state on reload/resume
 *
 * Installatie:
 *   ln -s ~/projects/autoresearch-skill/extension.ts ~/.pi/agent/extensions/autoresearch.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ArConfig {
  type: "config";
  schema_version?: number;
  name: string;
  metric?: string;
  direction?: "lower" | "higher";
  unit?: string;
  min_effect_size_pct?: number;
  noise_floor_pct?: number;
  max_runs?: number;
  max_minutes?: number;
  created_at?: string;
  segment?: number;
  // Legacy fields used by earlier extension drafts.
  metricName?: string;
  metricUnit?: string;
  bestDirection?: "lower" | "higher";
}

interface ArResult {
  type?: "result";
  run: number;
  commit?: string;
  metric: string | number;
  value?: number;
  median?: number;
  samples?: number[];
  status?: "measured" | "keep" | "discard" | "crash";
  description?: string;
  timestamp?: string | number;
  segment?: number;
  metrics?: Record<string, number>;
}

interface ArDecision {
  type: "decision";
  run: number;
  action: "keep" | "discard" | "baseline" | "stop";
  reason: string;
  timestamp?: string;
}

interface NormalizedResult {
  run: number;
  metricName: string;
  value: number;
  status: "measured" | "keep" | "discard" | "crash";
  description: string;
  timestamp?: string | number;
  segment?: number;
}

interface ArState {
  config: ArConfig | null;
  results: NormalizedResult[];
  decisions: ArDecision[];
  parseErrors: string[];
  runCount: number;
  keptCount: number;
  discardedCount: number;
  crashedCount: number;
  bestMetric: number | null;
  bestRun: number | null;
  baselineMetric: number | null;
  currentSegment: number;
  isPaused: boolean;
  hasIdeas: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function paths(cwd: string) {
  return {
    jsonl: path.join(cwd, "autoresearch.jsonl"),
    context: path.join(cwd, "autoresearch.md"),
    sentinel: path.join(cwd, ".autoresearch-off"),
    dashboard: path.join(cwd, "autoresearch-dashboard.md"),
    worklog: path.join(cwd, "experiments", "worklog.md"),
    ideas: path.join(cwd, "autoresearch.ideas.md"),
  };
}

function metricName(config: ArConfig): string {
  return config.metric ?? config.metricName ?? "metric";
}

function metricUnit(config: ArConfig): string {
  return config.unit ?? config.metricUnit ?? "";
}

function direction(config: ArConfig): "lower" | "higher" {
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
    metricName: typeof result.metric === "string" ? result.metric : config ? metricName(config) : "metric",
    value,
    status: result.status ?? "measured",
    description: result.description ?? "",
    timestamp: result.timestamp,
    segment: result.segment,
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

function readState(cwd: string): ArState {
  const p = paths(cwd);
  const state = emptyState(cwd);
  if (!fs.existsSync(p.jsonl)) return state;

  const resultByRun = new Map<number, NormalizedResult>();
  const seenActions = new Map<number, ArDecision["action"]>();
  let sawNonEmptyLine = false;

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
      const config = event as ArConfig;
      if (!config.name) state.parseErrors.push(`line ${index + 1}: config.name is required`);
      if (!(config.metric ?? config.metricName)) state.parseErrors.push(`line ${index + 1}: config.metric is required`);
      if (!(config.direction ?? config.bestDirection)) state.parseErrors.push(`line ${index + 1}: config.direction must be lower or higher`);
      if ((config.direction ?? config.bestDirection) && !["lower", "higher"].includes(direction(config))) state.parseErrors.push(`line ${index + 1}: config.direction must be lower or higher`);
      state.config = config;
      state.currentSegment = config.segment ?? state.currentSegment;
      return;
    }

    if (typed.type === "result" || (event as ArResult).run !== undefined) {
      const normalized = normalizeResult(event as ArResult, state.config);
      if (!normalized) {
        state.parseErrors.push(`line ${index + 1}: invalid result event`);
        return;
      }
      state.results.push(normalized);
      resultByRun.set(normalized.run, normalized);
      if (["keep", "discard"].includes(normalized.status)) {
        seenActions.set(normalized.run, normalized.status as "keep" | "discard");
      }
      return;
    }

    if (typed.type === "decision") {
      const decision = event as ArDecision;
      if (!Number.isInteger(decision.run) || decision.run <= 0) state.parseErrors.push(`line ${index + 1}: decision.run must be a positive integer`);
      if (!["keep", "discard", "baseline", "stop"].includes(decision.action)) state.parseErrors.push(`line ${index + 1}: invalid decision.action`);
      state.decisions.push(decision);
      seenActions.set(decision.run, decision.action);
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

function fmt(value: number, unit: string): string {
  return unit ? `${value}${unit}` : String(value);
}

function delta(current: number, baseline: number): string {
  if (!baseline) return "";
  const d = ((current - baseline) / baseline) * 100;
  return d >= 0 ? `(+${d.toFixed(1)}%)` : `(${d.toFixed(1)}%)`;
}

function footerText(state: ArState): string {
  if (state.parseErrors.length > 0) return `⚠️ AR JSONL parse error (${state.parseErrors.length})`;
  if (!state.config) return "";
  const config = state.config;
  const last = state.results.at(-1);
  const icon = state.isPaused ? "⏸" : last?.status === "crash" ? "💥" : "🔬";
  let s = `${icon} AR:${config.name} | runs:${state.runCount}`;
  if (state.bestMetric !== null && state.baselineMetric !== null) {
    s += ` | best:${fmt(state.bestMetric, metricUnit(config))} ${delta(state.bestMetric, state.baselineMetric)}`;
  }
  if (state.isPaused) s += " [paused]";
  return s;
}

function buildContextInjection(cwd: string, state: ArState): string | null {
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

  if (state.config && state.runCount > 0) {
    const config = state.config;
    const last = state.results.at(-1);
    md += `\n\n---\n## Autoresearch Loop — Live State\n`;
    md += `- Run: **${state.runCount}** | ✅ ${state.keptCount} | ❌ ${state.discardedCount} | 💥 ${state.crashedCount}\n`;
    if (state.baselineMetric !== null) md += `- Baseline ${metricName(config)}: ${fmt(state.baselineMetric, metricUnit(config))}\n`;
    if (state.bestMetric !== null && state.bestRun !== null) md += `- Best ${metricName(config)}: ${fmt(state.bestMetric, metricUnit(config))} (#${state.bestRun}) ${delta(state.bestMetric, state.baselineMetric ?? 0)}\n`;
    if (last) md += `- Last run #${last.run}: ${last.status} — ${last.description}\n`;
    md += `\nContinue one bounded hypothesis at a time. Stop at budget, unsafe git state, corrupt state, noisy metrics, or failing correctness checks.\n`;
  }

  return md;
}

function parseStartBudgets(rest: string[]): { maxRuns: number; maxMinutes: number } {
  const maxRuns = Number.parseInt(rest[0] ?? "5", 10);
  const maxMinutes = Number.parseInt(rest[1] ?? "30", 10);
  return {
    maxRuns: Number.isFinite(maxRuns) && maxRuns > 0 ? maxRuns : 5,
    maxMinutes: Number.isFinite(maxMinutes) && maxMinutes > 0 ? maxMinutes : 30,
  };
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function autoresearchExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const state = readState(ctx.cwd);
    ctx.ui.setStatus("autoresearch", footerText(state));

    if (state.hasIdeas) {
      const lines = fs.readFileSync(paths(ctx.cwd).ideas, "utf-8").split("\n");
      const count = lines.filter(line => line.startsWith("- ")).length;
      if (count > 0) ctx.ui.notify(`💡 autoresearch.ideas.md heeft ${count} ideeën`, "info");
    }
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const state = readState(ctx.cwd);
    const injection = buildContextInjection(ctx.cwd, state);
    if (!injection) return;

    ctx.ui.setStatus("autoresearch", footerText(state));

    return {
      message: {
        customType: "autoresearch-context",
        content: injection,
        display: false,
      },
    };
  });

  pi.on("agent_end", async (_event, ctx) => {
    const state = readState(ctx.cwd);
    ctx.ui.setStatus("autoresearch", footerText(state));
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const state = readState(ctx.cwd);
    if (!state.config || state.parseErrors.length > 0) return;

    const { preparation } = event;
    const config = state.config;
    const arSummary = [
      `## Autoresearch Loop — Context Preserved`,
      `Name: ${config.name}`,
      `Metric: ${metricName(config)} (${direction(config)})`,
      `Runs: ${state.runCount} | Kept: ${state.keptCount} | Discarded: ${state.discardedCount} | Crashed: ${state.crashedCount}`,
      state.baselineMetric !== null ? `Baseline: ${fmt(state.baselineMetric, metricUnit(config))}` : "",
      state.bestMetric !== null && state.bestRun !== null ? `Best: ${fmt(state.bestMetric, metricUnit(config))} (#${state.bestRun}) ${delta(state.bestMetric, state.baselineMetric ?? 0)}` : "",
      "",
      `State files: autoresearch.jsonl, autoresearch.md, experiments/worklog.md`,
      `Rule: continue bounded experiments; stop at configured budget, safety issues, corrupt state, or noisy/failed measurements.`,
      `Resume: read autoresearch.jsonl + worklog.md, continue from run ${state.runCount + 1}`,
    ].filter(Boolean).join("\n");

    return {
      compaction: {
        summary: `${arSummary}\n\n---\n\n[See autoresearch.jsonl for full experiment history]`,
        firstKeptEntryId: preparation.firstKeptEntryId,
        tokensBefore: preparation.tokensBefore,
      },
    };
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus("autoresearch", "");
  });

  pi.registerCommand("autoresearch", {
    description: "Autoresearch loop control: status | pause | resume | dashboard | new <goal> | start [max_runs] [max_minutes]",

    getArgumentCompletions: (prefix: string) => {
      const subs = ["status", "pause", "resume", "dashboard", "new", "start"];
      return subs.filter(sub => sub.startsWith(prefix)).map(sub => ({ value: sub, label: sub }));
    },

    handler: async (args: string, ctx) => {
      const [sub = "", ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const p = paths(ctx.cwd);

      switch (sub) {
        case "status":
        case "": {
          const state = readState(ctx.cwd);
          if (state.parseErrors.length > 0) {
            ctx.ui.notify(["⚠️ autoresearch.jsonl bevat fouten:", ...state.parseErrors.map(error => `- ${error}`)].join("\n"), "error");
            return;
          }
          if (!state.config) {
            ctx.ui.notify("Geen actieve autoresearch sessie.\n\nStart met: /autoresearch new <doel>", "info");
            return;
          }
          const config = state.config;
          const last = state.results.at(-1);
          ctx.ui.notify([
            `🔬 Autoresearch: ${config.name}`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `Metric: ${metricName(config)} (${direction(config)} = beter)`,
            `Runs: ${state.runCount} | ✅ ${state.keptCount} | ❌ ${state.discardedCount} | 💥 ${state.crashedCount}`,
            state.baselineMetric !== null ? `Baseline: ${fmt(state.baselineMetric, metricUnit(config))}` : "",
            state.bestMetric !== null && state.bestRun !== null ? `Best: ${fmt(state.bestMetric, metricUnit(config))} (#${state.bestRun}) ${delta(state.bestMetric, state.baselineMetric ?? 0)}` : "Best: geen resultaten nog",
            last ? `Laatste: run #${last.run} → ${last.status} — ${last.description}` : "",
            state.isPaused ? "⏸️  GEPAUZEERD — gebruik /autoresearch resume" : "▶️  ACTIEF",
            state.hasIdeas ? "💡 autoresearch.ideas.md aanwezig" : "",
          ].filter(Boolean).join("\n"), "info");
          return;
        }

        case "pause": {
          fs.writeFileSync(p.sentinel, `paused: ${new Date().toISOString()}\n`);
          const state = readState(ctx.cwd);
          ctx.ui.setStatus("autoresearch", footerText(state));
          ctx.ui.notify("⏸️  Autoresearch loop gepauzeerd.\nGebruik /autoresearch resume om door te gaan.", "info");
          return;
        }

        case "resume": {
          if (fs.existsSync(p.sentinel)) fs.unlinkSync(p.sentinel);
          const state = readState(ctx.cwd);
          ctx.ui.setStatus("autoresearch", footerText(state));
          ctx.ui.notify("▶️  Autoresearch loop hervat.", "info");
          return;
        }

        case "dashboard": {
          const state = readState(ctx.cwd);
          if (state.parseErrors.length > 0) {
            ctx.ui.notify(["Kan dashboard niet tonen; JSONL fouten:", ...state.parseErrors.map(error => `- ${error}`)].join("\n"), "error");
            return;
          }
          if (!state.config) {
            ctx.ui.notify("Geen actieve sessie.", "warning");
            return;
          }
          const config = state.config;
          const rows = [`🔬 ${config.name} | ${state.runCount} runs | ✅${state.keptCount} ❌${state.discardedCount} 💥${state.crashedCount}`];
          if (state.baselineMetric !== null) rows.push(`Baseline: ${fmt(state.baselineMetric, metricUnit(config))}`);
          if (state.bestMetric !== null && state.bestRun !== null) rows.push(`Best: ${fmt(state.bestMetric, metricUnit(config))} (#${state.bestRun}) ${delta(state.bestMetric, state.baselineMetric ?? 0)}`);
          rows.push("─".repeat(60));
          rows.push(`# │ ${metricName(config).padEnd(12)} │ status   │ beschrijving`);
          rows.push("─".repeat(60));

          for (const result of state.results.slice(-12)) {
            const action = state.decisions.find(decision => decision.run === result.run)?.action ?? result.status;
            const icon = action === "keep" || action === "baseline" ? "✅" : action === "discard" ? "❌" : result.status === "crash" ? "💥" : "·";
            const d = state.baselineMetric !== null ? delta(result.value, state.baselineMetric) : "";
            rows.push(`${String(result.run).padStart(3)} │ ${fmt(result.value, metricUnit(config)).padEnd(12)} │ ${icon} ${action.padEnd(7)} │ ${result.description.slice(0, 28)} ${d}`);
          }

          ctx.ui.setWidget("autoresearch", rows);
          ctx.ui.notify("Dashboard bijgewerkt — zie widget boven de editor.", "info");
          return;
        }

        case "new": {
          const goal = rest.join(" ").trim();
          if (!goal) {
            ctx.ui.notify("Gebruik: /autoresearch new <doel>\nBijv: /autoresearch new optimize-parser-latency", "warning");
            return;
          }

          if (fs.existsSync(p.context)) {
            const ok = await ctx.ui.confirm("Overschrijven?", `autoresearch.md bestaat al. Overschrijven voor nieuw doel: "${goal}"?`);
            if (!ok) return;
          }

          fs.mkdirSync(path.join(ctx.cwd, "experiments"), { recursive: true });

          fs.writeFileSync(p.context, [
            `# Autoresearch: ${goal}`,
            "",
            "## Objective",
            goal,
            "",
            "## Metrics",
            "- **Primary**: <metric_name> (<unit>, lower/higher is better)",
            "- **Secondary**: optional correctness, size, memory, or latency guardrails",
            "",
            "## How to Run",
            "`./autoresearch.sh` — runs correctness checks and prints `METRIC name=value direction=lower|higher` lines.",
            "",
            "## Files in Scope",
            "<Every file the agent may change>",
            "",
            "## Off Limits",
            "<Files, APIs, or behaviors that must not change>",
            "",
            "## Constraints",
            "- Tests must pass before any keep decision.",
            "- One hypothesis per run.",
            "- Stop at configured budget, unsafe git state, corrupt state, or noisy benchmarks.",
            "",
            "## What's Been Tried",
            "- (baseline not measured yet)",
          ].join("\n"));

          const benchmark = path.join(ctx.cwd, "autoresearch.sh");
          if (!fs.existsSync(benchmark)) {
            fs.writeFileSync(benchmark, [
              "#!/usr/bin/env bash",
              "set -euo pipefail",
              "",
              "# TODO: run your real correctness checks and benchmark here.",
              "# The benchmark must print at least one line like:",
              "#   METRIC latency_ms=12.4 direction=lower",
              "echo 'autoresearch.sh is not configured yet; edit it before /autoresearch start.' >&2",
              "exit 2",
            ].join("\n"), { mode: 0o755 });
          }

          if (!fs.existsSync(p.worklog)) {
            fs.writeFileSync(p.worklog, [
              `# Autoresearch Worklog: ${goal}`,
              `Started: ${new Date().toISOString().slice(0, 16)}`,
              "",
              "## Key Insights",
              "- (record lessons after each experiment)",
              "",
              "## Next Ideas",
              "- (add candidate hypotheses here)",
              "",
              "---",
            ].join("\n"));
          }

          ctx.ui.notify([
            `✅ Autoresearch sessie '${goal}' aangemaakt!`,
            "",
            "Volgende stappen:",
            "1. Edit autoresearch.md — vul metrics, scope en constraints in",
            "2. Edit autoresearch.sh — implementeer echte tests/benchmark",
            "3. /autoresearch start [max_runs] [max_minutes] — begin bounded loop",
          ].join("\n"), "info");

          const state = readState(ctx.cwd);
          ctx.ui.setStatus("autoresearch", footerText(state));
          return;
        }

        case "start": {
          const state = readState(ctx.cwd);
          if (state.parseErrors.length > 0) {
            ctx.ui.notify(["Start geblokkeerd; JSONL fouten:", ...state.parseErrors.map(error => `- ${error}`)].join("\n"), "error");
            return;
          }
          if (!fs.existsSync(p.context)) {
            ctx.ui.notify("autoresearch.md niet gevonden. Gebruik eerst /autoresearch new <doel>.", "error");
            return;
          }
          if (!fs.existsSync(path.join(ctx.cwd, "autoresearch.sh"))) {
            ctx.ui.notify("autoresearch.sh niet gevonden. Maak het aan voordat je start.", "error");
            return;
          }
          if (fs.existsSync(p.sentinel)) {
            ctx.ui.notify("Loop is gepauzeerd. Gebruik /autoresearch resume eerst.", "warning");
            return;
          }

          const budgets = parseStartBudgets(rest);
          ctx.ui.notify(`🚀 Autoresearch loop gestart met budget: ${budgets.maxRuns} runs / ${budgets.maxMinutes} min.`, "info");
          pi.sendUserMessage([
            "Start de bounded autoresearch loop.",
            "Lees autoresearch.md, autoresearch.jsonl en experiments/worklog.md voor context.",
            "Run ./autoresearch.sh als benchmark en parse METRIC-regels.",
            `Budget: maximaal ${budgets.maxRuns} runs of ${budgets.maxMinutes} minuten.`,
            "Test één hypothese per run, vergelijk tegen de huidige best, leg elke beslissing vast, en stop bij budget/safety/noise/correctness failures.",
          ].join(" "), { deliverAs: "followUp" });
          return;
        }

        default:
          ctx.ui.notify(
            `Onbekend subcommando: '${sub}'\n\nGebruik:\n  /autoresearch status\n  /autoresearch pause\n  /autoresearch resume\n  /autoresearch dashboard\n  /autoresearch new <doel>\n  /autoresearch start [max_runs] [max_minutes]`,
            "warning",
          );
      }
    },
  });
}
