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
      "⚠️ .autoresearch/autoresearch.jsonl bevat fouten:",
      ...state.parseErrors.map((error) => `- ${error}`),
    ].join("\n");
  }
  if (!state.config)
    return "Geen actieve autoresearch sessie.\n\nStart met: /autoresearch new <doel>";

  const config = state.config;
  const last = state.results.at(-1);
  return [
    "",
    "╔══════════════════════════════════════════════════════════════════════╗",
    "║                       🔬 AUTORESEARCH STATUS                           ║",
    "╚══════════════════════════════════════════════════════════════════════╝",
    "",
    `📊 Session: ${config.name}`,
    `📈 Metric: ${metricName(config)} (${direction(config)} = beter)`,
    "",
    `🎯 Performance`,
    `   Runs: ${state.runCount} │ ✅ Kept: ${state.keptCount} │ ❌ Discarded: ${state.discardedCount} │ 💥 Crashed: ${state.crashedCount}`,
    "",
    state.baselineMetric !== null
      ? `📏 Baseline: ${fmt(state.baselineMetric, metricUnit(config))}`
      : "",
    state.bestMetric !== null && state.bestRun !== null
      ? `🏆 Best: ${fmt(state.bestMetric, metricUnit(config))} (Run #${state.bestRun}) ${delta(state.bestMetric, state.baselineMetric ?? 0)}`
      : "🏆 Best: geen resultaten nog",
    last ? `📝 Laatste: run #${last.run} → ${last.status} — ${last.description}` : "",
    "",
    state.isPaused ? "⏸️  STATUS: PAUSED — gebruik /autoresearch resume" : "▶️  STATUS: ACTIEF",
    state.hasIdeas ? "💡 .autoresearch/autoresearch.ideas.md aanwezig" : "",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "💡 Gebruik /autoresearch dashboard voor gedetailleerd overzicht",
  ]
    .filter(Boolean)
    .join("\n");
}

