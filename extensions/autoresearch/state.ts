import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ArConfig,
  ArDecision,
  ArResult,
  ArState,
  NormalizedResult,
  StartBudgets,
} from "./types.js";
import { logger } from "./logger.js";

// Cache parsed state while invalidating on source artifact changes.
const stateCache = new Map<string, { state: ArState; signature: string }>();

// Maximum JSONL file size (10MB) to prevent memory exhaustion
const MAX_JSONL_SIZE = 10 * 1024 * 1024;

// Maximum number of lines to parse to prevent DoS
const MAX_JSONL_LINES = 10000;

export function clearStateCache(cwd?: string): void {
  if (cwd) {
    stateCache.delete(cwd);
  } else {
    stateCache.clear();
  }
}

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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function resultValue(result: ArResult): number | null {
  if (isFiniteNumber(result.median)) return result.median;
  if (isFiniteNumber(result.value)) return result.value;
  return null;
}

function normalizeResult(result: ArResult): NormalizedResult | null {
  const value = resultValue(result);
  if (value === null || !Number.isInteger(result.run) || result.run <= 0) return null;
  if (typeof result.metric !== "string" || !result.metric) return null;

  return {
    run: result.run,
    metricName: result.metric,
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

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function artifactSignature(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return `${filePath}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    logger.debug("artifactSignature: file not accessible", { filePath });
    return `${filePath}:missing`;
  }
}

function stateSignature(cwd: string): string {
  const p = paths(cwd);
  return [
    artifactSignature(p.jsonl),
    artifactSignature(p.sentinel),
    artifactSignature(p.ideas),
  ].join("|");
}

export function readState(cwd: string): ArState {
  // Clean up orphaned temp files from previous runs
  cleanupOrphanedTempFiles(cwd);

  const signature = stateSignature(cwd);
  const cached = stateCache.get(cwd);
  if (cached && cached.signature === signature) {
    return cached.state;
  }

  const p = paths(cwd);
  const state = emptyState(cwd);
  if (!fs.existsSync(p.jsonl)) {
    stateCache.set(cwd, { state, signature });
    return state;
  }

  // Size check to prevent memory exhaustion
  try {
    const stats = fs.statSync(p.jsonl);
    if (stats.size > MAX_JSONL_SIZE) {
      const errorMsg = `JSONL file too large: ${stats.size} bytes (max ${MAX_JSONL_SIZE})`;
      logger.warn("readState: " + errorMsg, { cwd, size: stats.size, max: MAX_JSONL_SIZE });
      state.parseErrors.push(errorMsg);
      return state;
    }
  } catch (error) {
    logger.catch("readState: stat JSONL", error, { cwd });
    state.parseErrors.push("Cannot stat JSONL file");
    return state;
  }

  const resultByRun = new Map<number, NormalizedResult>();
  const seenActions = new Map<number, ArDecision["action"]>();
  const seenResultRuns = new Set<number>();
  const events: Array<{ event: Record<string, unknown>; line: number }> = [];

  // Stream-based reading with line limit
  const content = fs.readFileSync(p.jsonl, "utf-8");
  const lines = content.split("\n");

  if (lines.length > MAX_JSONL_LINES) {
    const errorMsg = `JSONL has too many lines: ${lines.length} (max ${MAX_JSONL_LINES})`;
    logger.warn("readState: " + errorMsg, { cwd, lines: lines.length, max: MAX_JSONL_LINES });
    state.parseErrors.push(errorMsg);
    return state;
  }

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;

    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch (error) {
      const errorMsg = `line ${index + 1}: invalid JSON (${String(error)})`;
      logger.debug("readState: JSON parse error", { line: index + 1 });
      state.parseErrors.push(errorMsg);
      return;
    }

    if (!isObject(event)) {
      state.parseErrors.push(`line ${index + 1}: event must be an object`);
      return;
    }
    events.push({ event, line: index + 1 });
  });

  if (events.length === 0) {
    state.parseErrors.push("JSONL contains no events");
    return state;
  }

  if (events[0].event.type !== "config") {
    state.parseErrors.push("first non-empty event must be a config event");
  }

  let seenConfig = false;
  for (const { event, line } of events) {
    const eventType = event.type;

    if (eventType === "config") {
      seenConfig = true;
      const config = event as unknown as ArConfig;
      if (config.schema_version !== 1)
        state.parseErrors.push(`line ${line}: config.schema_version must be 1`);
      if (typeof config.name !== "string" || !config.name)
        state.parseErrors.push(`line ${line}: config.name is required`);
      if (typeof config.metric !== "string" || !config.metric)
        state.parseErrors.push(`line ${line}: config.metric is required`);
      if (!config.direction || !["lower", "higher"].includes(config.direction))
        state.parseErrors.push(`line ${line}: config.direction must be lower or higher`);
      if (typeof config.created_at !== "string" || !config.created_at)
        state.parseErrors.push(`line ${line}: config.created_at is required`);
      state.config = config;
      state.currentSegment = config.segment ?? state.currentSegment;
      continue;
    }

    if (!seenConfig) {
      state.parseErrors.push(`line ${line}: non-config event before config`);
    }

    if (eventType === "result") {
      const result = event as unknown as ArResult;
      if (!Number.isInteger(result.run) || result.run <= 0) {
        state.parseErrors.push(`line ${line}: result.run must be a positive integer`);
      } else if (seenResultRuns.has(result.run)) {
        state.parseErrors.push(`line ${line}: duplicate result.run ${result.run}`);
      }

      if (typeof result.metric !== "string" || !result.metric) {
        state.parseErrors.push(`line ${line}: result.metric is required`);
      }
      if (resultValue(result) === null) {
        state.parseErrors.push(
          `line ${line}: result.value or result.median must be a finite number`
        );
      }
      if ("samples" in result) {
        const samples = result.samples;
        if (
          !Array.isArray(samples) ||
          samples.length === 0 ||
          samples.some((sample) => !isFiniteNumber(sample))
        ) {
          state.parseErrors.push(`line ${line}: result.samples must be a non-empty numeric list`);
        }
      }
      if (result.timestamp === undefined) {
        state.parseErrors.push(`line ${line}: result.timestamp is required`);
      }

      const normalized = normalizeResult(result);
      if (normalized) {
        state.results.push(normalized);
        resultByRun.set(normalized.run, normalized);
        seenResultRuns.add(normalized.run);
        if (["keep", "discard"].includes(normalized.status)) {
          seenActions.set(normalized.run, normalized.status as "keep" | "discard");
        }
      }
      continue;
    }

    if (eventType === "decision") {
      const decision = event as unknown as ArDecision;
      if (!Number.isInteger(decision.run) || decision.run <= 0) {
        state.parseErrors.push(`line ${line}: decision.run must be a positive integer`);
      } else if (!seenResultRuns.has(decision.run)) {
        state.parseErrors.push(
          `line ${line}: decision.run ${decision.run} has no preceding result`
        );
      }
      if (!["keep", "discard", "baseline", "stop"].includes(decision.action)) {
        state.parseErrors.push(`line ${line}: decision.action is invalid`);
      }
      if (typeof decision.reason !== "string" || !decision.reason) {
        state.parseErrors.push(`line ${line}: decision.reason is required`);
      }
      if (typeof decision.timestamp !== "string" || !decision.timestamp) {
        state.parseErrors.push(`line ${line}: decision.timestamp is required`);
      }
      state.decisions.push(decision);
      if (Number.isInteger(decision.run) && decision.run > 0)
        seenActions.set(decision.run, decision.action);
      continue;
    }

    state.parseErrors.push(`line ${line}: unknown event type ${JSON.stringify(eventType)}`);
  }

  const baselineDecision = state.decisions.find((d) => d.action === "baseline");
  const baselineResult = baselineDecision
    ? resultByRun.get(baselineDecision.run)
    : state.results[0];
  state.baselineMetric = baselineResult?.value ?? null;

  const dir = state.config ? direction(state.config) : "lower";
  for (const result of state.results) {
    const action = seenActions.get(result.run);
    const isBestCandidate =
      action === "baseline" || action === "keep" || (!action && result.run === baselineResult?.run);
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
  state.keptCount = [...seenActions.values()].filter(
    (action) => action === "keep" || action === "baseline"
  ).length;
  state.discardedCount = [...seenActions.values()].filter((action) => action === "discard").length;
  state.crashedCount = state.results.filter((result) => result.status === "crash").length;

  stateCache.set(cwd, { state, signature });

  return state;
}

export function fmt(value: number, unit: string): string {
  return unit ? `${value}${unit}` : String(value);
}

export function delta(current: number, baseline: number): string {
  if (!baseline) return "";
  const d = ((current - baseline) / Math.abs(baseline)) * 100;
  return d >= 0 ? `(+${d.toFixed(1)}%)` : `(${d.toFixed(1)}%)`;
}

function atomicWriteFileSync(filePath: string, content: string): void {
  // Use a unique temp file with random suffix for better collision resistance
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  const tmp = `${filePath}.tmp-${process.pid}-${timestamp}-${random}`;

  try {
    fs.writeFileSync(tmp, content, "utf-8");

    // On Node.js 18+, we can use the recursive option for better Windows support
    // fs.renameSync is atomic on POSIX, but on Windows it may fail if target exists
    // We use a try-catch with fallback for cross-platform compatibility
    try {
      fs.renameSync(tmp, filePath);
      logger.debug("atomicWriteFileSync: wrote file", { filePath, size: content.length });
    } catch {
      // Fallback for Windows: delete target first, then rename
      logger.debug("atomicWriteFileSync: rename failed, trying Windows fallback", { filePath });
      try {
        fs.unlinkSync(filePath);
        fs.renameSync(tmp, filePath);
        logger.debug("atomicWriteFileSync: Windows fallback succeeded", { filePath });
      } catch {
        // Last resort: copy content directly (not atomic, but better than nothing)
        logger.warn("atomicWriteFileSync: atomic rename failed, using direct write", { filePath });
        fs.writeFileSync(filePath, content, "utf-8");
        try {
          fs.unlinkSync(tmp);
        } catch {
          // Ignore cleanup failure
        }
      }
    }
  } catch (error) {
    // Clean up temp file on write failure
    logger.catch("atomicWriteFileSync: write failed", error, { filePath });
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Ignore cleanup failure
    }
    throw new Error(`Failed to write file atomically: ${filePath}`, { cause: error });
  }
}

// Clean up orphaned temp files from previous atomic write attempts
export function cleanupOrphanedTempFiles(cwd: string): void {
  const p = paths(cwd);
  const dir = path.dirname(p.snapshot);

  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      // Match pattern: *.tmp-{pid}-{timestamp}-{random}
      const match = file.match(/\.tmp-\d+-\d+-[a-z0-9]+$/);
      if (match) {
        const tmpPath = path.join(dir, file);
        try {
          // Only delete files older than 60 seconds (avoid deleting active writes)
          const stat = fs.statSync(tmpPath);
          const ageMs = Date.now() - stat.mtimeMs;
          if (ageMs > 60000) {
            fs.unlinkSync(tmpPath);
          }
        } catch {
          // Ignore individual file errors
        }
      }
    }
  } catch {
    // Ignore directory listing errors
  }
}

export function buildContextInjection(
  cwd: string,
  state: ArState,
  lastRunDurationMs?: number
): string | null {
  const p = paths(cwd);
  if (!fs.existsSync(p.context) || fs.existsSync(p.sentinel)) return null;
  if (state.parseErrors.length > 0) {
    return [
      "## Autoresearch blocked",
      "autoresearch.jsonl has parse or schema errors. Fix these before continuing:",
      ...state.parseErrors.map((error) => `- ${error}`),
    ].join("\n");
  }

  let md = fs.readFileSync(p.context, "utf-8");

  if (!state.config || state.runCount === 0) return md;

  const config = state.config;

  md += `\n\n---\n## 🔬 Autoresearch Loop — Run ${state.runCount + 1}\n`;
  md += `**Je bent in een bounded autoresearch loop.** Test één hypothese per run,\n`;
  md += `vergelijk met de huidige best, en gebruik autoresearch_decide voor keep/discard.\n\n`;

  md += `### Status\n`;
  md += `| Metric | Waarde |\n`;
  md += `|--------|--------|\n`;
  md += `| Runs | ${state.runCount} (✅ ${state.keptCount} keep / ❌ ${state.discardedCount} discard / 💥 ${state.crashedCount} crash) |\n`;
  if (state.baselineMetric !== null)
    md += `| Baseline ${metricName(config)} | ${fmt(state.baselineMetric, metricUnit(config))} |\n`;
  if (state.bestMetric !== null && state.bestRun !== null) {
    md += `| Best ${metricName(config)} | ${fmt(state.bestMetric, metricUnit(config))} (#${state.bestRun}) ${delta(state.bestMetric, state.baselineMetric ?? 0)} |\n`;
  }
  const dir = direction(config);
  md += `| Doel | ${dir === "lower" ? "↓ lager" : "↑ hoger"} is beter |\n`;
  if (lastRunDurationMs !== undefined && lastRunDurationMs > 0) {
    md += `| Laatste run | ${(lastRunDurationMs / 1000).toFixed(1)}s |\n`;
  }

  const recent = state.results.slice(-10).reverse();
  if (recent.length > 0) {
    md += `\n### Recently Tried (auto-generated)\n`;
    md += `| Run | Result | Status | Commit | Description |\n`;
    md += `|-----|--------|--------|--------|-------------|\n`;
    for (const r of recent) {
      const action = state.decisions.find((d) => d.run === r.run)?.action ?? r.status;
      const icon =
        action === "keep" || action === "baseline"
          ? "✅"
          : action === "discard"
            ? "❌"
            : r.status === "crash"
              ? "💥"
              : "·";
      const d = state.baselineMetric !== null ? delta(r.value, state.baselineMetric) : "";
      const commitShort = r.commit ? r.commit.slice(0, 7) : "-";
      md += `| ${r.run} | ${fmt(r.value, metricUnit(config))} ${d} | ${icon} ${action} | \`${commitShort}\` | ${r.description.slice(0, 60)} |\n`;
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

  const snapshot = {
    session: config.name,
    timestamp: new Date().toISOString(),
    metric: metricName(config),
    direction: direction(config),
    baseline: state.baselineMetric,
    best: state.bestMetric,
    bestRun: state.bestRun,
    runs: state.runCount,
    kept: state.keptCount,
    discarded: state.discardedCount,
    crashed: state.crashedCount,
    lastDecisions: state.decisions.slice(-5).map((d) => ({
      run: d.run,
      action: d.action,
      reason: d.reason,
    })),
  };
  try {
    atomicWriteFileSync(p.snapshot, `${JSON.stringify(snapshot, null, 2)}\n`);
  } catch {
    /* best-effort: don't block context injection on snapshot failure */
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
