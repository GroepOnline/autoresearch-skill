/**
 * Autoresearch Pi Extension
 *
 * Native Pi TUI plugin for bounded, benchmark-driven autoresearch sessions.
 *
 *  Commands: /autoresearch status|new|start|ralph|pause|resume|dashboard|validate
 *  Tools:    autoresearch_state, autoresearch_metric, autoresearch_decide, autoresearch_dashboard
 *  Hooks:    session_start, before_agent_start, tool_call, agent_end,
 *            session_before_compact, session_shutdown
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { registerAutoresearchCommand } from "./commands.js";
import type { LoopState } from "./loop.js";
import { buildContinuationMessage, evaluateContinuation, summarizeLoopStop, type LoopContinuation } from "./loop.js";
import { buildSecurityAuditEntry, evaluateToolCall, hasAutoresearchSession } from "./policy.js";
import { buildContextInjection, delta, direction, fmt, metricName, metricUnit, paths, readState } from "./state.js";
import { footerText } from "./ui.js";
import { registerAutoresearchTools } from "./tools.js";

export default function autoresearchExtension(pi: ExtensionAPI) {
  // ─── In-memory loop state ────────────────────────────────────────────────────
  let activeLoop: LoopState | null = null;

  const storeLoop = (loop: LoopState | null) => { activeLoop = loop; };

  // ─── session_start ───────────────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    // Restore loop state from session entries
    const entries: Array<{ type: string; customType?: string; data?: unknown }> = ctx.sessionManager.getEntries();
    const lastLoopEntry = entries.filter(e => e.type === "custom" && e.customType === "autoresearch-loop").pop();
    if (lastLoopEntry?.data) activeLoop = lastLoopEntry.data as LoopState;

    // Re-derive consecutive discards and plateau from JSONL (survives session restarts)
    if (activeLoop) {
      const state = readState(ctx.cwd);
      let cons = 0;
      for (let i = state.decisions.length - 1; i >= 0; i--) {
        if (state.decisions[i].action === "discard") cons++;
        else break;
      }
      activeLoop.consecutiveDiscards = cons;

      let since = 0;
      for (let i = state.decisions.length - 1; i >= 0; i--) {
        if (state.decisions[i].action === "keep" || state.decisions[i].action === "baseline") break;
        since++;
      }
      activeLoop.runsSinceLastImprovement = since;

      // Restore tracked runs count
      activeLoop.trackedRuns = state.runCount - activeLoop.runsAtStart;
    }

    const state = readState(ctx.cwd);
    ctx.ui.setStatus("autoresearch", footerText(state));

    if (state.hasIdeas) {
      const lines = fs.readFileSync(paths(ctx.cwd).ideas, "utf-8").split("\n");
      const count = lines.filter(l => l.startsWith("- ")).length;
      if (count > 0) ctx.ui.notify(`💡 autoresearch.ideas.md heeft ${count} ideeën`, "info");
    }
  });

  // ─── before_agent_start ──────────────────────────────────────────────────────
  pi.on("before_agent_start", async (_event, ctx) => {
    const state = readState(ctx.cwd);
    const injection = buildContextInjection(ctx.cwd, state, activeLoop?.lastRunDurationMs);
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

  // ─── tool_call guard ──────────────────────────────────────────────────────────
  pi.on("tool_call", async (event, ctx) => {
    if (!hasAutoresearchSession(ctx.cwd)) return;
    const maxDiffLines = activeLoop?.maxDiffLines ?? 50;
    const decision = evaluateToolCall(event.toolName, event.input, ctx.cwd, undefined, maxDiffLines);
    if (decision.block) {
      // Security audit logging
      const auditPath = path.join(ctx.cwd, ".autoresearch-audit.jsonl");
      try {
        const auditEntry = buildSecurityAuditEntry(event.toolName, event.input, decision.reason ?? "blocked by policy");
        fs.appendFileSync(auditPath, JSON.stringify(auditEntry) + "\n");
      } catch (error) {
        console.error(`[autoresearch] Failed to write audit log to ${auditPath}:`, error);
      }
      return { block: true, reason: decision.reason };
    }
  });

  // ─── agent_end: update footer + autonomous continuation ─────────────────────
  pi.on("agent_end", async (_event, ctx) => {
    const state = readState(ctx.cwd);
    ctx.ui.setStatus("autoresearch", footerText(state));

    // ── Track run duration ──────────────────────────────────────────────────
    if (activeLoop) {
      const newRunCount = state.runCount - activeLoop.runsAtStart;
      if (newRunCount > activeLoop.trackedRuns) {
        const now = Date.now();
        if (activeLoop.lastRunTs !== undefined) {
          activeLoop.lastRunDurationMs = now - activeLoop.lastRunTs;
        }
        activeLoop.lastRunTs = now;
        activeLoop.trackedRuns = newRunCount;
      }
    }

    if (!activeLoop || activeLoop.mode === "assisted") return;

    // Track consecutive discards + plateau
    const lastDecision = state.decisions.at(-1);
    if (lastDecision) {
      if (lastDecision.action === "keep" || lastDecision.action === "baseline") {
        activeLoop.consecutiveDiscards = 0;
        activeLoop.runsSinceLastImprovement = 0;
      } else if (lastDecision.action === "discard") {
        activeLoop.consecutiveDiscards++;
        activeLoop.runsSinceLastImprovement++;
      }
    }

    const cont = evaluateContinuation(state, activeLoop, Date.now());
    if (!cont.shouldContinue) {
      const summary = summarizeLoopStop(activeLoop, cont, state);
      pi.sendMessage({ customType: "autoresearch-stop", content: summary, display: true }, { triggerTurn: false });
      // ── Write stop summary to disk ──────────────────────────────────────
      writeStopSummary(ctx.cwd, activeLoop, cont, state);
      activeLoop = null;
      pi.appendEntry("autoresearch-loop", null);
      return;
    }

    const msg = buildContinuationMessage(activeLoop, cont, state);
    pi.sendUserMessage(msg, { deliverAs: "followUp" });
  });

  // ─── session_before_compact ───────────────────────────────────────────────────
  pi.on("session_before_compact", async (event, ctx) => {
    const state = readState(ctx.cwd);
    if (!state.config || state.parseErrors.length > 0) return;

    const { preparation } = event;
    const config = state.config;
    const loopLine = activeLoop ? `Mode: ${activeLoop.mode} | Budget: ${activeLoop.maxRuns} runs / ${activeLoop.maxMinutes} min` : "Mode: geen actieve loop";

    const summary = [
      `## Autoresearch — Context Preserved`,
      `Session: ${config.name}`,
      `Metric: ${metricName(config)} (${direction(config)})`,
      `Runs: ${state.runCount} | ✅ ${state.keptCount} | ❌ ${state.discardedCount} | 💥 ${state.crashedCount}`,
      loopLine,
      state.baselineMetric !== null ? `Baseline: ${fmt(state.baselineMetric, metricUnit(config))}` : "",
      state.bestMetric !== null && state.bestRun !== null ? `Best: ${fmt(state.bestMetric, metricUnit(config))} (#${state.bestRun}) ${delta(state.bestMetric, state.baselineMetric ?? 0)}` : "",
      "",
      `State: autoresearch.jsonl, autoresearch.md, experiments/worklog.md`,
      `Resume: read autoresearch.jsonl + worklog.md, continue from run ${state.runCount + 1}`,
    ].filter(Boolean).join("\n");

    return {
      compaction: {
        summary: `${summary}\n\n[See autoresearch.jsonl for full history]`,
        firstKeptEntryId: preparation.firstKeptEntryId,
        tokensBefore: preparation.tokensBefore,
      },
    };
  });

  // ─── session_shutdown ────────────────────────────────────────────────────────
  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus("autoresearch", "");
  });

  // ─── Register commands and tools ─────────────────────────────────────────────
  registerAutoresearchCommand(pi, storeLoop);
  registerAutoresearchTools(pi);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Cleanup old experiment files to prevent unbounded growth.
 * Keeps last 50 files and removes files older than 30 days.
 */
