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
import { registerAutoresearchCommand } from "./commands.js";
import type { LoopState } from "./loop.js";
import { buildContinuationMessage, evaluateContinuation, summarizeLoopStop } from "./loop.js";
import { evaluateToolCall, hasAutoresearchSession } from "./policy.js";
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

    // Re-derive consecutive discards from JSONL (survives session restarts)
    if (activeLoop) {
      const state = readState(ctx.cwd);
      let cons = 0;
      for (let i = state.decisions.length - 1; i >= 0; i--) {
        if (state.decisions[i].action === "discard") cons++;
        else break;
      }
      activeLoop.consecutiveDiscards = cons;
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

  // ─── tool_call guard ──────────────────────────────────────────────────────────
  pi.on("tool_call", async (event, ctx) => {
    if (!hasAutoresearchSession(ctx.cwd)) return;
    const decision = evaluateToolCall(event.toolName, event.input, ctx.cwd);
    if (decision.block) return { block: true, reason: decision.reason };
  });

  // ─── agent_end: update footer + autonomous continuation ─────────────────────
  pi.on("agent_end", async (_event, ctx) => {
    const state = readState(ctx.cwd);
    ctx.ui.setStatus("autoresearch", footerText(state));

    if (!activeLoop || activeLoop.mode === "assisted") return;

    // Track consecutive discards
    const lastDecision = state.decisions.at(-1);
    if (lastDecision) {
      if (lastDecision.action === "keep" || lastDecision.action === "baseline") {
        activeLoop.consecutiveDiscards = 0;
      } else if (lastDecision.action === "discard") {
        activeLoop.consecutiveDiscards++;
      }
    }

    const cont = evaluateContinuation(state, activeLoop, Date.now());
    if (!cont.shouldContinue) {
      const summary = summarizeLoopStop(activeLoop, cont, state);
      pi.sendMessage({ customType: "autoresearch-stop", content: summary, display: true }, { triggerTurn: false });
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
