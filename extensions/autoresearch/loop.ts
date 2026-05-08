import type { ArState } from "./types.js";
import { delta, direction, fmt, metricName, metricUnit } from "./state.js";

export type LoopMode = "assisted" | "ralph";

export interface LoopState {
  mode: LoopMode;
  maxRuns: number;
  maxMinutes: number;
  startedAt: number;
  runsAtStart: number;
  maxConsecutiveDiscards: number;
  consecutiveDiscards: number;
  maxRunsWithoutImprovement: number;
  runsSinceLastImprovement: number;
  lastRunTs?: number;
  lastRunDurationMs?: number;
  trackedRuns: number;
}

export interface LoopContinuation {
  shouldContinue: boolean;
  stopReason?: string;
  runNumber: number;
  runsUsed: number;
  remainingRuns: number;
  elapsedMinutes: number;
  remainingMinutes: number;
}

export function evaluateContinuation(
  state: ArState,
  loop: LoopState,
  nowMs: number
): LoopContinuation {
  const runsUsed = state.runCount - loop.runsAtStart;
  const elapsedMs = nowMs - loop.startedAt;
  const elapsedMinutes = elapsedMs / 60_000;
  const runNumber = state.runCount + 1;
  const remainingRuns = loop.maxRuns - runsUsed;
  const remainingMinutes = loop.maxMinutes - elapsedMinutes;

  const base = { runNumber, runsUsed, remainingRuns, elapsedMinutes, remainingMinutes };

  if (state.isPaused)
    return {
      shouldContinue: false,
      stopReason: "paused — /autoresearch resume to continue",
      ...base,
    };
  if (state.parseErrors.length > 0)
    return { shouldContinue: false, stopReason: "JSONL parse errors", ...base };
  if (!state.config) return { shouldContinue: false, stopReason: "no config found", ...base };
  if (runsUsed >= loop.maxRuns)
    return {
      shouldContinue: false,
      stopReason: `run budget exhausted (${loop.maxRuns} runs)`,
      ...base,
    };
  if (elapsedMinutes >= loop.maxMinutes)
    return {
      shouldContinue: false,
      stopReason: `time budget exhausted (${loop.maxMinutes} min)`,
      ...base,
    };

  const lastDecision = state.decisions.at(-1);
  if (lastDecision?.action === "stop")
    return { shouldContinue: false, stopReason: `stop decision: ${lastDecision.reason}`, ...base };
  if (loop.consecutiveDiscards >= loop.maxConsecutiveDiscards)
    return {
      shouldContinue: false,
      stopReason: `${loop.consecutiveDiscards} consecutive discards (limit ${loop.maxConsecutiveDiscards})`,
      ...base,
    };
  if (loop.runsSinceLastImprovement >= loop.maxRunsWithoutImprovement)
    return {
      shouldContinue: false,
      stopReason: `plateau — ${loop.runsSinceLastImprovement} runs zonder verbetering (limit ${loop.maxRunsWithoutImprovement})`,
      ...base,
    };

  return { shouldContinue: true, ...base };
}

const RALPH_STRATEGY_PROMPT = `[RALPH MODE] Je bent in Ralph Wiggum modus — de simpelste hypothese eerst.

Regels:
- Bedenk ÉÉN kleine, domme, concrete wijziging (voorkeur: verwijderen, simpelere loop, inline caching, minder allocaties).
- GEEN slimme rewrites. GEEN architectuur-veranderingen.
- De diff mag maximaal ~10 gewijzigde regels zijn, tenzij de scope dit uitdrukkelijk toestaat.
- Geen nieuwe dependencies, geen config-wijzigingen, geen lockfile-wijzigingen.
- Run ./autoresearch.sh, verifieer dat tests slagen, vergelijk mediaan met huidige best.
- Als de verbetering < min_effect_size_pct: meteen discard, ga door.
- Doe geen tweede hypothese in dezelfde run.`;

const AUTONOMOUS_BASE_PROMPT = `Start één bounded autoresearch run.
Lees autoresearch.md en autoresearch.jsonl voor context.
Run ./autoresearch.sh als benchmark en parse METRIC-regels.
Test één hypothese, vergelijk mediaan met de huidige best, gebruik autoresearch_decide tool voor keep/discard/stop.
Leg de beslissing vast in autoresearch.jsonl.
Stop als budget, safety, corrupt state, noisymetrics, of correctness failures van toepassing zijn.`;

export function buildContinuationMessage(
  loop: LoopState,
  cont: LoopContinuation,
  state: ArState
): string {
  const config = state.config;
  let header = loop.mode === "ralph" ? `${RALPH_STRATEGY_PROMPT}\n\n` : "";

  header += AUTONOMOUS_BASE_PROMPT;

  let context = `\n\nBudget: run ${cont.runNumber} van ${loop.runsAtStart + loop.maxRuns} | ${cont.remainingMinutes.toFixed(0)} min resterend.`;

  if (config && state.bestMetric !== null && state.baselineMetric !== null) {
    context += ` | Best: ${fmt(state.bestMetric, metricUnit(config))} ${delta(state.bestMetric, state.baselineMetric)} t.o.v. baseline.`;
  }

  // ── Recently tried deduplication hint ───────────────────────────────────
  const recentDescriptions = [
    ...new Set(
      state.results
        .slice(-5)
        .map((r) => r.description)
        .filter(Boolean)
    ),
  ];
  if (recentDescriptions.length > 0) {
    context += `\n\nLaatste pogingen (herhaal deze NIET):\n`;
    context += recentDescriptions.map((d) => `- ${d}`).join("\n");
  }

  return `${header}${context}`;
}

export function summarizeLoopStop(loop: LoopState, cont: LoopContinuation, state: ArState): string {
  const config = state.config;
  const lines = [
    `🏁 Autoresearch loop gestopt.`,
    `Mode: ${loop.mode} | Reden: ${cont.stopReason ?? "onbekend"}`,
    `Runs uitgevoerd: ${cont.runsUsed}/${loop.maxRuns} | Tijd: ${cont.elapsedMinutes.toFixed(1)} min.`,
  ];
  if (config) {
    const dir = direction(config);
    lines.push(`Metric: ${metricName(config)} (${dir})`);
    if (state.baselineMetric !== null)
      lines.push(`Baseline: ${fmt(state.baselineMetric, metricUnit(config))}`);
    if (state.bestMetric !== null && state.bestRun !== null)
      lines.push(
        `Best: ${fmt(state.bestMetric, metricUnit(config))} (#${state.bestRun}) ${delta(state.bestMetric, state.baselineMetric ?? 0)}`
      );
  }
  lines.push(
    `Beslissingen: ✅ ${state.keptCount} keep | ❌ ${state.discardedCount} discard | 💥 ${state.crashedCount} crash`
  );
  return lines.join("\n");
}