function cleanupExperiments(experimentsDir: string): void {
  if (!fs.existsSync(experimentsDir)) return;

  try {
    const files = fs.readdirSync(experimentsDir)
      .filter(file => file.startsWith("summary-") && file.endsWith(".md"))
      .map(file => ({
        name: file,
        path: path.join(experimentsDir, file),
        stat: fs.statSync(path.join(experimentsDir, file)),
      }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs); // Newest first

    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
    const now = Date.now();
    const keepCount = 50;

    let deleted = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const shouldDelete = i >= keepCount || (now - file.stat.mtimeMs) > maxAge;

      if (shouldDelete) {
        try {
          fs.unlinkSync(file.path);
          deleted++;
        } catch {
          // Best effort - don't fail the summary write on cleanup failure
        }
      }
    }

    if (deleted > 0) {
      console.log(`[autoresearch] Cleaned up ${deleted} old experiment files`);
    }
  } catch (error) {
    // Don't fail summary write on cleanup failure
    console.error(`[autoresearch] Failed to cleanup experiments:`, error);
  }
}

function writeStopSummary(cwd: string, loop: LoopState, cont: LoopContinuation, state: import("./types.js").ArState): void {
  const config = state.config;
  if (!config) return;

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const experimentsDir = path.join(cwd, "experiments");
  const filePath = path.join(experimentsDir, `summary-${ts}.md`);

  // Cleanup old experiments (keep last 50 files, max 30 days old)
  cleanupExperiments(experimentsDir);

  const lines = [
    `# Autoresearch Stop Summary`,
    `**Session:** ${config.name}`,
    `**Stopped:** ${new Date().toISOString()}`,
    `**Reason:** ${cont.stopReason ?? "onbekend"}`,
    "",
    "## Stats",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Mode | ${loop.mode} |`,
    `| Runs | ${cont.runsUsed}/${loop.maxRuns} |`,
    `| Time | ${cont.elapsedMinutes.toFixed(1)} min / ${loop.maxMinutes} min |`,
    `| Keep | ${state.keptCount} |`,
    `| Discard | ${state.discardedCount} |`,
    `| Crash | ${state.crashedCount} |`,
  ];

  if (state.baselineMetric !== null) lines.push(`| Baseline | ${fmt(state.baselineMetric, metricUnit(config))} |`);
  if (state.bestMetric !== null && state.bestRun !== null) {
    lines.push(`| Best | ${fmt(state.bestMetric, metricUnit(config))} (#${state.bestRun}) ${delta(state.bestMetric, state.baselineMetric ?? 0)} |`);
  }

  lines.push("", "## Recent Results", "");
  const recent = state.results.slice(-10).reverse();
  for (const r of recent) {
    const action = state.decisions.find(d => d.run === r.run)?.action ?? r.status;
    const d = state.baselineMetric !== null ? delta(r.value, state.baselineMetric) : "";
    lines.push(`- **#${r.run}** ${action}: ${fmt(r.value, metricUnit(config))} ${d} — ${r.description}`);
  }

  lines.push("", `*Gegenereerd door autoresearch plugin*`);

  try {
    if (!fs.existsSync(experimentsDir)) fs.mkdirSync(experimentsDir, { recursive: true });
    fs.writeFileSync(filePath, lines.join("\n") + "\n");
  } catch (error) {
    // Log error to stderr - this is critical for debugging production issues
    console.error(`[autoresearch] Failed to write stop summary to ${filePath}:`, error);
  }
}