export function dashboardRows(state: ArState): string[] {
  if (!state.config) return [];

  const config = state.config;
  const rows = [
    "",
    "╔══════════════════════════════════════════════════════════════════════╗",
    "║                    🔬 AUTORESEARCH DASHBOARD                         ║",
    "╚══════════════════════════════════════════════════════════════════════╝",
    "",
    `📊 Session: ${config.name}`,
    `📈 Metric: ${metricName(config)} (${direction(config)} = beter)`,
    "",
    `🎯 Performance Summary`,
    `   Runs: ${state.runCount} │ ✅ Kept: ${state.keptCount} │ ❌ Discarded: ${state.discardedCount} │ 💥 Crashed: ${state.crashedCount}`,
    "",
  ];

  if (state.baselineMetric !== null) {
    rows.push(`📏 Baseline: ${fmt(state.baselineMetric, metricUnit(config))}`);
  }
  if (state.bestMetric !== null && state.bestRun !== null) {
    rows.push(`🏆 Best: ${fmt(state.bestMetric, metricUnit(config))} (Run #${state.bestRun}) ${delta(state.bestMetric, state.baselineMetric ?? 0)}`);
  }

  if (state.isPaused) {
    rows.push("", "⏸️  STATUS: PAUSED - Use /autoresearch resume to continue");
  } else {
    rows.push("", "▶️  STATUS: ACTIVE");
  }

  rows.push("", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  rows.push("📋 Recent Results");
  rows.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  rows.push(`Run │ ${metricName(config).padEnd(12)} │ Status    │ Description`);
  rows.push("────┴────────────────────┴───────────┴────────────────────────────────");

  const recentResults = state.results.slice(-15).reverse();
  for (const result of recentResults) {
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
    const description = result.description.length > 35 ? result.description.slice(0, 35) + "..." : result.description;
    rows.push(
      `${String(result.run).padStart(3)} │ ${fmt(result.value, metricUnit(config)).padEnd(12)} │ ${icon} ${action.padEnd(8)} │ ${description} ${d}`
    );
  }

  rows.push("", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  rows.push("💡 Quick Actions");
  rows.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  rows.push("  /autoresearch status    - Show detailed status");
  rows.push("  /autoresearch pause     - Pause the loop");
  rows.push("  /autoresearch resume    - Resume the loop");
  rows.push("  /autoresearch quit      - Stop the loop completely");
  rows.push("  /autoresearch validate  - Validate JSONL state");
  rows.push("  /autoresearch finalize  - End session and cleanup");
  rows.push("");

  return rows;
}

function calculateStatistics(state: ArState): {
  successRate: number;
  improvementRate: number;
  avgMetric: number | null;
  medianMetric: number | null;
  recentTrend: string;
  bestStreak: number;
  currentStreak: number;
  stdDev: number | null;
  minMetric: number | null;
  maxMetric: number | null;
  totalImprovement: number | null;
  avgImprovementPerRun: number | null;
  crashRate: number;
  discardRate: number;
  keepRate: number;
  recent5Avg: number | null;
  recent10Avg: number | null;
  momentum: string;
  consistency: number;
  volatility: number;
} {
  if (state.results.length === 0) {
    return {
      successRate: 0,
      improvementRate: 0,
      avgMetric: null,
      medianMetric: null,
      recentTrend: "N/A",
      bestStreak: 0,
      currentStreak: 0,
      stdDev: null,
      minMetric: null,
      maxMetric: null,
      totalImprovement: null,
      avgImprovementPerRun: null,
      crashRate: 0,
      discardRate: 0,
      keepRate: 0,
      recent5Avg: null,
      recent10Avg: null,
      momentum: "N/A",
      consistency: 0,
      volatility: 0,
    };
  }

  const successRate = state.runCount > 0 ? (state.keptCount / state.runCount) * 100 : 0;
  const improvementRate = state.runCount > 0 ? (state.keptCount / state.runCount) * 100 : 0;

  const values = state.results.map(r => r.value).filter(v => v !== null);
  const avgMetric = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;

  let medianMetric = null;
  if (values.length > 0) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianMetric = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // Calculate standard deviation
  let stdDev = null;
  if (values.length > 1 && avgMetric !== null) {
    const squaredDiffs = values.map(v => Math.pow(v - avgMetric, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    stdDev = Math.sqrt(avgSquaredDiff);
  }

  // Min and max
  const minMetric = values.length > 0 ? Math.min(...values) : null;
  const maxMetric = values.length > 0 ? Math.max(...values) : null;

  // Total improvement
  let totalImprovement = null;
  let avgImprovementPerRun = null;
  if (state.baselineMetric !== null && state.bestMetric !== null) {
    totalImprovement = state.baselineMetric - state.bestMetric;
    avgImprovementPerRun = state.runCount > 0 ? totalImprovement / state.runCount : null;
  }

  // Rates
  const crashRate = state.runCount > 0 ? (state.crashedCount / state.runCount) * 100 : 0;
  const discardRate = state.runCount > 0 ? (state.discardedCount / state.runCount) * 100 : 0;
  const keepRate = state.runCount > 0 ? (state.keptCount / state.runCount) * 100 : 0;

  // Recent averages
  let recent5Avg = null;
  let recent10Avg = null;
  if (values.length >= 5) {
    recent5Avg = values.slice(-5).reduce((a, b) => a + b, 0) / 5;
  }
  if (values.length >= 10) {
    recent10Avg = values.slice(-10).reduce((a, b) => a + b, 0) / 10;
  }

  // Calculate recent trend (last 5 runs)
  let recentTrend = "→ Stable";
  if (values.length >= 3) {
    const recent = values.slice(-3);
    if (recent[2] < recent[1] && recent[1] < recent[0]) {
      recentTrend = "📈 Improving";
    } else if (recent[2] > recent[1] && recent[1] > recent[0]) {
      recentTrend = "📉 Declining";
    }
  }

  // Momentum calculation
  let momentum = "N/A";
  if (values.length >= 5) {
    const recent = values.slice(-5);
    const earlier = values.slice(-10, -5);
    if (recent.length >= 3 && earlier.length >= 3) {
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
      if (recentAvg < earlierAvg * 0.95) {
        momentum = "🚀 Strong Up";
      } else if (recentAvg < earlierAvg) {
        momentum = "📈 Gaining";
      } else if (recentAvg > earlierAvg * 1.05) {
        momentum = "⚠️ Losing";
      } else {
        momentum = "→ Stable";
      }
    }
  }

  // Consistency (inverse of coefficient of variation)
  let consistency = 0;
  if (avgMetric !== null && avgMetric > 0 && stdDev !== null) {
    consistency = Math.max(0, 100 - (stdDev / avgMetric) * 100);
  }

  // Volatility (standard deviation relative to range)
  let volatility = 0;
  if (minMetric !== null && maxMetric !== null && maxMetric !== minMetric) {
    volatility = stdDev !== null ? (stdDev / (maxMetric - minMetric)) * 100 : 0;
  }

  // Calculate streaks
  let bestStreak = 0;
  let currentStreak = 0;
  let tempStreak = 0;

  for (const decision of state.decisions) {
    if (decision.action === "keep" || decision.action === "baseline") {
      tempStreak++;
      currentStreak = tempStreak;
    } else {
      bestStreak = Math.max(bestStreak, tempStreak);
      tempStreak = 0;
    }
  }
  bestStreak = Math.max(bestStreak, tempStreak);

  return {
    successRate,
    improvementRate,
    avgMetric,
    medianMetric,
    recentTrend,
    bestStreak,
    currentStreak,
    stdDev,
    minMetric,
    maxMetric,
    totalImprovement,
    avgImprovementPerRun,
    crashRate,
    discardRate,
    keepRate,
    recent5Avg,
    recent10Avg,
    momentum,
    consistency,
    volatility,
  };
}

function generateAsciiChart(values: number[], width: number = 30, height: number = 8): string[] {
  if (values.length === 0) return ["No data available"];

  const maxVal = Math.max(...values);
  const minVal = Math.min(...values);
  const range = maxVal - minVal || 1;

  const lines: string[] = [];

  // Generate chart from top to bottom
  for (let i = height - 1; i >= 0; i--) {
    const threshold = minVal + (range * i) / (height - 1);
    let line = "";

    for (let j = 0; j < Math.min(values.length, width); j++) {
      const val = values[j];
      const normalizedVal = (val - minVal) / range;
      const lineThreshold = i / (height - 1);

      if (normalizedVal >= lineThreshold - 0.1 / height && normalizedVal <= lineThreshold + 0.1 / height) {
        line += "●";
      } else if (normalizedVal > lineThreshold) {
        line += "│";
      } else {
        line += " ";
      }
    }

    const label = threshold.toFixed(1).padStart(6);
    lines.push(`${label} │${line}│`);
  }

  // Add x-axis
  lines.push("       └" + "─".repeat(Math.min(values.length, width)) + "┘");

  return lines;
}

function generateProgressBar(value: number, max: number, width: number = 20): string {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

export function dashboardRowsFullscreen(state: ArState): string[] {
  if (!state.config) return [];

  const config = state.config;
  const stats = calculateStatistics(state);
  const values = state.results.map(r => r.value).filter(v => v !== null);

  const rows = [
    "",
    "╔══════════════════════════════════════════════════════════════════════╗",
    "║      🔬 AUTORESEARCH ULTRA-EXTENDED MULTI-PANE DASHBOARD                 ║",
    "╚══════════════════════════════════════════════════════════════════════╝",
    "",
  ];

  // PANE 1: SESSION INFORMATION (Enhanced)
  rows.push("╔══════════════════════════════════════════════════════════════════════╗");
  rows.push("║  📊 PANE 1: SESSION INFORMATION                                      ║");
  rows.push("╠══════════════════════════════════════════════════════════════════════╣");
  rows.push("║  Name:        " + config.name.padEnd(48) + "║");
  rows.push("║  Metric:      " + `${metricName(config)} (${direction(config)} = beter)`.padEnd(48) + "║");
  rows.push("║  Unit:        " + (metricUnit(config) || "N/A").padEnd(48) + "║");
  rows.push("║  Created:     " + (config.created_at ? new Date(config.created_at).toLocaleString() : "N/A").padEnd(48) + "║");
  rows.push("║  Status:      " + (state.isPaused ? "⏸️  PAUSED" : "▶️  ACTIVE").padEnd(48) + "║");
  rows.push("║  Momentum:    " + stats.momentum.padEnd(48) + "║");
  rows.push("╚══════════════════════════════════════════════════════════════════════╝");
  rows.push("");

  // PANE 2: PERFORMANCE OVERVIEW (Enhanced with Progress Bars)
  rows.push("╔══════════════════════════════════════════════════════════════════════╗");
  rows.push("║  🎯 PANE 2: PERFORMANCE OVERVIEW                                    ║");
  rows.push("╠══════════════════════════════════════════════════════════════════════╣");
  rows.push("║  Total Runs:           " + String(state.runCount).padEnd(38) + "║");
  rows.push("║  ✅ Kept:               " + `${state.keptCount} (${stats.keepRate.toFixed(1)}%) [${generateProgressBar(stats.keepRate, 100, 12)}]`.padEnd(38) + "║");
  rows.push("║  ❌ Discarded:          " + `${state.discardedCount} (${stats.discardRate.toFixed(1)}%) [${generateProgressBar(stats.discardRate, 100, 12)}]`.padEnd(38) + "║");
  rows.push("║  💥 Crashed:            " + `${state.crashedCount} (${stats.crashRate.toFixed(1)}%) [${generateProgressBar(stats.crashRate, 100, 12)}]`.padEnd(38) + "║");
  rows.push("╠══════════════════════════════════════════════════════════════════════╣");
  if (state.baselineMetric !== null) {
    rows.push("║  📏 Baseline:            " + fmt(state.baselineMetric, metricUnit(config)).padEnd(38) + "║");
  }
  if (state.bestMetric !== null && state.bestRun !== null) {
    const improvement = state.baselineMetric !== null
      ? delta(state.bestMetric, state.baselineMetric)
      : "";
    rows.push("║  🏆 Best:                " + `${fmt(state.bestMetric, metricUnit(config))} (Run #${state.bestRun}) ${improvement}`.padEnd(38) + "║");
  }
  if (stats.minMetric !== null) {
    rows.push("║  📊 Min:                 " + fmt(stats.minMetric, metricUnit(config)).padEnd(38) + "║");
  }
  if (stats.maxMetric !== null) {
    rows.push("║  📊 Max:                 " + fmt(stats.maxMetric, metricUnit(config)).padEnd(38) + "║");
  }
  rows.push("╚══════════════════════════════════════════════════════════════════════╝");
  rows.push("");

  // PANE 3: SUCCESS ANALYTICS (Enhanced)
  rows.push("╔══════════════════════════════════════════════════════════════════════╗");
  rows.push("║  📈 PANE 3: SUCCESS ANALYTICS                                       ║");
  rows.push("╠══════════════════════════════════════════════════════════════════════╣");
  rows.push("║  Success Rate:          " + `${stats.successRate.toFixed(1)}% [${generateProgressBar(stats.successRate, 100, 15)}]`.padEnd(38) + "║");
  rows.push("║  Improvement Rate:      " + `${stats.improvementRate.toFixed(1)}% [${generateProgressBar(stats.improvementRate, 100, 15)}]`.padEnd(38) + "║");
  rows.push("║  Recent Trend:          " + stats.recentTrend.padEnd(38) + "║");
  rows.push("║  Best Streak:           " + `${stats.bestStreak} keeps 🔥`.padEnd(38) + "║");
  rows.push("║  Current Streak:        " + `${stats.currentStreak} keeps ⚡`.padEnd(38) + "║");
  rows.push("╠══════════════════════════════════════════════════════════════════════╣");
  if (stats.avgMetric !== null) {
    rows.push("║  Average Metric:        " + fmt(stats.avgMetric, metricUnit(config)).padEnd(38) + "║");
  }
  if (stats.medianMetric !== null) {
    rows.push("║  Median Metric:         " + fmt(stats.medianMetric, metricUnit(config)).padEnd(38) + "║");
  }
  if (stats.stdDev !== null) {
    rows.push("║  Std Deviation:         " + stats.stdDev.toFixed(4).padEnd(38) + "║");
  }
  rows.push("║  Consistency:           " + `${stats.consistency.toFixed(1)}% [${generateProgressBar(stats.consistency, 100, 12)}]`.padEnd(38) + "║");
  rows.push("║  Volatility:            " + `${stats.volatility.toFixed(1)}% [${generateProgressBar(Math.min(stats.volatility, 100), 100, 12)}]`.padEnd(38) + "║");
  rows.push("╚══════════════════════════════════════════════════════════════════════╝");
  rows.push("");

  // PANE 4: PERFORMANCE CHART (New)
  rows.push("╔══════════════════════════════════════════════════════════════════════╗");
  rows.push("║  📊 PANE 4: PERFORMANCE TREND CHART                                  ║");
  rows.push("╠══════════════════════════════════════════════════════════════════════╣");
  if (values.length > 0) {
    const chartLines = generateAsciiChart(values.slice(-25), 35, 8);
    for (const line of chartLines) {
      rows.push("║  " + line.padEnd(68) + "║");
    }
  } else {
    rows.push("║  " + "No data available for chart".padEnd(68) + "║");
  }
  rows.push("╚══════════════════════════════════════════════════════════════════════╝");
  rows.push("");

  // PANE 5: TIME-SERIES ANALYSIS (New)
  rows.push("╔══════════════════════════════════════════════════════════════════════╗");
  rows.push("║  ⏱️  PANE 5: TIME-SERIES ANALYSIS                                    ║");
  rows.push("╠══════════════════════════════════════════════════════════════════════╣");
  if (stats.recent5Avg !== null) {
    rows.push("║  Last 5 Runs Avg:      " + fmt(stats.recent5Avg, metricUnit(config)).padEnd(38) + "║");
  }
  if (stats.recent10Avg !== null) {
    rows.push("║  Last 10 Runs Avg:     " + fmt(stats.recent10Avg, metricUnit(config)).padEnd(38) + "║");
  }
  if (stats.totalImprovement !== null) {
    rows.push("║  Total Improvement:     " + fmt(stats.totalImprovement, metricUnit(config)).padEnd(38) + "║");
  }
  if (stats.avgImprovementPerRun !== null) {
    rows.push("║  Avg Improvement/Run:   " + fmt(stats.avgImprovementPerRun, metricUnit(config)).padEnd(38) + "║");
  }
  rows.push("╠══════════════════════════════════════════════════════════════════════╣");
  // Add performance comparison
  if (stats.recent5Avg !== null && stats.recent10Avg !== null) {
    const diff = stats.recent5Avg - stats.recent10Avg;
    const diffStr = diff > 0 ? `+${fmt(diff, metricUnit(config))}` : fmt(diff, metricUnit(config));
    rows.push("║  5 vs 10 Run Diff:     " + `${diffStr} (${diff > 0 ? 'worse' : 'better'})`.padEnd(38) + "║");
  }
  rows.push("╚══════════════════════════════════════════════════════════════════════╝");
  rows.push("");

  // PANE 6: RESULTS HISTORY (Enhanced)
  rows.push("╔══════════════════════════════════════════════════════════════════════╗");
  rows.push("║  📋 PANE 6: RESULTS HISTORY (Last 15)                               ║");
  rows.push("╠══════════════════════════════════════════════════════════════════════╣");
  rows.push("║  Run  │ " + metricName(config).padEnd(10) + " │ Status     │ Delta  │ Description" + " ".repeat(10) + "║");
  rows.push("║  ─────┴───────────────────┴────────────┴────────┴─────────────────────║");

  const recentResults = state.results.slice(-15).reverse();
  for (const result of recentResults) {
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
    const d = state.baselineMetric !== null ? delta(result.value, state.baselineMetric) : "N/A";
    const description = result.description.length > 20 ? result.description.slice(0, 20) + "..." : result.description;
    rows.push(
      "║  " + String(result.run).padStart(4) + " │ " + fmt(result.value, metricUnit(config)).padEnd(10) + " │ " + icon + " " + action.padEnd(9) + " │ " + d.padEnd(6) + " │ " + description.padEnd(30) + "║"
    );
  }

  rows.push("╚══════════════════════════════════════════════════════════════════════╝");
  rows.push("");

  // PANE 7: DECISION ANALYSIS (New)
  rows.push("╔══════════════════════════════════════════════════════════════════════╗");
  rows.push("║  🧠 PANE 7: DECISION ANALYSIS                                        ║");
  rows.push("╠══════════════════════════════════════════════════════════════════════╣");
  rows.push("║  Total Decisions:       " + String(state.decisions.length).padEnd(38) + "║");
  rows.push("║  Keep Decisions:        " + String(state.keptCount).padEnd(38) + "║");
  rows.push("║  Discard Decisions:     " + String(state.discardedCount).padEnd(38) + "║");
  rows.push("║  Stop Decisions:        " + String(state.decisions.filter(d => d.action === "stop").length).padEnd(38) + "║");
  rows.push("╠══════════════════════════════════════════════════════════════════════╣");
  const recentDecisions = state.decisions.slice(-5);
  if (recentDecisions.length > 0) {
    rows.push("║  Recent Decisions:                                                  ║");
    for (const decision of recentDecisions) {
      const icon = decision.action === "keep" ? "✅" : decision.action === "discard" ? "❌" : decision.action === "stop" ? "🛑" : "·";
      rows.push("║    Run #" + decision.run + ": " + icon + " " + decision.action.padEnd(8) + " - " + (decision.reason?.slice(0, 40) || "").padEnd(40) + "║");
    }
  }
  rows.push("╚══════════════════════════════════════════════════════════════════════╝");
  rows.push("");

  // PANE 8: COMMAND REFERENCE
  rows.push("╔══════════════════════════════════════════════════════════════════════╗");
  rows.push("║  💡 PANE 8: COMMAND REFERENCE                                       ║");
  rows.push("╠══════════════════════════════════════════════════════════════════════╣");
  rows.push("║  /autoresearch status              - Show detailed status              ║");
  rows.push("║  /autoresearch dashboard           - Show standard dashboard           ║");
  rows.push("║  /autoresearch dashboard -f        - Show ultra-extended dashboard     ║");
  rows.push("║  /autoresearch pause               - Pause the loop                     ║");
  rows.push("║  /autoresearch resume              - Resume the loop                    ║");
  rows.push("║  /autoresearch quit                - Stop the loop completely           ║");
  rows.push("║  /autoresearch validate            - Validate JSONL state                ║");
  rows.push("║  /autoresearch finalize            - End session and cleanup             ║");
  rows.push("╚══════════════════════════════════════════════════════════════════════╝");
  rows.push("");

  // PANE 9: STATISTICS SUMMARY (Enhanced)
  rows.push("╔══════════════════════════════════════════════════════════════════════╗");
  rows.push("║  📊 PANE 9: STATISTICS SUMMARY                                      ║");
  rows.push("╠══════════════════════════════════════════════════════════════════════╣");
  rows.push("║  Total Decisions:       " + String(state.decisions.length).padEnd(38) + "║");
  rows.push("║  Parse Errors:          " + String(state.parseErrors.length).padEnd(38) + "║");
  rows.push("║  Ideas File Present:    " + (state.hasIdeas ? "✓ Yes" : "✗ No").padEnd(38) + "║");
  rows.push("║  Results Recorded:       " + String(state.results.length).padEnd(38) + "║");
  rows.push("║  Data Quality:          " + (state.parseErrors.length === 0 ? "✓ Excellent" : "⚠ Issues").padEnd(38) + "║");
  rows.push("╚══════════════════════════════════════════════════════════════════════╝");
  rows.push("");

  // PANE 10: HEALTH STATUS (New)
  rows.push("╔══════════════════════════════════════════════════════════════════════╗");
  rows.push("║  🏥 PANE 10: SYSTEM HEALTH STATUS                                   ║");
  rows.push("╠══════════════════════════════════════════════════════════════════════╣");
  const healthScore = Math.max(0, 100 - (state.parseErrors.length * 10) - (state.crashedCount * 5));
  rows.push("║  Overall Health:        " + `${healthScore.toFixed(0)}% [${generateProgressBar(healthScore, 100, 15)}]`.padEnd(38) + "║");
  rows.push("║  Data Integrity:        " + (state.parseErrors.length === 0 ? "✓ Clean" : `⚠ ${state.parseErrors.length} errors`).padEnd(38) + "║");
  rows.push("║  Stability:             " + (state.crashedCount === 0 ? "✓ Stable" : `⚠ ${state.crashedCount} crashes`).padEnd(38) + "║");
  rows.push("║  Progress:              " + (stats.currentStreak > 2 ? "✓ Advancing" : "→ Building").padEnd(38) + "║");
  rows.push("╚══════════════════════════════════════════════════════════════════════╝");
  rows.push("");

  return rows;
}
