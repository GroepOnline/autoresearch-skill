import type { ArState } from "./types.js";
import { delta, direction, fmt, metricName, metricUnit } from "./state.js";

export function footerText(state: ArState): string {
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

export function statusText(state: ArState): string {
  if (state.parseErrors.length > 0) {
    return [
      "⚠️ .agents/autoresearch/autoresearch.jsonl bevat fouten:",
      ...state.parseErrors.map((error) => `- ${error}`),
    ].join("\n");
  }
  if (!state.config)
    return "Geen actieve autoresearch sessie.\n\nStart met: /autoresearch new <doel>";

  const config = state.config;
  const last = state.results.at(-1);
  return [
    `🔬 Autoresearch: ${config.name}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Metric: ${metricName(config)} (${direction(config)} = beter)`,
    `Runs: ${state.runCount} | ✅ ${state.keptCount} | ❌ ${state.discardedCount} | 💥 ${state.crashedCount}`,
    state.baselineMetric !== null
      ? `Baseline: ${fmt(state.baselineMetric, metricUnit(config))}`
      : "",
    state.bestMetric !== null && state.bestRun !== null
      ? `Best: ${fmt(state.bestMetric, metricUnit(config))} (#${state.bestRun}) ${delta(state.bestMetric, state.baselineMetric ?? 0)}`
      : "Best: geen resultaten nog",
    last ? `Laatste: run #${last.run} → ${last.status} — ${last.description}` : "",
    state.isPaused ? "⏸️  GEPAUZEERD — gebruik /autoresearch resume" : "▶️  ACTIEF",
    state.hasIdeas ? "💡 .agents/autoresearch/autoresearch.ideas.md aanwezig" : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function dashboardRows(state: ArState): string[] {
  if (!state.config) return [];

  const config = state.config;
  const rows = [
    `🔬 ${config.name} | ${state.runCount} runs | ✅${state.keptCount} ❌${state.discardedCount} 💥${state.crashedCount}`,
  ];
  if (state.baselineMetric !== null)
    rows.push(`Baseline: ${fmt(state.baselineMetric, metricUnit(config))}`);
  if (state.bestMetric !== null && state.bestRun !== null)
    rows.push(
      `Best: ${fmt(state.bestMetric, metricUnit(config))} (#${state.bestRun}) ${delta(state.bestMetric, state.baselineMetric ?? 0)}`
    );
  rows.push("─".repeat(60));
  rows.push(`# │ ${metricName(config).padEnd(12)} │ status   │ beschrijving`);
  rows.push("─".repeat(60));

  for (const result of state.results.slice(-12)) {
    const action =
      state.decisions.find((decision) => decision.run === result.run)?.action ?? result.status;
    const icon =
      action === "keep" || action === "baseline"
        ? "✅"
        : action === "discard"
          ? "❌"
          : result.status === "crash"
            ? "💥"
            : "·";
    const d = state.baselineMetric !== null ? delta(result.value, state.baselineMetric) : "";
    rows.push(
      `${String(result.run).padStart(3)} │ ${fmt(result.value, metricUnit(config)).padEnd(12)} │ ${icon} ${action.padEnd(7)} │ ${result.description.slice(0, 28)} ${d}`
    );
  }

  return rows;
}
